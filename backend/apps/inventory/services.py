"""Every stock-changing action lives here, ported from frontend/src/lib/store/index.ts.

Each function runs in a transaction and locks the stock rows it touches, so two
people selling the last item at the same time can't both succeed. Errors are
raised as ValidationError with a readable message the frontend shows as a toast.
"""

import secrets

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Activity, Rental, Shipment, ShipmentEvent, StockLevel, Transfer


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
def create_shipment(user, *, product, quantity, client, from_location, notes=""):
    change_stock(product, from_location, -quantity)
    shipment = Shipment.objects.create(
        business=user.business,
        code=ref_code("SHP"),
        product=product,
        quantity=quantity,
        client=client,
        from_location=from_location,
        notes=notes,
    )
    ShipmentEvent.objects.create(shipment=shipment, status=shipment.status, by=user)
    log(user, "Shipment created", f"{shipment.code} · {quantity} × {product.name} to {client.name}")
    return shipment


@transaction.atomic
def set_shipment_status(user, shipment, status, note=""):
    shipment = Shipment.objects.select_for_update().get(pk=shipment.pk)
    if shipment.status in Shipment.RESTOCKED:
        raise ValidationError("This shipment is closed.")
    if shipment.status == status:
        return shipment
    if status in Shipment.RESTOCKED:
        change_stock(shipment.product, shipment.from_location, shipment.quantity)
    shipment.status = status
    shipment.save(update_fields=["status"])
    ShipmentEvent.objects.create(shipment=shipment, status=status, by=user, note=note)
    log(user, "Shipment updated", f"{shipment.code} → {shipment.get_status_display()}")
    return shipment


# ---------- Rentals ----------


@transaction.atomic
def create_rental(user, *, product, quantity, client, location, start_date, days, plan, rate, deposit=0, notes=""):
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
        total=Rental.quote(plan, rate, days, quantity),
        notes=notes,
    )
    log(user, "Rental created", f"{rental.code} · {quantity} × {product.name} to {client.name}")
    return rental


@transaction.atomic
def return_rental(user, rental):
    rental = Rental.objects.select_for_update().get(pk=rental.pk)
    if rental.status != Rental.Status.ACTIVE:
        raise ValidationError("This rental was already returned.")
    change_stock(rental.product, rental.location, rental.quantity)
    rental.status = Rental.Status.RETURNED
    rental.returned_at = timezone.now()
    rental.save(update_fields=["status", "returned_at"])
    log(user, "Rental returned", rental.code)
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
