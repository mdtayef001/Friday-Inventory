from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.billing.serializers import PaymentSerializer

from .models import Business, MerchantAccount, User
from .permissions import IsSuperAdmin, IsTenantMember, ManagerNeedsPermission
from .serializers import (
    BusinessSerializer,
    BusinessSummarySerializer,
    BusinessWithOwnerSerializer,
    LoginSerializer,
    MerchantAccountSerializer,
    ManagedUserSerializer,
    PasswordSerializer,
    SessionUserSerializer,
)


class LoginThrottle(SimpleRateThrottle):
    """Limits attempts per email. Logins arrive through the Next.js server, so
    the client IP would be the same for everyone."""

    scope = "login"

    def get_cache_key(self, request, view):
        email = str(request.data.get("email", "")).strip().lower()
        return self.cache_format % {"scope": self.scope, "ident": email} if email else None


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [LoginThrottle]


class LogoutView(APIView):
    """Blacklists the refresh token so it can't be used again."""

    permission_classes = []

    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """The logged-in user and their business. Read on every page load, so
    disabling a user or changing their role takes effect right away."""

    def get(self, request):
        user = request.user
        business = user.business
        return Response(
            {
                "user": SessionUserSerializer(user).data,
                "business": BusinessSerializer(business).data if business else None,
            }
        )


class UserViewSet(viewsets.ModelViewSet):
    """Owners manage everyone in their business; managers manage staff at their
    own locations. Nobody changes their own account here."""

    serializer_class = ManagedUserSerializer
    permission_classes = [IsTenantMember, ManagerNeedsPermission]
    manager_permission = "managerUsers"

    def get_queryset(self):
        actor = self.request.user
        qs = User.objects.filter(business=actor.business).prefetch_related("locations")
        if actor.role == User.Role.MANAGER:
            staff = qs.filter(role=User.Role.STAFF, locations__in=actor.locations.all())
            qs = qs.filter(pk__in=staff.values("pk")) | qs.filter(pk=actor.pk)
        return qs.distinct().order_by("date_joined")

    def get_object(self):
        user = super().get_object()
        if self.request.method not in ("GET", "HEAD", "OPTIONS") and user.pk == self.request.user.pk:
            raise PermissionDenied("You can't change your own account here.")
        return user

    def check_permissions(self, request):
        super().check_permissions(request)
        # The users page is behind managerUsers for managers, reads included.
        if request.user.role == User.Role.MANAGER and not request.user.business.permission_on("managerUsers"):
            raise PermissionDenied()


class BusinessSettingsView(APIView):
    """The owner's own business: name, currency, modules and permissions."""

    permission_classes = [IsTenantMember]
    allowed_roles = (User.Role.OWNER,)

    def get(self, request):
        return Response(BusinessSerializer(request.user.business).data)

    def patch(self, request):
        serializer = BusinessSerializer(request.user.business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PlatformBusinessViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Super admin only: every business on the platform."""

    queryset = Business.objects.prefetch_related("users")
    permission_classes = [IsSuperAdmin]
    pagination_class = None

    def get_serializer_class(self):
        return BusinessWithOwnerSerializer if self.action == "create" else BusinessSummarySerializer

    def retrieve(self, request, pk=None):
        business = self.get_object()
        users = business.users.prefetch_related("locations").order_by("date_joined")
        return Response(
            {
                "business": BusinessSummarySerializer(business).data,
                "users": ManagedUserSerializer(users, many=True).data,
                "payments": PaymentSerializer(business.payments.all(), many=True).data,
            }
        )

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        business = self.get_object()
        suspended = request.data.get("suspended", True)
        if not isinstance(suspended, bool):
            return Response({"detail": "suspended must be true or false."}, status=400)
        business.suspended = suspended
        business.save(update_fields=["suspended"])
        return Response(BusinessSummarySerializer(business).data)


class PlatformUserPasswordView(APIView):
    """Super admin resets a business user's password (e.g. a locked-out owner)."""

    permission_classes = [IsSuperAdmin]

    def post(self, request, pk):
        user = User.objects.filter(pk=pk).exclude(role=User.Role.SUPERADMIN).first()
        if not user:
            raise NotFound("Account not found.")
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MerchantAccountView(APIView):
    """Owner only: the business's own SSLCommerz account for online payments at the counter."""

    permission_classes = [IsTenantMember]
    allowed_roles = (User.Role.OWNER,)

    def get(self, request):
        merchant = MerchantAccount.objects.filter(business=request.user.business).first()
        if not merchant:
            return Response({"configured": False})
        return Response({"configured": True, **MerchantAccountSerializer(merchant).data})

    def put(self, request):
        business = request.user.business
        merchant = MerchantAccount.objects.filter(business=business).first()
        serializer = MerchantAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        password = data.get("store_password", "")
        if not merchant and not password:
            return Response({"store_password": ["Enter the store password."]}, status=400)
        merchant = merchant or MerchantAccount(business=business)
        merchant.store_id = data["store_id"].strip()
        merchant.sandbox = data["sandbox"]
        if password:
            merchant.set_password(password)
        merchant.save()
        return Response({"configured": True, **MerchantAccountSerializer(merchant).data})

    def delete(self, request):
        """Removes the account and switches online payments off."""
        business = request.user.business
        MerchantAccount.objects.filter(business=business).delete()
        business.settings.setdefault("payments", {})["online"] = False
        business.save(update_fields=["settings"])
        return Response(status=status.HTTP_204_NO_CONTENT)
