"""Every stock-changing action lives here. The frontend calls them through frontend/src/lib/data/actions.ts.

Each function runs in a transaction and locks the stock rows it touches, so two
people selling the last item at the same time can't both succeed. Errors are
raised as ValidationError with a readable message the frontend shows as a toast.
"""

import secrets
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Business

from .models import (
    Activity, Product, Purchase, PurchaseItem, Rental, Sale, Shipment, ShipmentEvent, StockLevel, StockRequest, SupplierReturn, Transfer,
    tracking_token,
)


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


def check_supplier_deletable(supplier):
    if supplier.purchases.exists():
        raise ValidationError("This supplier has purchases. It stays so those records still say who sold them.")


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
    return methods


def number_receipt(sale):
    """Gives a paid sale, and every item sold with it, the business's next receipt number.
    Call inside a transaction. Locking the business row makes two sales at the same moment wait for each other."""
    Business.objects.select_for_update().filter(pk=sale.business_id).first()
    last = Sale.objects.filter(business_id=sale.business_id).aggregate(n=Max("receipt_no"))["n"] or 0
    sale.receipt_no = last + 1
    sale.receipt_sales().update(receipt_no=sale.receipt_no)
    return sale


def split_discount(amounts, discount):
    """One discount on the whole bill, shared across the items by how much each costs,
    so each item's profit stays right. Rounding is settled on the most expensive item."""
    total = sum(amounts)
    if not discount or not total:
        return [Decimal(0)] * len(amounts)
    shares = [(discount * a / total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) for a in amounts]
    biggest = amounts.index(max(amounts))
    shares[biggest] += discount - sum(shares)
    return shares


def describe(sales):
    return ", ".join(f"{s.quantity} × {s.product_name}" for s in sales)


@transaction.atomic
def sell(user, *, location, items, discount=0, client=None, payment_method=Sale.Method.CASH, payment_reference=""):
    """A walk-in checkout at a shop: one or more items, one discount on the whole bill,
    one payment, one receipt. Each item is still its own sale (so profit per product
    keeps working), grouped under one receipt token and number. Takes the stock and
    records the money. Returns the sales in the order rung up."""
    if not items:
        raise ValidationError("Add at least one item.")
    amounts = [item["unit_price"] * item["quantity"] for item in items]
    if discount > sum(amounts):
        raise ValidationError("The discount can't be more than the total.")
    if payment_method not in enabled_methods(user.business):
        raise ValidationError("This payment method isn't turned on for your business.")
    # The same transaction ID twice is an old payment shown again.
    if payment_reference and Sale.objects.filter(business=user.business, payment_reference__iexact=payment_reference).exists():
        raise ValidationError("This transaction ID is already on another sale.")
    token = tracking_token()
    sales = []
    for item, share in zip(items, split_discount(amounts, discount)):
        product = item["product"]
        change_stock(product, location, -item["quantity"])
        sales.append(Sale.objects.create(
            payment_method=payment_method,
            payment_reference=payment_reference,
            receipt_token=token,
            business=user.business,
            channel=Sale.Channel.STORE,
            product=product,
            product_name=product.name,
            quantity=item["quantity"],
            unit_price=item["unit_price"],
            unit_cost=product.cost,
            discount=share,
            location=location,
            client=client,
            sold_by=user,
        ))
    total = sum(s.revenue for s in sales)
    number_receipt(sales[0])
    for s in sales[1:]:
        s.receipt_no = sales[0].receipt_no
    log(user, "Sold", f"{describe(sales)} at {location.name} for {total:.2f} ({sales[0].get_payment_method_display()})")
    return sales


def check_returnable(sale):
    if sale.channel != Sale.Channel.STORE:
        raise ValidationError("Only shop sales are returned here. Orders are returned from Orders.")
    if sale.refunded_at:
        raise ValidationError("This sale was already returned.")


@transaction.atomic
def request_return(user, sale, reason):
    """A manager asks the owner or an admin to take a sale back."""
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    check_returnable(sale)
    if sale.return_request == Sale.ReturnRequest.REQUESTED:
        raise ValidationError("A return is already waiting for approval.")
    reason = reason.strip()
    if not reason:
        raise ValidationError({"reason": "Say why the customer is returning it."})
    sale.return_request = Sale.ReturnRequest.REQUESTED
    sale.return_requested_by = user
    sale.return_requested_at = timezone.now()
    sale.refund_reason = reason
    sale.return_decline_note = ""
    sale.save(update_fields=["return_request", "return_requested_by", "return_requested_at", "refund_reason", "return_decline_note"])
    log(user, "Return requested", f"{sale.receipt_code or ''} {sale.quantity} × {sale.product_name} · {reason}".strip())
    return sale


