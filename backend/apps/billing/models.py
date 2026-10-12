from django.db import models

from apps.accounts.models import Business


class Payment(models.Model):
    """One SSLCommerz checkout for a month of subscription."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    # Our transaction id, sent to SSLCommerz as tran_id.
    tran_id = models.CharField(max_length=64, unique=True)
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="BDT")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
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

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tran_id} · {self.business} · {self.status}"
