import math
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.accounts.models import Business

# Mirrors frontend/src/lib/types.ts. Every model carries `business` so each
# query can be scoped to the logged-in user's tenant.


class TenantModel(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


class Location(TenantModel):
    class Type(models.TextChoices):
        WAREHOUSE = "warehouse", "Warehouse"
        OUTLET = "outlet", "Outlet"

    name = models.CharField(max_length=150)
    type = models.CharField(max_length=20, choices=Type.choices)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=40, blank=True)

    class Meta:
        # Creation order, so the main warehouse a business set up first stays first
        # and is the default in forms.
        ordering = ["id"]

    def __str__(self):
        return self.name


class Product(TenantModel):
    sku = models.CharField(max_length=64)
    barcode = models.CharField(max_length=128, blank=True)
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    unit = models.CharField(max_length=30, default="pcs")
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    low_stock_threshold = models.PositiveIntegerField(default=0)
    rentable = models.BooleanField(default=False)
    rent_daily = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rent_weekly = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rent_monthly = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["business", "sku"], name="unique_sku_per_business"),
            models.UniqueConstraint(
                fields=["business", "barcode"],
                condition=~models.Q(barcode=""),
                name="unique_barcode_per_business",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.sku})"


class StockLevel(TenantModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="stock")
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="stock")
    quantity = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "location"], name="unique_stock_row")]


class Client(TenantModel):
    name = models.CharField(max_length=150)
    company = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


def tracking_token():
    """Long and random, so a client's link can't be guessed from the order or receipt number."""
    return secrets.token_urlsafe(16)


class Shipment(TenantModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        IN_DELIVERY = "in_delivery", "In delivery"
        DELIVERED = "delivered", "Delivered"
        RETURNED = "returned", "Returned"
        CANCELLED = "cancelled", "Cancelled"

    # Statuses after which the goods are back on the shelf.
    RESTOCKED = (Status.RETURNED, Status.CANCELLED)
    # Still on its way to the client.
    OPEN = (Status.PENDING, Status.PROCESSING, Status.IN_DELIVERY)
    # The order is finished; its tracking link stops working this long after.
    CLOSED = (Status.DELIVERED, Status.RETURNED, Status.CANCELLED)
    TRACKING_LINK_DAYS = 30

    code = models.CharField(max_length=32)
    # For the client's public tracking page.
    tracking_token = models.CharField(max_length=32, unique=True, default=tracking_token)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    client = models.ForeignKey(Client, null=True, on_delete=models.SET_NULL, related_name="shipments")
    from_location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)
    # Agreed when the order is placed, so the sale uses this even if the product's price changes later.
    # Null on orders from before sales tracking; those use the price at delivery.
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ShipmentEvent(models.Model):
    """One row per status change; the frontend's `history` array."""

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name="history")
    status = models.CharField(max_length=20, choices=Shipment.Status.choices)
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["at"]


class Rental(TenantModel):
    class Plan(models.TextChoices):
        DAILY = "daily", "Per day"
        WEEKLY = "weekly", "Per week"
        MONTHLY = "monthly", "Per month"
        FIXED = "fixed", "Fixed price"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        RETURNED = "returned", "Returned"

    PLAN_DAYS = {Plan.DAILY: 1, Plan.WEEKLY: 7, Plan.MONTHLY: 30}

    code = models.CharField(max_length=32)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    client = models.ForeignKey(Client, null=True, on_delete=models.SET_NULL, related_name="rentals")
    location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    start_date = models.DateTimeField()
    # Expected length, optional: only for the due date and overdue reminders.
    # The price is worked out from the actual days out when the rental comes back.
    days = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    # start_date + days, kept so overdue rentals can be found in the database.
    due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Set at return. Holidays only reduce the per-day plan.
    days_out = models.PositiveIntegerField(null=True, blank=True)
    holidays = models.PositiveIntegerField(default=0)
    plan = models.CharField(max_length=10, choices=Plan.choices)
    # Price per day/week/month, or the flat amount when plan is "fixed".
    rate = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    deposit = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    total = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    returned_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        self.due_at = self.due_date
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "due_at"}
        super().save(*args, **kwargs)

    @classmethod
    def overdue_q(cls):
        """Active and due before today (local time), the same as isOverdue() in the frontend."""
        today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        return models.Q(status=cls.Status.ACTIVE, due_at__lt=today)

    @classmethod
    def quote(cls, plan, rate, days, quantity, holidays=0):
        """Same as quoteRental() in the frontend. Per day: the days minus holidays.
        Weekly/monthly: every started week or month (holidays don't apply). Fixed: one price."""
        if plan == cls.Plan.FIXED:
            return rate * quantity
        if plan == cls.Plan.DAILY:
            return max(days - holidays, 0) * rate * quantity
        periods = math.ceil(days / cls.PLAN_DAYS[plan])
        return periods * rate * quantity

    @staticmethod
    def count_days(start, end):
        """Days out, counting any started day: out at 10:00, back at 10:00 next day = 1 day. At least 1."""
        return max(1, math.ceil((end - start).total_seconds() / 86400))

    @property
    def due_date(self):
        return self.start_date + timedelta(days=self.days) if self.days else None