@transaction.atomic
def decline_return(user, sale, note=""):
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.return_request != Sale.ReturnRequest.REQUESTED:
        raise ValidationError("There's no return waiting for approval on this sale.")
    sale.return_request = Sale.ReturnRequest.DECLINED
    sale.return_decline_note = note.strip()
    sale.save(update_fields=["return_request", "return_decline_note"])
    log(user, "Return declined", f"{sale.receipt_code or ''} {sale.quantity} × {sale.product_name}{f' · {sale.return_decline_note}' if sale.return_decline_note else ''}".strip())
    return sale


@transaction.atomic
def return_sale(user, sale, reason=""):
    """A customer brings back what they bought at the counter: the stock goes back
    where it was sold from, the sale stops counting, and whoever takes the return
    hands the money back. Owners and admins only; approving a manager's request
    comes here too, keeping the manager's reason unless a new one is given."""
    sale = Sale.objects.select_for_update().select_related("product", "location", "business").get(pk=sale.pk)
    check_returnable(sale)
    approving = sale.return_request == Sale.ReturnRequest.REQUESTED
    reason = reason.strip() or (sale.refund_reason if approving else "")
    if sale.product and sale.location:
        change_stock(sale.product, sale.location, sale.quantity)
    sale.refunded_at = timezone.now()
    sale.refunded_by = user
    sale.refund_reason = reason
    # An approved request is just a returned sale; whoever asked stays in return_requested_by.
    sale.return_request = ""
    sale.save(update_fields=["refunded_at", "refunded_by", "refund_reason", "return_request"])
    where = f" to {sale.location.name}" if sale.location else ""
    log(user, "Return approved" if approving else "Sale returned", f"{sale.receipt_code or ''} {sale.quantity} × {sale.product_name}{where} · {sale.revenue:.2f} back ({sale.get_payment_method_display() or 'not recorded'}){f' · {reason}' if reason else ''}".strip())
    return sale


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


# ---------- Purchases ----------
# Stock bought in. The product's cost becomes the average of what was on hand and
# what was just paid, so sales after this one carry a fair cost and profit.


