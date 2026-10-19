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
    """Where owners send money by hand, shown on their Billing page. One row, edited by the super admin."""

    bkash = models.CharField(max_length=40, blank=True)
    nagad = models.CharField(max_length=40, blank=True)
    rocket = models.CharField(max_length=40, blank=True)
    # Account name, number, bank and branch, as the owner should see them.
    bank = models.TextField(max_length=500, blank=True)
    # Phone or WhatsApp to call about a payment.
    contact = models.CharField(max_length=100, blank=True)

    @classmethod
    def load(cls):
        return cls.objects.get_or_create(pk=1)[0]

    def __str__(self):
        return "Payment accounts"