class Transfer(TenantModel):
    class Status(models.TextChoices):
        IN_TRANSIT = "in_transit", "In transit"
        RECEIVED = "received", "Received"
        CANCELLED = "cancelled", "Cancelled"

    code = models.CharField(max_length=32)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    from_location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    to_location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_TRANSIT)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class Activity(TenantModel):
    at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=100)
    detail = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-at"]
        verbose_name_plural = "activity"


class Sale(TenantModel):
    """Money in. Freezes the price and cost at the moment of sale, so changing a
    product's price later never rewrites past profit."""

    class Channel(models.TextChoices):
        STORE = "store", "In store"
        ORDER = "order", "Order"
        RENTAL = "rental", "Rental"

    channel = models.CharField(max_length=10, choices=Channel.choices)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    # Kept so the sale still reads right after the product is renamed or deleted.
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    client = models.ForeignKey(Client, null=True, blank=True, on_delete=models.SET_NULL, related_name="sales")
    shipment = models.OneToOneField(Shipment, null=True, blank=True, on_delete=models.SET_NULL, related_name="sale")
    rental = models.OneToOneField(Rental, null=True, blank=True, on_delete=models.SET_NULL, related_name="sale")
    sold_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    sold_at = models.DateTimeField(default=timezone.now)
    # Set when the goods come back (a delivered order returned, or a shop sale
    # brought back to the counter). Refunded sales don't count.
    refunded_at = models.DateTimeField(null=True, blank=True)
    refunded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    refund_reason = models.CharField(max_length=200, blank=True)

    class ReturnRequest(models.TextChoices):
        REQUESTED = "requested", "Return requested"
        DECLINED = "declined", "Return declined"

    # Managers ask for a return; the owner or an admin approves (which returns
    # the sale, see refunded_at) or declines with a note. The reason is refund_reason.
    return_request = models.CharField(max_length=10, choices=ReturnRequest.choices, blank=True)
    return_requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    return_requested_at = models.DateTimeField(null=True, blank=True)
    return_decline_note = models.CharField(max_length=200, blank=True)

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE = "mobile", "Mobile banking"
        CARD = "card", "Card machine"

    # Empty when not recorded (orders, and sales from before payment methods).
    payment_method = models.CharField(max_length=10, choices=Method.choices, blank=True)
    # The bKash / Nagad transaction ID staff copy from the customer's payment, for mobile sales.
    payment_reference = models.CharField(max_length=60, blank=True)
    # Numbered 1, 2, 3… per business, shown as R-000001. Every item of one
    # checkout shares the number and the token.
    receipt_no = models.PositiveIntegerField(null=True, blank=True)
    # For the buyer's public receipt link. Also what groups a checkout's items.
    receipt_token = models.CharField(max_length=32, db_index=True, default=tracking_token)

    class Meta:
        ordering = ["-sold_at"]
        indexes = [models.Index(fields=["business", "sold_at"]), models.Index(fields=["business", "receipt_no"])]

    def receipt_sales(self):
        """Every item sold with this one at the same checkout, this one included, in the order rung up."""
        return Sale.objects.filter(business_id=self.business_id, receipt_token=self.receipt_token).order_by("id")

    @property
    def receipt_code(self):
        return f"R-{self.receipt_no:06d}" if self.receipt_no else None

    @property
    def revenue(self):
        return self.unit_price * self.quantity - self.discount

    @property
    def cost(self):
        return self.unit_cost * self.quantity

    @property
    def profit(self):
        return self.revenue - self.cost


