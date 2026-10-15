"""Every stock-changing action lives here. The frontend calls them through frontend/src/lib/data/actions.ts.

Each function runs in a transaction and locks the stock rows it touches, so two
people selling the last item at the same time can't both succeed. Errors are
raised as ValidationError with a readable message the frontend shows as a toast.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Business

from .models import Activity, Rental, Sale, Shipment, ShipmentEvent, StockLevel, StockRequest, Transfer


def ref_code(prefix):
    return f"{prefix}-{secrets.token_hex(3).upper()}"


def log(user, action, detail=""):
    Activity.objects.create(business=user.business, user=user, action=action, detail=detail[:500])


def change_stock(product, location, delta):
    """Add (or remove, with a negative delta) stock. Call inside a transaction."""
    if product is None or location is None:
        raise ValidationError("The product or location no longer exists.")
    row, _ = StockLevel.objects.select_for_update().get_or_create(
        business_id=product.business_id, product=product, location=location
    )
    if row.quantity + delta < 0:
        raise ValidationError(f"Not enough stock: only {row.quantity} available at {location.name}.")
    row.quantity += delta
    if row.quantity == 0:
        row.delete()
    else:
        row.save(update_fields=["quantity"])


@transaction.atomic
def adjust_stock(user, product, location, delta, reason=""):
    if delta == 0:
        raise ValidationError("Enter a whole number that isn't 0.")
    change_stock(product, location, delta)
    sign = "+" if delta > 0 else ""
    log(
        user,
        "Stock added" if delta > 0 else "Stock removed",
        f"{sign}{delta} {product.name} at {location.name}" + (f" · {reason}" if reason else ""),
    )


@transaction.atomic
def add_product(user, product, initial_location=None, initial_quantity=0):
    if initial_location and initial_quantity > 0:
        change_stock(product, initial_location, initial_quantity)
        log(user, "Product added", f"{product.name} · {initial_quantity} {product.unit} at {initial_location.name}")
    else:
        log(user, "Product added", product.name)
    return product


def check_product_deletable(product):
    if Rental.objects.filter(product=product, status=Rental.Status.ACTIVE).exists():
        raise ValidationError("This product has active rentals. Return them first.")
    open_shipments = Shipment.objects.filter(product=product).exclude(
        status__in=[Shipment.Status.DELIVERED, *Shipment.RESTOCKED]
    )
    if open_shipments.exists():
        raise ValidationError("This product has open shipments. Finish or cancel them first.")
    if Transfer.objects.filter(product=product, status=Transfer.Status.IN_TRANSIT).exists():
        raise ValidationError("This product has transfers in transit.")


def check_location_deletable(location):
    if StockLevel.objects.filter(location=location).exists():
        raise ValidationError("This location still has stock. Move or remove it first.")
    if Rental.objects.filter(location=location, status=Rental.Status.ACTIVE).exists():
        raise ValidationError("This location has active rentals.")
    in_transit = Transfer.objects.filter(status=Transfer.Status.IN_TRANSIT)
    if in_transit.filter(from_location=location).exists() or in_transit.filter(to_location=location).exists():
        raise ValidationError("This location has transfers in transit.")


def check_client_deletable(client):
    if client.rentals.filter(status=Rental.Status.ACTIVE).exists():
        raise ValidationError("This client has active rentals.")
    if client.shipments.exclude(status__in=[Shipment.Status.DELIVERED, *Shipment.RESTOCKED]).exists():
        raise ValidationError("This client has open shipments.")


# ---------- Shipments ----------


@transaction.atomic
def create_shipment(user, *, product, quantity, client, from_location, notes="", unit_price=None):
    change_stock(product, from_location, -quantity)
    shipment = Shipment.objects.create(
        business=user.business,
        code=ref_code("SHP"),
        product=product,
        quantity=quantity,
        client=client,
        from_location=from_location,
        notes=notes,
        # The price agreed now is what the sale records on delivery.
        unit_price=product.price if unit_price is None else unit_price,
        unit_cost=product.cost,
    )
    ShipmentEvent.objects.create(shipment=shipment, status=shipment.status, by=user)
    log(user, "Shipment created", f"{shipment.code} · {quantity} × {product.name} to {client.name}")
    return shipment


@transaction.atomic
def set_shipment_status(user, shipment, status, note="", payment_method=Sale.Method.CASH):
    """`payment_method` is how the client paid, recorded when the order is delivered."""
    shipment = Shipment.objects.select_for_update().get(pk=shipment.pk)
    if shipment.status in Shipment.RESTOCKED:
        raise ValidationError("This shipment is closed.")
    if shipment.status == status:
        return shipment
    if status in Shipment.RESTOCKED:
        change_stock(shipment.product, shipment.from_location, shipment.quantity)
    was_delivered = shipment.status == Shipment.Status.DELIVERED
    shipment.status = status
    shipment.save(update_fields=["status"])
    if status == Shipment.Status.DELIVERED:
        record_order_sale(user, shipment, payment_method)
    elif was_delivered:
        refund_order_sale(shipment)
    ShipmentEvent.objects.create(shipment=shipment, status=status, by=user, note=note)
    log(user, "Shipment updated", f"{shipment.code} → {shipment.get_status_display()}")
    return shipment


# ---------- Rentals ----------


@transaction.atomic
def create_rental(user, *, product, quantity, client, location, start_date, plan, rate, days=None, deposit=0, notes=""):
    """Scan out: the item leaves stock now. The price is settled when it comes back."""
    if not product.rentable:
        raise ValidationError("This product isn't marked as rentable.")
    change_stock(product, location, -quantity)
    rental = Rental.objects.create(
        business=user.business,
        code=ref_code("RNT"),
        product=product,
        quantity=quantity,
        client=client,
        location=location,
        start_date=start_date,
        days=days,
        plan=plan,
        rate=rate,
        deposit=deposit,
        # An estimate until it's returned: the expected days, or one day/period.
        total=Rental.quote(plan, rate, days or 1, quantity),
        notes=notes,
    )
    log(user, "Rental out", f"{rental.code} · {quantity} × {product.name} to {client.name}")
    return rental


@transaction.atomic
def return_rental(user, rental, holidays=0, payment_method=Sale.Method.CASH):
    """Scan in: count the days it was out, take off holidays (per-day plan only), price it, restock."""
    rental = Rental.objects.select_for_update().get(pk=rental.pk)
    if rental.status != Rental.Status.ACTIVE:
        raise ValidationError("This rental was already returned.")
    now = timezone.now()
    days_out = Rental.count_days(rental.start_date, now)
    if rental.plan != Rental.Plan.DAILY:
        holidays = 0
    if holidays < 0 or holidays >= days_out:
        raise ValidationError(f"Holidays must be fewer than the {days_out} days it was out.")
    change_stock(rental.product, rental.location, rental.quantity)
    rental.status = Rental.Status.RETURNED
    rental.returned_at = now
    rental.days_out = days_out
    rental.holidays = holidays
    rental.total = Rental.quote(rental.plan, rental.rate, days_out, rental.quantity, holidays)
    rental.save(update_fields=["status", "returned_at", "days_out", "holidays", "total"])
    log(user, "Rental returned", f"{rental.code} · {days_out} days" + (f" − {holidays} holidays" if holidays else ""))
    record_rental_income(user, rental, payment_method)
    return rental


# ---------- Transfers ----------


@transaction.atomic
def create_transfer(user, *, product, quantity, from_location, to_location):
    if from_location == to_location:
        raise ValidationError("Pick two different locations.")
    change_stock(product, from_location, -quantity)
    transfer = Transfer.objects.create(
        business=user.business,
        code=ref_code("TRF"),
        product=product,
        quantity=quantity,
        from_location=from_location,
        to_location=to_location,
        created_by=user,
    )
    log(user, "Transfer sent", f"{transfer.code} · {quantity} × {product.name} {from_location.name} → {to_location.name}")
    return transfer


def _close_transfer(user, transfer, status):
    transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.status != Transfer.Status.IN_TRANSIT:
        raise ValidationError("This transfer is already closed.")
    target = transfer.to_location if status == Transfer.Status.RECEIVED else transfer.from_location
    change_stock(transfer.product, target, transfer.quantity)
    transfer.status = status
    if status == Transfer.Status.RECEIVED:
        transfer.received_at = timezone.now()
    transfer.save(update_fields=["status", "received_at"])
    return transfer


@transaction.atomic
def receive_transfer(user, transfer):
    transfer = _close_transfer(user, transfer, Transfer.Status.RECEIVED)
    log(user, "Transfer received", transfer.code)
    return transfer


@transaction.atomic
def cancel_transfer(user, transfer):
    transfer = _close_transfer(user, transfer, Transfer.Status.CANCELLED)
    log(user, "Transfer cancelled", transfer.code)
    return transfer


# ---------- Sales ----------
# Every sale freezes the price and cost at that moment. Created in the same
# transaction as the stock change it belongs to.


def enabled_methods(business):
    """How this business lets customers pay. Cash always works."""
    payments = business.settings.get("payments", {})
    methods = {Sale.Method.CASH}
    if payments.get("mobile"):
        methods.add(Sale.Method.MOBILE)
    if payments.get("card"):
        methods.add(Sale.Method.CARD)
    if payments.get("online") and hasattr(business, "merchant"):
        methods.add(Sale.Method.ONLINE)
    return methods


def number_receipt(sale):
    """Gives a paid sale the business's next receipt number. Call inside a transaction.
    Locking the business row makes two sales at the same moment wait for each other."""
    Business.objects.select_for_update().filter(pk=sale.business_id).first()
    last = Sale.objects.filter(business_id=sale.business_id).aggregate(n=Max("receipt_no"))["n"] or 0
    sale.receipt_no = last + 1
    sale.save(update_fields=["receipt_no"])
    return sale


@transaction.atomic
def sell(user, *, product, location, quantity, unit_price, discount=0, client=None, payment_method=Sale.Method.CASH, payment_reference=""):
    """A walk-in sale at a shop: takes the stock and records the money. An online
    payment waits for SSLCommerz: the stock is held, and the sale only counts once paid."""
    if discount > unit_price * quantity:
        raise ValidationError("The discount can't be more than the total.")
    if payment_method not in enabled_methods(user.business):
        raise ValidationError("This payment method isn't turned on for your business.")
    # The same transaction ID twice is an old payment shown again.
    if payment_reference and Sale.objects.filter(business=user.business, payment_reference__iexact=payment_reference).exists():
        raise ValidationError("This transaction ID is already on another sale.")
    online = payment_method == Sale.Method.ONLINE
    change_stock(product, location, -quantity)
    sale = Sale.objects.create(
        payment_method=payment_method,
        payment_reference=payment_reference,
        payment_status=Sale.PaymentStatus.PENDING if online else Sale.PaymentStatus.PAID,
        tran_id=f"FRS{secrets.token_hex(8).upper()}" if online else None,
        business=user.business,
        channel=Sale.Channel.STORE,
        product=product,
        product_name=product.name,
        quantity=quantity,
        unit_price=unit_price,
        unit_cost=product.cost,
        discount=discount,
        location=location,
        client=client,
        sold_by=user,
    )
    if not online:
        number_receipt(sale)
    if online:
        log(user, "Online payment started", f"{quantity} × {product.name} at {location.name} for {sale.revenue:.2f}")
    else:
        log(user, "Sold", f"{quantity} × {product.name} at {location.name} for {sale.revenue:.2f} ({sale.get_payment_method_display()})")
    return sale


# ---------- Online payments at the counter (the business's own SSLCommerz account) ----------

PENDING_MINUTES = 30


def open_online_payment(sale):
    """Starts the SSLCommerz checkout for a waiting sale. Returns (url, error)."""
    from apps.billing import sslcommerz

    account = sslcommerz.merchant_account(sale.business)
    if not account:
        return None, "Online payments aren't set up. The owner adds the SSLCommerz account in Business Settings."
    client = sale.client
    return sslcommerz.open_session(
        account,
        tran_id=sale.tran_id,
        amount=sale.revenue,
        currency=sale.business.settings.get("currency", "BDT"),
        callback_base=f"{settings.FRONTEND_URL.rstrip('/')}/api/sale-payments/sslcommerz",
        customer={
            "name": client.name if client else "",
            "email": client.email if client else "",
            "phone": client.phone if client else "",
            "address": client.address if client else sale.business.name,
        },
        product_name=f"{sale.quantity} x {sale.product_name}",
        product_category="Retail",
        value_a=str(sale.business_id),
    )


@transaction.atomic
def confirm_online_payment(tran_id, val_id):
    """Called with what SSLCommerz posted back. Only marks the sale paid after
    SSLCommerz confirms it directly. Safe to call twice (redirect and IPN)."""
    from apps.billing import sslcommerz

    sale = Sale.objects.select_for_update().select_related("business").filter(tran_id=tran_id).first()
    if not sale:
        return None
    if sale.payment_status != Sale.PaymentStatus.PENDING:
        return sale
    account = sslcommerz.merchant_account(sale.business)
    if not account:
        return sale
    ok, method, bank_tran_id = sslcommerz.check(
        account, val_id, tran_id=tran_id, amount=sale.revenue, currency=sale.business.settings.get("currency", "BDT")
    )
    if ok:
        sale.payment_status = Sale.PaymentStatus.PAID
        sale.gateway_method = method
        sale.val_id = val_id
        sale.bank_tran_id = bank_tran_id
        sale.save(update_fields=["payment_status", "gateway_method", "val_id", "bank_tran_id"])
        number_receipt(sale)
        Activity.objects.create(business=sale.business, user=sale.sold_by, action="Paid online", detail=f"{sale.quantity} × {sale.product_name} · {method}")
    return sale


@transaction.atomic
def release_online_payment(sale, status=Sale.PaymentStatus.CANCELLED):
    """The payment failed, was cancelled, or ran out of time: put the stock back."""
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.payment_status != Sale.PaymentStatus.PENDING:
        return sale
    if sale.product and sale.location:
        change_stock(sale.product, sale.location, sale.quantity)
    sale.payment_status = status
    sale.save(update_fields=["payment_status"])
    return sale


def expire_online_payments(business):
    """Online payments nobody finished within 30 minutes give their stock back."""
    cutoff = timezone.now() - timedelta(minutes=PENDING_MINUTES)
    for sale in Sale.objects.filter(business=business, payment_status=Sale.PaymentStatus.PENDING, sold_at__lt=cutoff):
        release_online_payment(sale)


def record_order_sale(user, shipment, payment_method=Sale.Method.CASH):
    """A delivered order becomes a sale at the price agreed when it was placed."""
    existing = Sale.objects.filter(shipment=shipment).first()
    if existing:
        if existing.refunded_at:
            existing.refunded_at = None
            existing.save(update_fields=["refunded_at"])
        return existing
    product = shipment.product
    sale = Sale.objects.create(
        business_id=shipment.business_id,
        channel=Sale.Channel.ORDER,
        product=product,
        product_name=product.name if product else "Deleted product",
        quantity=shipment.quantity,
        # Orders placed before sales tracking have no agreed price: use today's.
        unit_price=shipment.unit_price if shipment.unit_price is not None else (product.price if product else 0),
        unit_cost=shipment.unit_cost if shipment.unit_cost is not None else (product.cost if product else 0),
        location=shipment.from_location,
        client=shipment.client,
        shipment=shipment,
        sold_by=user,
        payment_method=payment_method,
    )
    return number_receipt(sale)


def refund_order_sale(shipment):
    """The goods came back: the sale no longer counts."""
    Sale.objects.filter(shipment=shipment, refunded_at__isnull=True).update(refunded_at=timezone.now())


def record_rental_income(user, rental, payment_method=Sale.Method.CASH):
    """Rental money counts when the item comes back. Recorded as one line for the
    whole rental; there's no purchase cost, so it's all profit."""
    product = rental.product
    name = product.name if product else "Deleted product"
    sale = Sale.objects.create(
        business_id=rental.business_id,
        channel=Sale.Channel.RENTAL,
        product=product,
        product_name=f"{name} × {rental.quantity} ({rental.days_out or rental.days} day rental)",
        quantity=1,
        unit_price=rental.total,
        unit_cost=0,
        location=rental.location,
        client=rental.client,
        rental=rental,
        sold_by=user,
        payment_method=payment_method,
    )
    return number_receipt(sale)


# ---------- Stock requests ----------


def request_stock(user, *, product, quantity, to_location, note=""):
    req = StockRequest.objects.create(
        business=user.business,
        code=ref_code("REQ"),
        product=product,
        quantity=quantity,
        to_location=to_location,
        note=note,
        requested_by=user,
    )
    log(user, "Stock requested", f"{req.code} · {quantity} × {product.name} for {to_location.name}")
    return req


def _decide(user, req, status, note=""):
    req = StockRequest.objects.select_for_update().get(pk=req.pk)
    if req.status != StockRequest.Status.PENDING:
        raise ValidationError("This request was already handled.")
    req.status = status
    req.decided_by = user
    req.decided_at = timezone.now()
    req.decision_note = note
    return req


@transaction.atomic
def approve_request(user, req, *, from_location, quantity=None, note=""):
    """Sends the stock: creates the transfer from the chosen warehouse or shop."""
    req = _decide(user, req, StockRequest.Status.APPROVED, note)
    if req.product is None or req.to_location is None:
        raise ValidationError("The product or shop no longer exists.")
    req.transfer = create_transfer(
        user, product=req.product, quantity=quantity or req.quantity, from_location=from_location, to_location=req.to_location
    )
    req.save()
    log(user, "Request approved", f"{req.code} · {req.transfer.code} sent from {from_location.name}")
    return req


@transaction.atomic
def decline_request(user, req, note=""):
    req = _decide(user, req, StockRequest.Status.DECLINED, note)
    req.save()
    log(user, "Request declined", req.code + (f" · {note}" if note else ""))
    return req


@transaction.atomic
def cancel_request(user, req):
    req = _decide(user, req, StockRequest.Status.CANCELLED)
    req.save()
    log(user, "Request cancelled", req.code)
    return req
