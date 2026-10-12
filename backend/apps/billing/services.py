"""Subscription payments, ported from frontend/src/lib/billing/payments.ts."""

import secrets

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Business

from .models import Payment


def create_pending_payment(business, payer):
    return Payment.objects.create(
        tran_id=f"FRI{secrets.token_hex(6).upper()}",
        business=business,
        amount=settings.SUBSCRIPTION_PRICE,
        currency=settings.SUBSCRIPTION_CURRENCY,
        payer_name=payer.name,
        payer_email=payer.email,
        payer_phone=payer.phone,
    )


@transaction.atomic
def mark_paid(tran_id, *, val_id, method, bank_tran_id):
    """Only call after SSLCommerz has confirmed the payment. Safe to call twice
    (the success redirect and the IPN both arrive): the second call changes
    nothing. The paid month starts when current access runs out, so paying early
    never loses days."""
    payment = Payment.objects.select_for_update().filter(tran_id=tran_id).first()
    if not payment or payment.status == Payment.Status.PAID:
        return payment
    business = Business.objects.select_for_update().get(pk=payment.business_id)

    now = timezone.now()
    start = max(business.access_ends_at, now)
    end = start + relativedelta(months=1)
    paid_this_year = Payment.objects.filter(status=Payment.Status.PAID, paid_at__year=now.year).count()

    payment.status = Payment.Status.PAID
    payment.paid_at = now
    payment.period_start = start
    payment.period_end = end
    payment.invoice_no = f"INV-{now.year}-{paid_this_year + 1:04d}"
    payment.method = method or "SSLCommerz"
    payment.val_id = val_id
    payment.bank_tran_id = bank_tran_id or ""
    payment.save()
    business.paid_until = end
    business.save(update_fields=["paid_until"])
    return payment


def mark_unpaid(tran_id, status):
    """Failed or cancelled at the gateway. Only a pending payment can change."""
    Payment.objects.filter(tran_id=tran_id, status=Payment.Status.PENDING).update(status=status)
