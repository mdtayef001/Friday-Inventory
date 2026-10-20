import hmac
import time

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.management import call_command
from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework.exceptions import NotFound, PermissionDenied, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.billing import services as billing_services
from apps.billing.serializers import GrantSerializer, PaymentSerializer
from apps.billing.views import IsOwner
from apps.inventory.export import business_zip
from apps.inventory.services import log

from .models import Business, DeletedBusiness, User
from .permissions import IsSuperAdmin, IsTenantMember, ManagerNeedsPermission
from .serializers import (
    BusinessSerializer,
    BusinessSummarySerializer,
    BusinessWithOwnerSerializer,
    LoginSerializer,
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


class PasswordResetThrottle(LoginThrottle):
    scope = "password_reset"


class PasswordResetView(APIView):
    """Forgot password: emails a link to set a new one. Always answers the same, so it
    can't be used to find out which emails have accounts."""

    authentication_classes = []
    permission_classes = []
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        user = User.objects.filter(email=email, is_active=True).first() if email else None
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={default_token_generator.make_token(user)}"
            send_mail(
                "Set a new password for Friday Inventory",
                f"Hi {user.name},\n\nSomeone asked to reset the password for {user.email}. If it was you, open this link "
                f"within 3 days to choose a new one:\n\n{link}\n\nIf it wasn't you, ignore this email. Your password stays the same.",
                None,
                [user.email],
                fail_silently=False,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(APIView):
    """Sets the new password from the emailed link, and logs the account out everywhere else."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            user = User.objects.get(pk=urlsafe_base64_decode(str(request.data.get("uid", ""))).decode(), is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist):
            user = None
        if not user or not default_token_generator.check_token(user, str(request.data.get("token", ""))):
            raise ValidationError({"token": "This link has expired or was already used. Ask for a new one."})
        serializer = PasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            validate_password(serializer.validated_data["password"], user)
        except DjangoValidationError as err:
            raise ValidationError({"password": err.messages}) from err
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutView(APIView):
    """Blacklists the refresh token so it can't be used again."""

    permission_classes = []

    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class CronCleanupView(APIView):
    """Daily job (Vercel Cron, see vercel.json): deletes expired login tokens so the
    blacklist tables don't grow forever. Vercel sends CRON_SECRET as a Bearer token."""

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        sent = request.headers.get("Authorization", "")
        if not settings.CRON_SECRET or not hmac.compare_digest(sent, f"Bearer {settings.CRON_SECRET}"):
            raise NotFound()
        call_command("flushexpiredtokens")
        # Approved deletions whose 30 days are up.
        for business in Business.objects.filter(deletion_approved_at__isnull=False):
            if business.delete_on <= timezone.now():
                DeletedBusiness.record(business)
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
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            if user.pk == self.request.user.pk:
                raise PermissionDenied("You can't change your own account here.")
            # Admins have the Owner's access, but not over the Owner or other admins.
            if user.role == User.Role.OWNER and not self.request.user.is_main_owner:
                raise PermissionDenied("Only the owner can change the owner's or an admin's account.")
        return user

    def check_permissions(self, request):
        super().check_permissions(request)
        # The users page is behind managerUsers for managers, reads included.
        if request.user.role == User.Role.MANAGER and not request.user.business.permission_on("managerUsers"):
            raise PermissionDenied()


def zip_response(business):
    data, filename = business_zip(business)
    response = HttpResponse(data, content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


class BusinessExportView(APIView):
    """The owner downloads everything their business has, even while it's locked for not paying.
    Once every 10 minutes per business, so repeated clicks can't keep the server busy."""

    permission_classes = [IsOwner]
    EVERY = 10 * 60

    def get(self, request):
        key = f"data-export:{request.user.business_id}"
        if not cache.add(key, time.time(), self.EVERY):
            wait = max(1, round((self.EVERY - (time.time() - cache.get(key, time.time()))) / 60))
            raise Throttled(detail=f"You downloaded your data a few minutes ago. Try again in {wait} minute{'s' if wait != 1 else ''}.")
        log(request.user, "Data downloaded", "Everything, as a ZIP of spreadsheets")
        return zip_response(request.user.business)


class SubscriptionView(APIView):
    """The owner cancels (nothing renews, no reminders, access runs to the end of what's paid) or resumes."""

    permission_classes = [IsOwner]

    def post(self, request):
        cancelled = request.data.get("cancelled")
        if not isinstance(cancelled, bool):
            raise ValidationError({"cancelled": "Send true or false."})
        business = request.user.business
        if cancelled != bool(business.cancelled_at):
            business.cancelled_at = timezone.now() if cancelled else None
            business.save(update_fields=["cancelled_at"])
            ends = timezone.localtime(business.access_ends_at).strftime("%b %d, %Y")
            log(request.user, "Subscription cancelled" if cancelled else "Subscription resumed", f"Access runs to {ends}")
        return Response(BusinessSerializer(business).data)


class DeletionRequestView(APIView):
    """The Owner asks for the business to be deleted (typing its name to be sure), or takes it back.
    The super admin approves it; it's deleted 30 days after that."""

    permission_classes = [IsOwner]

    def post(self, request):
        user, business = request.user, request.user.business
        if not user.is_main_owner:
            raise PermissionDenied("Only the Owner can ask for the business to be deleted.")
        if request.data.get("name", "").strip().lower() != business.name.strip().lower():
            raise ValidationError({"name": "Type the business name exactly as it's shown."})
        if not business.deletion_requested_at:
            business.deletion_requested_at, business.deletion_requested_by = timezone.now(), user
            business.save(update_fields=["deletion_requested_at", "deletion_requested_by"])
            log(user, "Deletion requested", "Waiting for approval")
        return Response(BusinessSerializer(business).data)

    def delete(self, request):
        business = request.user.business
        if business.deletion_requested_at:
            business.clear_deletion()
            log(request.user, "Deletion cancelled", "The business stays")
        return Response(BusinessSerializer(business).data)


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
    def grant(self, request, pk=None):
        """Give months of access by hand: paid by bank or cash, or free."""
        serializer = GrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = billing_services.grant(self.get_object(), **serializer.validated_data)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="approve-deletion")
    def approve_deletion(self, request, pk=None):
        """Locks the business now; it's deleted 30 days later unless someone stops it."""
        business = self.get_object()
        if not business.deletion_requested_at:
            raise ValidationError("The owner hasn't asked for this business to be deleted.")
        if not business.deletion_approved_at:
            business.deletion_approved_at = timezone.now()
            business.save(update_fields=["deletion_approved_at"])
        return Response(BusinessSummarySerializer(business).data)

    @action(detail=True, methods=["post"], url_path="stop-deletion")
    def stop_deletion(self, request, pk=None):
        """Turns down a request, or stops an approved deletion before its day."""
        business = self.get_object()
        business.clear_deletion()
        return Response(BusinessSummarySerializer(business).data)

    def perform_destroy(self, business):
        DeletedBusiness.record(business)

    @action(detail=True)
    def export(self, request, pk=None):
        """Everything the business has, for an owner who asks for it."""
        return zip_response(self.get_object())

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
