from types import SimpleNamespace

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsSuperAdmin

from . import services, sslcommerz
from .models import Payment, PaymentAccounts
from .serializers import ManualPaymentSerializer, PaymentAccountsSerializer, PaymentOptionsSerializer, PaymentSerializer


class IsOwner(BasePermission):
    """The business owner, even while the business is locked for not paying."""

    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and user.role == User.Role.OWNER and user.business_id is not None


def online_status():
    """connected | test | missing: whether SSLCommerz can take payments, whatever the switch says."""
    if sslcommerz.platform_account():
        return "connected"
    return "test" if sslcommerz.is_test_gateway() else "missing"


def online_open(accounts):
    return accounts.online_enabled and online_status() != "missing"


class BillingConfigView(APIView):
    """How owners can pay: online when it's on and SSLCommerz can take it, and by hand."""

    def get(self, request):
        accounts = PaymentAccounts.load()
        return Response(
            {
                "test_gateway": online_status() == "test",
                "online": online_open(accounts),
                "options": PaymentOptionsSerializer(accounts).data,
            }
        )


class PaymentListView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        payments = Payment.objects.filter(business=request.user.business).select_related("business")
        return Response(PaymentSerializer(payments, many=True).data)


class PaymentDetailView(APIView):
    """Invoices: only the business's owner and the super admin."""

    def get(self, request, pk):
        payment = get_object_or_404(Payment.objects.select_related("business"), pk=pk)
        user = request.user
        allowed = user.is_superadmin or (user.role == User.Role.OWNER and user.business_id == payment.business_id)
        if not allowed:
            raise NotFound()
        return Response(PaymentSerializer(payment).data)


class CheckoutView(APIView):
    """Opens a payment for one month and returns the gateway page to send the owner to."""

    permission_classes = [IsOwner]

    def post(self, request):
        business = request.user.business
        if business.suspended:
            return Response({"detail": "This business is suspended. Please contact support."}, status=400)
        if not online_open(PaymentAccounts.load()):
            return Response({"detail": "Paying online is turned off right now. Send the money by hand instead."}, status=400)
        payer = SimpleNamespace(name=request.user.name, email=request.user.email, phone="")
        payment = services.create_pending_payment(business, payer)
        url, error = sslcommerz.init_payment(payment)
        if error:
            return Response({"detail": error}, status=502)
        return Response({"url": url})


class ManualPaymentView(APIView):
    """The owner sent money by bKash, Nagad, Rocket or bank, and gives the transaction ID to check."""

    permission_classes = [IsOwner]

    def post(self, request):
        business = request.user.business
        if business.suspended:
            return Response({"detail": "This business is suspended. Please contact support."}, status=400)
        serializer = ManualPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payer = SimpleNamespace(name=request.user.name, email=request.user.email, phone=serializer.validated_data["sent_from"])
        try:
            payment = services.submit_manual(business, payer, **serializer.validated_data)
        except services.PaymentError as err:
            return Response({"detail": str(err)}, status=400)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class GatewayResultView(APIView):
    """The frontend forwards what SSLCommerz posted to it. A payment is only
    marked paid after validate() confirms it with SSLCommerz directly."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, result):
        if result not in ("success", "fail", "cancel", "ipn"):
            raise NotFound()
        tran_id = str(request.data.get("tran_id", ""))
        val_id = str(request.data.get("val_id", ""))
        payment = Payment.objects.filter(tran_id=tran_id).first() if tran_id else None

        outcome = "failed"
        if payment:
            if payment.status == Payment.Status.PAID:
                outcome = "success"
            elif result in ("success", "ipn") and val_id:
                ok, method, bank_tran_id = sslcommerz.validate(val_id, payment)
                if ok:
                    services.mark_paid(tran_id, val_id=val_id, method=method, bank_tran_id=bank_tran_id)
                    outcome = "success"
            elif result == "cancel":
                services.mark_unpaid(tran_id, Payment.Status.CANCELLED)
                outcome = "cancelled"
            else:
                services.mark_unpaid(tran_id, Payment.Status.FAILED)
        return Response({"status": outcome, "tran_id": tran_id}, status=status.HTTP_200_OK)


class TestGatewayPaymentView(APIView):
    """Feeds the frontend's stand-in checkout page. Only while the test gateway is on."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, tran_id):
        payment = Payment.objects.filter(tran_id=tran_id, status=Payment.Status.PENDING).select_related("business").first()
        if not sslcommerz.is_test_gateway() or not payment:
            raise NotFound()
        return Response(PaymentSerializer(payment).data)


class PlatformPaymentListView(APIView):
    """Super admin: every payment attempt on the platform, newest first."""

    def get(self, request):
        if not request.user.is_superadmin:
            raise NotFound()
        payments = Payment.objects.select_related("business")
        return Response(PaymentSerializer(payments, many=True).data)


class PlatformPaymentReviewView(APIView):
    """Super admin approves a payment sent by hand once the money arrived, or rejects it."""

    permission_classes = [IsSuperAdmin]

    def post(self, request, pk, decision):
        if decision not in ("approve", "reject"):
            raise NotFound()
        try:
            if decision == "approve":
                payment = services.approve(pk)
            else:
                payment = services.reject(pk, str(request.data.get("note", ""))[:300])
        except services.PaymentError as err:
            return Response({"detail": str(err)}, status=400)
        return Response(PaymentSerializer(payment).data)


class PlatformPaymentAccountsView(APIView):
    """Super admin: which ways to pay are on, the wallet numbers and the bank account owners send money to."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response({**PaymentAccountsSerializer(PaymentAccounts.load()).data, "online_status": online_status()})

    def put(self, request):
        serializer = PaymentAccountsSerializer(PaymentAccounts.load(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({**serializer.data, "online_status": online_status()})
