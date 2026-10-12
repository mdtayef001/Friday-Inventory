from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

# Mirrors frontend/src/lib/types.ts and frontend/src/lib/business.ts.


def default_settings():
    return {
        "currency": "USD",
        "modules": {"rentals": True, "tracking": True, "transfers": True, "trackingLinks": True},
        "permissions": {
            "managerUsers": True,
            "managerActivity": False,
            "managerProducts": True,
            "managerLocations": False,
            "staffCreateProducts": True,
            "managerProfit": False,
        },
    }


def trial_end():
    return timezone.now() + timedelta(days=settings.TRIAL_DAYS)


class Business(models.Model):
    """One tenant. Every inventory row belongs to exactly one business."""

    name = models.CharField(max_length=200)
    industry = models.CharField(max_length=100, blank=True)
    # Set by the super admin. Blocks everyone, even after paying.
    suspended = models.BooleanField(default=False)
    trial_ends_at = models.DateTimeField(default=trial_end)
    # End of the last paid month. Null until the first payment.
    paid_until = models.DateTimeField(null=True, blank=True)
    settings = models.JSONField(default=default_settings)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "businesses"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    @property
    def status(self):
        """trial | active | unpaid | suspended. Worked out from dates, never stored."""
        now = timezone.now()
        if self.suspended:
            return "suspended"
        if self.paid_until and self.paid_until > now:
            return "active"
        if self.trial_ends_at > now:
            return "trial"
        return "unpaid"

    @property
    def access_ends_at(self):
        """End of the trial or of the paid month, whichever is later."""
        if self.paid_until and self.paid_until > self.trial_ends_at:
            return self.paid_until
        return self.trial_ends_at

    @property
    def is_open(self):
        return self.status in ("trial", "active")

    def module_on(self, module):
        return bool(self.settings.get("modules", {}).get(module))

    def permission_on(self, permission):
        return bool(self.settings.get("permissions", {}).get(permission))


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required.")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        """`createsuperuser` makes the platform super admin."""
        extra["role"] = User.Role.SUPERADMIN
        extra["business"] = None
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    """Login is by email. There is no sign-up: owners, managers and the super admin create accounts."""

    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Super admin"
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"
        STAFF = "staff", "Staff"

    username = None
    first_name = None
    last_name = None
    name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    # Null only for the platform super admin.
    business = models.ForeignKey(Business, null=True, blank=True, on_delete=models.CASCADE, related_name="users")
    # Locations this user works at. Empty for owners (they see everything).
    locations = models.ManyToManyField("inventory.Location", blank=True, related_name="users")
    created_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} <{self.email}>"

    @property
    def is_superadmin(self):
        return self.role == self.Role.SUPERADMIN

    def save(self, *args, **kwargs):
        # Super admins get Django admin access; everyone else uses the app only.
        self.is_staff = self.is_superuser = self.role == self.Role.SUPERADMIN
        super().save(*args, **kwargs)
