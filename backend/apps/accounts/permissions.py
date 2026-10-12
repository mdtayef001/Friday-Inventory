"""Role rules. Mirrors frontend/src/lib/auth/roles.ts, so a route the
frontend hides is also refused here."""

from rest_framework.permissions import BasePermission

from .models import User

TEAM = (User.Role.OWNER, User.Role.MANAGER, User.Role.STAFF)
LEADS = (User.Role.OWNER, User.Role.MANAGER)


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_superadmin


class IsTenantMember(BasePermission):
    """A logged-in user of a business that is open (in trial or paid up).

    Views narrow this further with `allowed_roles`, `module` and
    `manager_permission` attributes.
    """

    message = "Your business is locked. The owner needs to renew the subscription."

    def has_permission(self, request, view):
        user = request.user
        if not (user.is_authenticated and user.business_id and user.role in TEAM):
            return False
        business = user.business
        if not business.is_open:
            return False

        roles = getattr(view, "allowed_roles", LEADS)
        if user.role not in roles:
            return False
        module = getattr(view, "module", None)
        if module and not business.module_on(module):
            return False
        return True


class ManagerNeedsPermission(BasePermission):
    """Writes by managers need the owner's switch named by `view.manager_permission`."""

    def has_permission(self, request, view):
        permission = getattr(view, "manager_permission", None)
        if not permission or request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        if request.user.role == User.Role.MANAGER:
            return request.user.business.permission_on(permission)
        return True


def creatable_roles(role):
    """Which roles a user of `role` may create inside their business."""
    if role == User.Role.OWNER:
        return [User.Role.OWNER, User.Role.MANAGER, User.Role.STAFF]
    if role == User.Role.MANAGER:
        return [User.Role.STAFF]
    return []


def allowed_location_ids(user):
    """None means every location (owners). Otherwise the user's assigned locations."""
    if user.role == User.Role.OWNER:
        return None
    return set(user.locations.values_list("id", flat=True))
