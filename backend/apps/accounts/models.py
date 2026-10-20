from datetime import timedelta

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

# Mirrors frontend/src/lib/types.ts and frontend/src/lib/business.ts.


def default_settings():
    return {
        "currency": "BDT",
        "modules": {"rentals": True, "tracking": True, "transfers": True, "trackingLinks": True, "purchases": True},
        "permissions": {
            "managerUsers": True,
            "managerActivity": False,
            "managerProducts": True,
            "managerLocations": False,
            "staffCreateProducts": True,
            "managerProfit": False,
            "managerPurchases": False,
            "managerReturns": False,
        },
        # How customers can pay. Cash always works; the rest are the owner's choice.
        "payments": {"mobile": False, "card": False},
        # The owner's own line at the bottom of every receipt, e.g. the return policy.
        "receiptNote": "",
        # The low-stock alert new products start with.
        "lowStockAlert": 5,
    }


# After the super admin approves a deletion, the business is locked this long before it's
# deleted for good, so the owner can still download their data or change their mind.
DELETION_GRACE_DAYS = 30


def trial_end():
    from apps.billing.models import PaymentAccounts  # billing imports this module

    return timezone.now() + timedelta(days=PaymentAccounts.load().trial_days)


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
    # The owner cancelled: nothing renews and no reminders show, but what's paid for runs to its end.
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Deleting the business: the Owner asks, the super admin approves, and it's deleted
    # DELETION_GRACE_DAYS later. Either of them can stop it until then.
    deletion_requested_at = models.DateTimeField(null=True, blank=True)
    deletion_requested_by = models.ForeignKey("User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    deletion_approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "businesses"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    def main_owner(self):
        """The Owner: the business's first owner account. Any later ones are admins,
        with the same access except over the Owner and other admins."""
        return self.users.filter(role=User.Role.OWNER).order_by("date_joined", "id").first()

    @property
    def delete_on(self):
        """When an approved deletion happens."""
        return self.deletion_approved_at + timedelta(days=DELETION_GRACE_DAYS) if self.deletion_approved_at else None

    def clear_deletion(self):
        self.deletion_requested_at = self.deletion_requested_by = self.deletion_approved_at = None
        self.save(update_fields=["deletion_requested_at", "deletion_requested_by", "deletion_approved_at"])

    @property
    def status(self):
        """trial | active | unpaid | closing | suspended. Worked out from dates, never stored.
        Closing: a deletion was approved, so it's locked until it's deleted."""
        now = timezone.now()
        if self.suspended:
            return "suspended"
        if self.deletion_approved_at:
            return "closing"
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

    @property
    def low_stock_alert(self):
        return self.settings.get("lowStockAlert", 5)

    @property
    def receipt_note(self):
        return self.settings.get("receiptNote", "")


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
    # Per-person rights for staff, set by the owner or their manager. Owners and managers can always do all of them.
    can_sell = models.BooleanField(default=True)
    can_add_stock = models.BooleanField(default=True)
    # Renting out and taking back is riskier than selling (deposits, IDs, items coming back), so it's off until given.
    can_rent = models.BooleanField(default=False)

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

    @property
    def is_main_owner(self):
        if self.role != self.Role.OWNER or not self.business_id:
            return False
        main = self.business.main_owner()
        return main is not None and main.pk == self.pk

    @property
    def may_sell(self):
        return self.role != self.Role.STAFF or self.can_sell

    @property
    def may_add_stock(self):
        return self.role != self.Role.STAFF or self.can_add_stock

    @property
    def may_rent(self):
        return self.role != self.Role.STAFF or self.can_rent

    def save(self, *args, **kwargs):
        # Super admins get Django admin access; everyone else uses the app only.
        self.is_staff = self.is_superuser = self.role == self.Role.SUPERADMIN
        super().save(*args, **kwargs)


class DeletedBusiness(models.Model):
    """What's kept after a business is deleted: proof of who asked and when, nothing of its data."""

    name = models.CharField(max_length=200)
    owner_email = models.EmailField(blank=True)
    requested_by = models.EmailField(blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-deleted_at"]

    def __str__(self):
        return f"{self.name} (deleted {self.deleted_at:%Y-%m-%d})"

    @classmethod
    def record(cls, business):
        """Writes the record, then deletes the business and everything in it."""
        owner = business.main_owner()
        cls.objects.create(
            name=business.name,
            owner_email=owner.email if owner else "",
            requested_by=business.deletion_requested_by.email if business.deletion_requested_by else "",
            requested_at=business.deletion_requested_at,
            approved_at=business.deletion_approved_at,
        )
        business.delete()
