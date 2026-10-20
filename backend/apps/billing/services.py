"""Subscription payments, ported from frontend/src/lib/billing/payments.ts."""

import secrets

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Business

from .models import Payment, PaymentAccounts


def create_pending_payment(business, payer):
    return Payment.objects.create(
        tran_id=f"FRI{secrets.token_hex(6).upper()}",
        business=business,
        amount=PaymentAccounts.load().monthly_price,
        currency=settings.SUBSCRIPTION_CURRENCY,
        payer_name=payer.name,
        payer_email=payer.email,
        payer_phone=payer.phone,
    )


# Ways to pay by hand. The owner picks the first four; the super admin can also record cash or free months.
MANUAL_METHODS = {
    "bkash": "bKash", "nagad": "Nagad", "rocket": "Rocket", "upay": "Upay", "bank": "Bank transfer", "cash": "Cash", "free": "Free",
}
OWNER_METHODS = ("bkash", "nagad", "rocket", "upay", "bank")


def open_methods(accounts):
    """The ways an owner can send money by hand right now, as the super admin set them."""
    methods = {w for w, _, _ in accounts.wallets()}
    if accounts.bank_ready():
        methods.add("bank")
    return methods


def _activate(payment, *, method):
    """Marks a payment paid and moves the business's paid-until on by its months.
    The months start when current access runs out, so paying early never loses days.
    Call inside a transaction, with the payment locked."""
    business = Business.objects.select_for_update().get(pk=payment.business_id)
    now = timezone.now()
    start = max(business.access_ends_at, now)
    end = start + relativedelta(months=payment.months)
    paid_this_year = Payment.objects.filter(status=Payment.Status.PAID, paid_at__year=now.year).count()

    payment.status = Payment.Status.PAID
    payment.paid_at = now
    payment.period_start = start
    payment.period_end = end
    payment.invoice_no = f"INV-{now.year}-{paid_this_year + 1:04d}"
    payment.method = method
    payment.save()
    business.paid_until = end
    business.cancelled_at = None  # paying again means they're staying
    business.save(update_fields=["paid_until", "cancelled_at"])
    return payment


@transaction.atomic
def mark_paid(tran_id, *, val_id, method, bank_tran_id):
    """Only call after SSLCommerz has confirmed the payment. Safe to call twice
    (the success redirect and the IPN both arrive): the second call changes nothing."""
    payment = Payment.objects.select_for_update().filter(tran_id=tran_id).first()
    if not payment or payment.status == Payment.Status.PAID:
        return payment
    payment.val_id = val_id
    payment.bank_tran_id = bank_tran_id or ""
    return _activate(payment, method=method or "SSLCommerz")


class PaymentError(Exception):
    pass


def submit_manual(business, payer, *, method, months, reference, sent_from):
    """The owner sent money by hand. It waits for the super admin to check it arrived."""
    if method not in open_methods(PaymentAccounts.load()):
        raise PaymentError("This way of paying isn't available right now. Pick another, or contact support.")
    reference = reference.strip()
    taken = Payment.objects.filter(
        channel=Payment.Channel.MANUAL,
        method=MANUAL_METHODS[method],
        reference__iexact=reference,
        status__in=[Payment.Status.AWAITING, Payment.Status.PAID],
    )
    if taken.exists():
        raise PaymentError("This transaction ID has already been sent. If you think that's wrong, contact support.")
    return Payment.objects.create(
        tran_id=f"FRI{secrets.token_hex(6).upper()}",
        business=business,
        amount=PaymentAccounts.load().monthly_price * months,
        currency=settings.SUBSCRIPTION_CURRENCY,
        status=Payment.Status.AWAITING,
        channel=Payment.Channel.MANUAL,
        months=months,
        method=MANUAL_METHODS[method],
        reference=reference,
        sent_from=sent_from.strip(),
        payer_name=payer.name,
        payer_email=payer.email,
        payer_phone=payer.phone,
    )


@transaction.atomic
def approve(payment_id):
    """The super admin saw the money arrive. Only a payment waiting for approval changes."""
    payment = Payment.objects.select_for_update().filter(pk=payment_id).first()
    if not payment or payment.status != Payment.Status.AWAITING:
        raise PaymentError("This payment isn't waiting for approval.")
    payment.reviewed_at = timezone.now()
    return _activate(payment, method=payment.method)


def reject(payment_id, note):
    updated = Payment.objects.filter(pk=payment_id, status=Payment.Status.AWAITING).update(
        status=Payment.Status.REJECTED, note=note.strip(), reviewed_at=timezone.now()
    )
    if not updated:
        raise PaymentError("This payment isn't waiting for approval.")
    return Payment.objects.get(pk=payment_id)


@transaction.atomic
def grant(business, *, months, amount, method, reference="", note=""):
    """The super admin gives months directly: paid by bank or cash after calling them, or free."""
    owner = business.main_owner()
    payment = Payment.objects.create(
        tran_id=f"FRI{secrets.token_hex(6).upper()}",
        business=business,
        amount=0 if method == "free" else amount,
        currency=settings.SUBSCRIPTION_CURRENCY,
        status=Payment.Status.AWAITING,
        channel=Payment.Channel.MANUAL,
        months=months,
        reference=reference.strip(),
        note=note.strip(),
        reviewed_at=timezone.now(),
        payer_name=owner.name if owner else business.name,
        payer_email=owner.email if owner else "",
    )
    return _activate(Payment.objects.select_for_update().get(pk=payment.pk), method=MANUAL_METHODS[method])


def mark_unpaid(tran_id, status):
    """Failed or cancelled at the gateway. Only a pending payment can change."""
    Payment.objects.filter(tran_id=tran_id, status=Payment.Status.PENDING).update(status=status)
