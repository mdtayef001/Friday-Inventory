"""Everything a business has, as one ZIP of CSV files that open in Excel.

For the owner (even while the business is locked for not paying) and the super admin,
so a business can always take its records with it. Passwords and payment gateway
details are never included."""

import csv
import io
import zipfile

from django.utils import timezone

from apps.accounts.models import User
from apps.billing.models import Payment

from .models import (
    Activity, Client, Location, Product, Purchase, PurchaseItem, Rental, Sale, Shipment, StockLevel, StockRequest, Supplier,
    SupplierPayment, SupplierReturn, Transfer,
)


def safe(value):
    """Text typed by users: stop Excel from running something like "=HYPERLINK(...)" as a formula."""
    value = "" if value is None else str(value)
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def when(value):
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value else ""


def name(obj):
    return safe(obj.name) if obj else ""


def csv_bytes(header, rows):
    out = io.StringIO()
    out.write("﻿")  # BOM, so Excel reads the file as UTF-8 (names, ৳)
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def tables(business):
    """(file name, header, rows) for each part of the business."""
    of = {"business": business}
    yield "products.csv", [
        "SKU", "Barcode", "Name", "Category", "Unit", "Selling price", "Cost", "Low-stock alert at", "For rent",
        "Rent per day", "Rent per week", "Rent per month", "Description", "Added",
    ], (
        [safe(p.sku), safe(p.barcode), safe(p.name), safe(p.category), p.unit, p.price, p.cost, p.low_stock_threshold,
         "Yes" if p.rentable else "No", p.rent_daily or "", p.rent_weekly or "", p.rent_monthly or "", safe(p.description), when(p.created_at)]
        for p in Product.objects.filter(**of).order_by("name")
    )
    yield "stock.csv", ["Product", "SKU", "Location", "Quantity"], (
        [safe(s.product.name), safe(s.product.sku), name(s.location), s.quantity]
        for s in StockLevel.objects.filter(**of).select_related("product", "location").order_by("product__name", "location__name")
    )
    yield "locations.csv", ["Name", "Type", "Address", "Phone"], (
        [safe(loc.name), loc.get_type_display(), safe(loc.address), safe(loc.phone)] for loc in Location.objects.filter(**of).order_by("name")
    )
    yield "sales.csv", [
        "Date", "Receipt", "Type", "Product", "Quantity", "Unit price", "Discount", "Total", "Unit cost", "Cost", "Profit",
        "Payment", "Transaction ID", "Shop", "Client", "Sold by", "Refunded", "Refund reason",
    ], (
        [when(s.sold_at), s.receipt_no or "", s.get_channel_display(), safe(s.product_name), s.quantity, s.unit_price, s.discount,
         s.revenue, s.unit_cost, s.cost, s.profit, s.get_payment_method_display() if s.payment_method else "", safe(s.payment_reference),
         name(s.location), name(s.client) or "Walk-in", name(s.sold_by), when(s.refunded_at), safe(s.refund_reason)]
        for s in Sale.objects.filter(**of).select_related("location", "client", "sold_by").order_by("sold_at", "id").iterator()
    )
    yield "clients.csv", ["Name", "Company", "Phone", "Email", "Address", "Added"], (
        [safe(c.name), safe(c.company), safe(c.phone), safe(c.email), safe(c.address), when(c.created_at)]
        for c in Client.objects.filter(**of).order_by("name")
    )
    yield "suppliers.csv", ["Name", "Company", "Phone", "Email", "Address", "Added"], (
        [safe(s.name), safe(s.company), safe(s.phone), safe(s.email), safe(s.address), when(s.created_at)]
        for s in Supplier.objects.filter(**of).order_by("name")
    )
    # One row per product bought, with the bill's totals on each.
    yield "purchases.csv", [
        "Purchase", "Date", "Supplier", "Arrived at", "Supplier's bill no", "Product", "Quantity", "Unit cost", "Amount",
        "Bill total", "Bill paid", "Bill due", "Due date", "Note",
    ], (
        [i.purchase.code, when(i.purchase.purchased_at), name(i.purchase.supplier), name(i.purchase.location), safe(i.purchase.reference),
         safe(i.product_name), i.quantity, i.unit_cost, i.quantity * i.unit_cost, i.purchase.total, i.purchase.paid_amount, i.purchase.due,
         i.purchase.due_date or "", safe(i.purchase.note)]
        for i in PurchaseItem.objects.filter(purchase__business=business)
        .select_related("purchase__supplier", "purchase__location").order_by("purchase__purchased_at", "id").iterator()
    )
    yield "supplier-payments.csv", ["Payment", "Date", "Supplier", "Amount", "Method", "Note"], (
        [p.code, when(p.paid_at), name(p.supplier), p.amount, p.get_method_display(), safe(p.note)]
        for p in SupplierPayment.objects.filter(**of).select_related("supplier").order_by("paid_at", "id")
    )
    yield "supplier-returns.csv", [
        "Return", "Date", "Purchase", "Supplier", "Product", "Quantity", "Unit cost", "Value", "Reason", "Status",
        "Replaced", "Refunded", "Taken off what's owed", "Note when closed",
    ], (
        [r.code, when(r.created_at), r.purchase.code if r.purchase else "", name(r.supplier), safe(r.product_name), r.quantity, r.unit_cost,
         r.value, safe(r.reason), r.get_status_display(), r.replaced_quantity, r.refunded_amount, r.credited_amount, safe(r.closed_note)]
        for r in SupplierReturn.objects.filter(**of).select_related("purchase", "supplier").order_by("created_at", "id")
    )
    yield "rentals.csv", [
        "Rental", "Product", "Quantity", "Client", "Location", "Out", "Due back", "Returned", "Plan", "Rate", "Deposit",
        "Days out", "Holidays", "Total", "Status", "Notes",
    ], (
        [r.code, name(r.product), r.quantity, name(r.client), name(r.location), when(r.start_date), when(r.due_at), when(r.returned_at),
         r.get_plan_display(), r.rate, r.deposit, r.days_out or "", r.holidays, r.total or "", r.get_status_display(), safe(r.notes)]
        for r in Rental.objects.filter(**of).select_related("product", "client", "location").order_by("start_date", "id")
    )
    yield "orders.csv", ["Order", "Date", "Product", "Quantity", "Unit price", "Client", "From", "Status", "Notes"], (
        [s.code, when(s.created_at), name(s.product), s.quantity, s.unit_price, name(s.client), name(s.from_location),
         s.get_status_display(), safe(s.notes)]
        for s in Shipment.objects.filter(**of).select_related("product", "client", "from_location").order_by("created_at", "id")
    )
    yield "transfers.csv", ["Transfer", "Date", "Product", "Quantity", "From", "To", "Status", "Received"], (
        [t.code, when(t.created_at), name(t.product), t.quantity, name(t.from_location), name(t.to_location), t.get_status_display(),
         when(t.received_at)]
        for t in Transfer.objects.filter(**of).select_related("product", "from_location", "to_location").order_by("created_at", "id")
    )
    yield "stock-requests.csv", ["Request", "Date", "Product", "Quantity", "For", "Asked by", "Status", "Note", "Answer"], (
        [r.code, when(r.created_at), name(r.product), r.quantity, name(r.to_location), name(r.requested_by), r.get_status_display(),
         safe(r.note), safe(r.decision_note)]
        for r in StockRequest.objects.filter(**of).select_related("product", "to_location", "requested_by").order_by("created_at", "id")
    )
    yield "staff.csv", ["Name", "Email", "Role", "Works at", "Active", "Joined"], (
        [safe(u.name), safe(u.email), u.get_role_display(), ", ".join(loc.name for loc in u.locations.all()) or "All locations",
         "Yes" if u.is_active else "No", when(u.date_joined)]
        for u in User.objects.filter(**of).prefetch_related("locations").order_by("name")
    )
    yield "activity-log.csv", ["When", "Who", "What", "Details"], (
        [when(a.at), name(a.user), safe(a.action), safe(a.detail)]
        for a in Activity.objects.filter(**of).select_related("user").order_by("at", "id").iterator()
    )
    yield "subscription-payments.csv", ["Date", "Invoice", "Months", "Amount", "Method", "Status", "Reference"], (
        [when(p.paid_at or p.created_at), p.invoice_no, p.months, p.amount, safe(p.method), p.get_status_display(), safe(p.reference)]
        for p in Payment.objects.filter(**of).order_by("created_at")
    )


def business_zip(business):
    """The ZIP's bytes, and a file name like "friday-demo-store-2026-10-21.zip"."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, header, rows in tables(business):
            zf.writestr(filename, csv_bytes(header, rows))
    slug = "".join(ch if ch.isalnum() else "-" for ch in business.name.lower()).strip("-") or "business"
    while "--" in slug:
        slug = slug.replace("--", "-")
    return buffer.getvalue(), f"{slug}-{timezone.localdate().isoformat()}.zip"
