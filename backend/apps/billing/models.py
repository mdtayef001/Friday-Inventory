from django.db import models

from apps.accounts.models import Business


class Payment(models.Model):
    """Months of subscription paid for: online through SSLCommerz, or sent by hand
    (bKash, bank...) and approved by the super admin, who can also give months directly."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        # Sent by hand; waiting for the super admin to check the money arrived.
        AWAITING = "awaiting", "Waiting for approval"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        REJECTED = "rejected", "Rejected"

    class Channel(models.TextChoices):
        ONLINE = "online", "SSLCommerz"
        MANUAL = "manual", "By hand"

    # Our transaction id, sent to SSLCommerz as tran_id.
    tran_id = models.CharField(max_length=64, unique=True)
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="BDT")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.ONLINE)
    months = models.PositiveSmallIntegerField(default=1)
    # e.g. "bKash", "VISA-Dutch Bangla". Filled in once paid.
    method = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    invoice_no = models.CharField(max_length=32, blank=True)
    # SSLCommerz references, kept for support and refunds.
    val_id = models.CharField(max_length=100, blank=True)
    bank_tran_id = models.CharField(max_length=100, blank=True)
    payer_name = models.CharField(max_length=150)
    payer_email = models.EmailField()
    # Not asked for: the owner enters their bKash or card details on SSLCommerz.
    payer_phone = models.CharField(max_length=40, blank=True)
    # Sent by hand: the bKash/Nagad TrxID or bank reference, and the number or account it came from.
    reference = models.CharField(max_length=100, blank=True)
    sent_from = models.CharField(max_length=100, blank=True)
    # The super admin's note, e.g. why it was rejected or what a free month was for.
    note = models.CharField(max_length=300, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tran_id} · {self.business} · {self.status}"


class PaymentAccounts(models.Model):
    """How owners can pay, set once by the super admin and shown on every owner's Billing page.
    One row. A wallet or bank only shows when its section is on and its number is filled in."""

    class Kind(models.TextChoices):
        # What the owner does in their app: Send Money, Cash Out or Payment.
        PERSONAL = "personal", "Personal"
        AGENT = "agent", "Agent"
        MERCHANT = "merchant", "Merchant"

    # What every business pays a month, and how long a new business may use the app free first.
    # Payments already made keep the amount they were made at.
    monthly_price = models.PositiveIntegerField(default=1000)
    trial_days = models.PositiveSmallIntegerField(default=7)

    online_enabled = models.BooleanField(default=True)

    mobile_enabled = models.BooleanField(default=True)
    bkash = models.CharField(max_length=40, blank=True)
    bkash_kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PERSONAL)
    nagad = models.CharField(max_length=40, blank=True)
    nagad_kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PERSONAL)
    rocket = models.CharField(max_length=40, blank=True)
    rocket_kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PERSONAL)
    upay = models.CharField(max_length=40, blank=True)
    upay_kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PERSONAL)

    bank_enabled = models.BooleanField(default=True)
    bank_name = models.CharField(max_length=100, blank=True)
    bank_account_name = models.CharField(max_length=100, blank=True)
    bank_account_number = models.CharField(max_length=40, blank=True)
    bank_branch = models.CharField(max_length=100, blank=True)
    bank_routing = models.CharField(max_length=20, blank=True)

    # Phone or WhatsApp to call about a payment.
    contact = models.CharField(max_length=100, blank=True)

    WALLETS = ("bkash", "nagad", "rocket", "upay")

    @classmethod
    def load(cls):
        return cls.objects.get_or_create(pk=1)[0]

    def wallets(self):
        """The mobile wallets owners can send to right now."""
        if not self.mobile_enabled:
            return []
        return [(w, getattr(self, w), getattr(self, f"{w}_kind")) for w in self.WALLETS if getattr(self, w).strip()]

    def bank_ready(self):
        return self.bank_enabled and bool(self.bank_account_number.strip())

    def __str__(self):
        return "Payment options"
