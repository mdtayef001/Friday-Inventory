from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Business, User
from .permissions import IsSuperAdmin, IsTenantMember, ManagerNeedsPermission
from .serializers import (
    BusinessSerializer,
    BusinessWithOwnerSerializer,
    LoginSerializer,
    ManagedUserSerializer,
    SessionUserSerializer,
)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(APIView):
    """Blacklists the refresh token so it can't be used again."""

    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        data = SessionUserSerializer(request.user).data
        if request.user.business:
            data["business"] = BusinessSerializer(request.user.business).data
        return Response(data)


class UserViewSet(viewsets.ModelViewSet):
    """Owners manage everyone in their business; managers manage staff only."""

    serializer_class = ManagedUserSerializer
    permission_classes = [IsTenantMember, ManagerNeedsPermission]
    manager_permission = "managerUsers"

    def get_queryset(self):
        actor = self.request.user
        qs = User.objects.filter(business=actor.business).prefetch_related("locations")
        if actor.role == User.Role.MANAGER:
            qs = qs.filter(role=User.Role.STAFF, locations__in=actor.locations.all()).distinct()
        return qs

    def perform_destroy(self, user):
        # Keep the row for the activity log; just switch the login off.
        user.is_active = False
        user.save(update_fields=["is_active"])


class BusinessSettingsView(APIView):
    """The owner's own business: name, currency, modules and permissions."""

    permission_classes = [IsAuthenticated, IsTenantMember]
    allowed_roles = (User.Role.OWNER,)

    def get(self, request):
        return Response(BusinessSerializer(request.user.business).data)

    def patch(self, request):
        serializer = BusinessSerializer(request.user.business, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PlatformBusinessViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """Super admin only: every business on the platform."""

    queryset = Business.objects.all()
    permission_classes = [IsSuperAdmin]

    def get_serializer_class(self):
        return BusinessWithOwnerSerializer if self.action == "create" else BusinessSerializer

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        business = self.get_object()
        business.suspended = bool(request.data.get("suspended", True))
        business.save(update_fields=["suspended"])
        return Response(BusinessSerializer(business).data)