class StockRequest(TenantModel):
    """A shop asking for stock. Approving it sends a transfer from the chosen warehouse."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting"
        APPROVED = "approved", "Sent"
        DECLINED = "declined", "Declined"
        CANCELLED = "cancelled", "Cancelled"

    code = models.CharField(max_length=32)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    to_location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=300, blank=True)
    # The transfer that fulfils it; its status says whether the stock has arrived.
    transfer = models.OneToOneField(Transfer, null=True, blank=True, on_delete=models.SET_NULL, related_name="request")

    class Meta:
        ordering = ["-created_at"]


class Supplier(TenantModel):
    """Who the business buys stock from."""

    name = models.CharField(max_length=150)
    company = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Purchase(TenantModel):
    """Stock bought in: one supplier's bill, one or more products, received at one
    location. Recording it raises the stock there and moves each product's cost to
    the average of what was on hand and what was just paid."""

    # The links between suppliers, purchases, returns and payments are RESTRICT, not
    # PROTECT: one can't be deleted while another points at it, but deleting the
    # whole business takes them all together.

    # Numbered 1, 2, 3… per business. Shown as P-000001.
    number = models.PositiveIntegerField()
    # Optional: stock bought at a market stall has no supplier worth keeping.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="purchases")
    location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    # The supplier's own bill or invoice number.
    reference = models.CharField(max_length=60, blank=True)
    note = models.CharField(max_length=300, blank=True)
    purchased_at = models.DateTimeField(default=timezone.now)
    # The bill's total, kept so what's owed can be filtered and added up in the database.
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # How much of it is paid: paid when bought, plus later payments given to it (PaymentAllocation).
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # When the rest is due, for stock bought on credit. Optional.
    due_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-purchased_at", "-id"]
        indexes = [models.Index(fields=["business", "purchased_at"])]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_purchase_no_per_business")]

    @property
    def code(self):
        return f"P-{self.number:06d}"

    @property
    def due(self):
        return max(self.total - self.paid_amount, 0)

    @property
    def payment_status(self):
        """paid | partly_paid | unpaid"""
        if self.paid_amount >= self.total:
            return "paid"
        return "partly_paid" if self.paid_amount > 0 else "unpaid"


class PurchaseItem(models.Model):
    """One product on a purchase, at the price paid for it. Keeps the name, so
    deleting the product later doesn't empty the record."""

    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])

    class Meta:
        ordering = ["id"]

    @property
    def amount(self):
        return self.unit_cost * self.quantity


class SupplierReturn(TenantModel):
    """Stock from a purchase sent back to the supplier, usually damaged or broken.
    It leaves stock straight away. The supplier settles it by sending replacements,
    refunding the money, or both; the owner can close it unsettled as a loss."""

    class Status(models.TextChoices):
        OPEN = "open", "Waiting for supplier"
        SETTLED = "settled", "Settled"
        CLOSED = "closed", "Closed unsettled"

    class RefundMethod(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE = "mobile", "Mobile banking"
        BANK = "bank", "Bank"

    # Numbered 1, 2, 3… per business. Shown as SR-000001.
    number = models.PositiveIntegerField()
    purchase = models.ForeignKey(Purchase, on_delete=models.RESTRICT, related_name="returns")
    item = models.ForeignKey(PurchaseItem, on_delete=models.RESTRICT, related_name="returns")
    # Copied from the purchase, so lists and totals don't have to go through it.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="returns")
    location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    # What was paid for each on the purchase: what the supplier owes back per unit.
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    # How it was settled so far: units sent again, and money given back.
    replaced_quantity = models.PositiveIntegerField(default=0)
    refunded_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Taken off what the business owes the supplier instead (see SupplierPayment.Method.CREDIT).
    credited_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # How the last refund came, for the record.
    refund_method = models.CharField(max_length=10, choices=RefundMethod.choices, blank=True)
    closed_note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    # When it was settled or closed.
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_supplier_return_no_per_business")]

    @property
    def code(self):
        return f"SR-{self.number:06d}"

    @property
    def value(self):
        return self.unit_cost * self.quantity

    @property
    def outstanding(self):
        """What the supplier still owes: the value less what was replaced, refunded and credited."""
        return max(self.value - self.unit_cost * self.replaced_quantity - self.refunded_amount - self.credited_amount, 0)

    @property
    def units_to_replace(self):
        """How many more units the supplier can send instead of money."""
        left = self.quantity - self.replaced_quantity
        if self.unit_cost <= 0:
            return left
        return min(left, int(self.outstanding // self.unit_cost))


class SupplierPayment(TenantModel):
    """Money paid to a supplier: when a purchase is made, or later against what's owed.
    It's given to that purchase, or to the supplier's oldest unpaid bills first
    (see PaymentAllocation). A return taken off what's owed is a payment too, of the
    method "credit"."""

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOBILE = "mobile", "Mobile banking"
        BANK = "bank", "Bank"
        CREDIT = "credit", "Return credit"

    # Numbered 1, 2, 3… per business. Shown as SP-000001.
    number = models.PositiveIntegerField()
    # Empty only for a purchase bought without a supplier, which is paid in full.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.RESTRICT, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(0)])
    # Empty for payments recorded before payments were tracked.
    method = models.CharField(max_length=10, choices=Method.choices, blank=True)
    paid_at = models.DateTimeField(default=timezone.now)
    note = models.CharField(max_length=300, blank=True)
    # For a return credit: the return it came from.
    supplier_return = models.ForeignKey("SupplierReturn", null=True, blank=True, on_delete=models.RESTRICT, related_name="credits")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business", "number"], name="unique_supplier_payment_no_per_business")]

    @property
    def code(self):
        return f"SP-{self.number:06d}"


class PaymentAllocation(models.Model):
    """The part of a payment that went to one purchase."""

    payment = models.ForeignKey(SupplierPayment, on_delete=models.CASCADE, related_name="allocations")
    purchase = models.ForeignKey(Purchase, on_delete=models.RESTRICT, related_name="allocations")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        ordering = ["id"]
