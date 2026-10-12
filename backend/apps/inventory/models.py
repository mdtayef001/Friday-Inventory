import math
from datetime import timedelta

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

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

    code = models.CharField(max_length=32)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL, related_name="+")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    client = models.ForeignKey(Client, null=True, on_delete=models.SET_NULL, related_name="shipments")
    from_location = models.ForeignKey(Location, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)
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
    days = models.PositiveIntegerField(validators=[MinValueValidator(1)])
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

    @classmethod
    def quote(cls, plan, rate, days, quantity):
        """Same as quoteRental() in the frontend: weekly/monthly bill every started period."""
        if plan == cls.Plan.FIXED:
            return rate * quantity
        periods = math.ceil(days / cls.PLAN_DAYS[plan])
        return periods * rate * quantity

    @property
    def due_date(self):
        return self.start_date + timedelta(days=self.days)


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