def average_cost(product, quantity, unit_cost):
    """The product's cost once `quantity` more arrive at `unit_cost`. Call before the stock goes up."""
    on_hand = StockLevel.objects.filter(product=product).aggregate(n=Sum("quantity"))["n"] or 0
    if on_hand <= 0:
        return unit_cost
    total = product.cost * on_hand + unit_cost * quantity
    return (total / (on_hand + quantity)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def make_sku(business, category=""):
    """A free SKU like "ELE-4821", from the category's first letters."""
    prefix = ("".join(c for c in category if c.isalpha())[:3] or "PRD").upper()
    while True:
        sku = f"{prefix}-{secrets.randbelow(9000) + 1000}"
        if not Product.objects.filter(business=business, sku__iexact=sku).exists():
            return sku


def create_product_for_purchase(user, new):
    """A product first bought on this purchase. Its cost starts at what was paid, once the stock arrives."""
    product = Product.objects.create(
        business=user.business,
        name=new["name"],
        unit=new.get("unit") or "pcs",
        price=new.get("price") or 0,
        barcode=new.get("barcode", ""),
        category=new.get("category", ""),
        sku=new.get("sku") or make_sku(user.business, new.get("category", "")),
        created_by=user,
    )
    log(user, "Product added", f"{product.name} (on a purchase)")
    return product


@transaction.atomic
def record_purchase(user, *, location, items, supplier=None, reference="", note="", purchased_at=None):
    """One supplier's bill: every item goes into stock at `location`, and each
    product's cost is averaged in. Items with `new_product` instead of `product`
    are created first, in the same transaction, so a refused purchase leaves no
    half-made products behind. Returns the purchase."""
    if not items:
        raise ValidationError("Add at least one product.")
    # Locking the business row makes two purchases at the same moment wait for each other's number.
    Business.objects.select_for_update().filter(pk=user.business_id).first()
    last = Purchase.objects.filter(business=user.business).aggregate(n=Max("number"))["n"] or 0
    purchase = Purchase.objects.create(
        business=user.business,
        number=last + 1,
        supplier=supplier,
        location=location,
        reference=reference.strip(),
        note=note.strip(),
        purchased_at=purchased_at or timezone.now(),
        created_by=user,
    )
    for item in items:
        if item.get("new_product"):
            item["product"] = create_product_for_purchase(user, item["new_product"])
        product = Product.objects.select_for_update().get(pk=item["product"].pk)
        product.cost = average_cost(product, item["quantity"], item["unit_cost"])
        product.save(update_fields=["cost"])
        change_stock(product, location, item["quantity"])
        PurchaseItem.objects.create(
            purchase=purchase, product=product, product_name=product.name, quantity=item["quantity"], unit_cost=item["unit_cost"]
        )
    lines = list(purchase.items.all())
    total = sum(i.amount for i in lines)
    who = f" from {supplier.name}" if supplier else ""
    log(user, "Stock bought", f"{purchase.code}{who}: {describe(lines)} at {location.name} for {total:.2f}")
    return purchase


# ---------- Returns to suppliers ----------
# Damaged or wrong stock from a purchase goes back. It leaves stock at once; the
# supplier settles with replacements, a refund, or both. The product's cost is left
# alone: the stock goes back at what was paid, and the average stays as it is.


@transaction.atomic
def return_to_supplier(user, item, quantity, reason):
    """Sends `quantity` of a purchase's item back. Returns the new return."""
    item = PurchaseItem.objects.select_for_update().select_related("purchase__location", "purchase__supplier", "product").get(pk=item.pk)
    purchase = item.purchase
    reason = reason.strip()
    if not reason:
        raise ValidationError({"reason": "Say what's wrong with it, e.g. broken."})
    if not item.product or not purchase.location:
        raise ValidationError("The product or the location it arrived at no longer exists.")
    already = item.returns.aggregate(n=Sum("quantity"))["n"] or 0
    if quantity > item.quantity - already:
        left = item.quantity - already
        raise ValidationError(f"Only {left} of this product {'is' if left == 1 else 'are'} left to return from {purchase.code}.")
    change_stock(item.product, purchase.location, -quantity)
    Business.objects.select_for_update().filter(pk=user.business_id).first()
    last = SupplierReturn.objects.filter(business=user.business).aggregate(n=Max("number"))["n"] or 0
    ret = SupplierReturn.objects.create(
        business=user.business,
        number=last + 1,
        purchase=purchase,
        item=item,
        supplier=purchase.supplier,
        location=purchase.location,
        product=item.product,
        product_name=item.product_name,
        quantity=quantity,
        unit_cost=item.unit_cost,
        reason=reason,
        created_by=user,
    )
    to = f" to {purchase.supplier.name}" if purchase.supplier else ""
    log(user, "Returned to supplier", f"{ret.code} · {quantity} × {ret.product_name}{to} from {purchase.code} · {ret.value:.2f} · {reason}")
    return ret


def _open_return(ret):
    ret = SupplierReturn.objects.select_for_update().select_related("product", "location", "supplier").get(pk=ret.pk)
    if ret.status != SupplierReturn.Status.OPEN:
        raise ValidationError("This return is already settled or closed.")
    return ret


def _finish_if_settled(ret):
    if ret.replaced_quantity >= ret.quantity or (ret.value > 0 and ret.outstanding <= 0):
        ret.status = SupplierReturn.Status.SETTLED
        ret.finished_at = timezone.now()


@transaction.atomic
def receive_replacement(user, ret, quantity):
    """The supplier sent new units instead: they go into stock where the return left from."""
    ret = _open_return(ret)
    if quantity > ret.units_to_replace:
        raise ValidationError(f"The supplier only owes {ret.units_to_replace} more.")
    if not ret.product or not ret.location:
        raise ValidationError("The product or the location no longer exists. Record a refund instead.")
    change_stock(ret.product, ret.location, quantity)
    ret.replaced_quantity += quantity
    _finish_if_settled(ret)
    ret.save(update_fields=["replaced_quantity", "status", "finished_at"])
    log(user, "Replacement received", f"{ret.code} · {quantity} × {ret.product_name} at {ret.location.name}")
    return ret


@transaction.atomic
def receive_refund(user, ret, amount, method):
    """The supplier gave money back for the return, all of it or part."""
    ret = _open_return(ret)
    if amount > ret.outstanding:
        raise ValidationError(f"The supplier only owes {ret.outstanding:.2f} on this return.")
    ret.refunded_amount += amount
    ret.refund_method = method
    _finish_if_settled(ret)
    ret.save(update_fields=["refunded_amount", "refund_method", "status", "finished_at"])
    log(user, "Refund received", f"{ret.code} · {amount:.2f} ({ret.get_refund_method_display()})")
    return ret


@transaction.atomic
def close_return(user, ret, note=""):
    """The supplier won't settle the rest: what's still owed is a loss."""
    ret = _open_return(ret)
    ret.status = SupplierReturn.Status.CLOSED
    ret.closed_note = note.strip()
    ret.finished_at = timezone.now()
    ret.save(update_fields=["status", "closed_note", "finished_at"])
    log(user, "Return closed unsettled", f"{ret.code} · {ret.outstanding:.2f} not recovered{f' · {ret.closed_note}' if ret.closed_note else ''}")
    return ret


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
