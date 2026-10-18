from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.api import IdField, tenant_field

from .models import (
    Activity, Client, Location, Product, Purchase, PurchaseItem, Rental, Sale, Shipment, ShipmentEvent, StockLevel, StockRequest,
    Supplier, SupplierPayment, SupplierReturn, Transfer,
)

# Field names follow frontend/src/lib/types.ts (camelCased on the wire).


class LocationSerializer(serializers.ModelSerializer):
    id = IdField()

    class Meta:
        model = Location
        fields = ["id", "name", "type", "address", "phone"]


class ProductSerializer(serializers.ModelSerializer):
    id = IdField()
    rent_rates = serializers.DictField(
        child=serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0), required=False
    )
    created_by = serializers.CharField(source="created_by.name", read_only=True, default=None)

    class Meta:
        model = Product
        fields = [
            "id", "sku", "barcode", "name", "category", "unit", "description", "price", "cost",
            "low_stock_threshold", "rentable", "rent_rates", "created_at", "created_by",
        ]
        read_only_fields = ["created_at"]

    PLANS = ("daily", "weekly", "monthly")

    def to_representation(self, product):
        data = super().to_representation(product)
        rates = {plan: getattr(product, f"rent_{plan}") for plan in self.PLANS}
        rates = {k: float(v) for k, v in rates.items() if v is not None}
        data["rent_rates"] = rates if product.rentable and rates else None
        # Quantity at each of the user's locations (location id -> quantity), when the view loaded it.
        rows = getattr(product, "scoped_stock", None)
        if rows is not None:
            data["stock"] = {str(r.location_id): r.quantity for r in rows}
            data["total"] = sum(r.quantity for r in rows)
        return data

    def validate_rent_rates(self, rates):
        unknown = set(rates) - set(self.PLANS)
        if unknown:
            raise serializers.ValidationError(f"Unknown rent plan: {', '.join(sorted(unknown))}.")
        return rates

    def validate(self, attrs):
        business = self.context["request"].user.business
        others = Product.objects.filter(business=business)
        if self.instance:
            others = others.exclude(pk=self.instance.pk)
        sku = attrs.get("sku")
        if sku and others.filter(sku__iexact=sku).exists():
            raise serializers.ValidationError({"sku": f'SKU "{sku}" is already used by another product.'})
        barcode = attrs.get("barcode")
        if barcode and others.filter(barcode=barcode).exists():
            raise serializers.ValidationError({"barcode": f'Barcode "{barcode}" is already used by another product.'})

        rentable = attrs.get("rentable", self.instance.rentable if self.instance else False)
        if "rent_rates" in attrs or not rentable:
            rates = attrs.pop("rent_rates", None) or {}
            for plan in self.PLANS:
                attrs[f"rent_{plan}"] = rates.get(plan) if rentable else None
        return attrs


class ProductCreateSerializer(ProductSerializer):
    """Adds optional opening stock when a product is created."""

    initial_location_id = tenant_field(Location, source="initial_location", required=False, allow_null=True, write_only=True)
    initial_quantity = serializers.IntegerField(min_value=0, required=False, default=0, write_only=True)

    class Meta(ProductSerializer.Meta):
        fields = ProductSerializer.Meta.fields + ["initial_location_id", "initial_quantity"]


class StockLevelSerializer(serializers.ModelSerializer):
    product_id = IdField()
    location_id = IdField()

    class Meta:
        model = StockLevel
        fields = ["product_id", "location_id", "quantity"]


class StockAdjustSerializer(serializers.Serializer):
    product_id = tenant_field(Product, source="product")
    location_id = tenant_field(Location, source="location")
    delta = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=200)


class ClientSerializer(serializers.ModelSerializer):
    id = IdField()

    class Meta:
        model = Client
        fields = ["id", "name", "company", "phone", "email", "address", "created_at"]
        read_only_fields = ["created_at"]

    STATS = ("active_rentals", "overdue_rentals", "open_orders", "lifetime_value")

    def to_representation(self, client):
        data = super().to_representation(client)
        if hasattr(client, "active_rentals"):
            data["stats"] = {key: getattr(client, key) or 0 for key in self.STATS}
            data["stats"]["lifetime_value"] = float(data["stats"]["lifetime_value"])
        return data


class ClientBriefSerializer(serializers.ModelSerializer):
    """The client on an order or rental, so lists don't need every client loaded."""

    id = IdField()

    class Meta:
        model = Client
        fields = ["id", "name", "company", "phone", "email", "address"]


class ShipmentEventSerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="by.name", read_only=True, default="")

    class Meta:
        model = ShipmentEvent
        fields = ["status", "at", "by", "note"]


class ShipmentSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    client_id = tenant_field(Client, source="client")
    from_location_id = tenant_field(Location, source="from_location")
    history = ShipmentEventSerializer(many=True, read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    product_unit = serializers.CharField(source="product.unit", read_only=True, default=None)
    client = ClientBriefSerializer(read_only=True)

    class Meta:
        model = Shipment
        fields = [
            "id", "code", "tracking_token", "product_id", "product_name", "product_unit", "quantity", "unit_price",
            "client_id", "client", "from_location_id", "status", "notes", "created_at", "history",
        ]
        extra_kwargs = {"unit_price": {"required": False, "min_value": 0}}
        read_only_fields = ["code", "tracking_token", "status", "created_at"]


class ShipmentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Shipment.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    # How the client paid. Only used when the order is marked delivered.
    payment_method = serializers.ChoiceField(choices=Sale.Method.choices, required=False, default=Sale.Method.CASH)


class RentalSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    client_id = tenant_field(Client, source="client")
    location_id = tenant_field(Location, source="location")
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    product_unit = serializers.CharField(source="product.unit", read_only=True, default=None)
    client = ClientBriefSerializer(read_only=True)

    class Meta:
        model = Rental
        fields = [
            "id", "code", "product_id", "product_name", "product_unit", "quantity", "client_id", "client",
            "location_id", "start_date", "days", "plan", "rate", "deposit", "total", "status", "returned_at",
            "days_out", "holidays", "notes", "created_at",
        ]
        read_only_fields = ["code", "total", "status", "returned_at", "days_out", "holidays", "created_at"]
        extra_kwargs = {"days": {"required": False, "allow_null": True}}


class TransferSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    from_location_id = tenant_field(Location, source="from_location")
    to_location_id = tenant_field(Location, source="to_location")
    created_by = serializers.CharField(source="created_by.name", read_only=True, default="")
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    product_unit = serializers.CharField(source="product.unit", read_only=True, default=None)

    class Meta:
        model = Transfer
        fields = [
            "id", "code", "product_id", "product_name", "product_unit", "quantity", "from_location_id",
            "to_location_id", "status", "created_at", "created_by", "received_at",
        ]
        read_only_fields = ["code", "status", "created_at", "received_at"]


class ActivitySerializer(serializers.ModelSerializer):
    id = IdField()
    user = serializers.CharField(source="user.name", read_only=True, default="")
    user_id = IdField()

    class Meta:
        model = Activity
        fields = ["id", "at", "user", "user_id", "action", "detail"]


class PublicTrackingSerializer(serializers.ModelSerializer):
    """What a client sees on their tracking link. Nothing internal: no prices,
    stock, notes, staff names or warehouse."""

    business_name = serializers.CharField(source="business.name")
    product_name = serializers.SerializerMethodField()
    contact_phone = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = ["code", "business_name", "product_name", "quantity", "status", "created_at", "contact_phone", "history"]

    def get_product_name(self, shipment):
        return shipment.product.name if shipment.product else ""

    def get_contact_phone(self, shipment):
        return shipment.from_location.phone if shipment.from_location else ""

    def get_history(self, shipment):
        return [
            {"status": e.status, "at": serializers.DateTimeField().to_representation(e.at)}
            for e in shipment.history.all()
        ]


class SaleSerializer(serializers.ModelSerializer):
    """A sale as the team sees it. Cost and profit are only included for the
    owner (`show_profit` in the context); everyone else gets prices only."""

    id = IdField()
    product_id = IdField()
    location_id = IdField()
    client_id = IdField()
    order_id = IdField(source="shipment_id")
    rental_id = IdField()
    sold_by = serializers.CharField(source="sold_by.name", read_only=True, default="")
    sold_by_id = IdField()
    refunded_by = serializers.CharField(source="refunded_by.name", read_only=True, default="")
    return_requested_by = serializers.CharField(source="return_requested_by.name", read_only=True, default="")
    client_name = serializers.CharField(source="client.name", read_only=True, default=None)
    revenue = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    cost = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    profit = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    receipt_no = serializers.CharField(source="receipt_code", read_only=True)
    receipt_token = serializers.SerializerMethodField()

    PRIVATE = ("unit_cost", "cost", "profit")

    class Meta:
        model = Sale
        fields = [
            "id", "channel", "product_id", "product_name", "quantity", "unit_price", "unit_cost", "discount",
            "revenue", "cost", "profit", "location_id", "client_id", "client_name", "order_id", "rental_id", "sold_by",
            "sold_by_id", "sold_at", "refunded_at", "payment_method",
            "payment_reference", "receipt_no", "receipt_token", "refunded_by", "refund_reason",
            "return_request", "return_requested_by", "return_requested_at", "return_decline_note",
        ]

    def get_receipt_token(self, sale):
        return sale.receipt_token if sale.receipt_no else None

    def to_representation(self, sale):
        data = super().to_representation(sale)
        if not self.context.get("show_profit"):
            for key in self.PRIVATE:
                data.pop(key, None)
        return data


class SellItemSerializer(serializers.Serializer):
    product_id = tenant_field(Product, source="product")
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)


class SellSerializer(serializers.Serializer):
    """A checkout: the items in the cart, all from one shop, with one discount on the whole bill and one payment."""

    location_id = tenant_field(Location, source="location")
    items = SellItemSerializer(many=True, allow_empty=False, max_length=100)
    discount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, default=0)
    client_id = tenant_field(Client, source="client", required=False, allow_null=True)
    payment_method = serializers.ChoiceField(choices=Sale.Method.choices, required=False, default=Sale.Method.CASH)
    # The bKash / Nagad transaction ID. Required for mobile banking, ignored otherwise.
    payment_reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")

    def validate(self, data):
        data["payment_reference"] = data["payment_reference"].strip() if data["payment_method"] == Sale.Method.MOBILE else ""
        if data["payment_method"] == Sale.Method.MOBILE and not data["payment_reference"]:
            raise serializers.ValidationError({"payment_reference": "Enter the transaction ID from the customer's payment."})
        return data


class ReceiptSerializer(serializers.ModelSerializer):
    """A paid sale, with every item sold with it at the same checkout, as the buyer's receipt. Never cost or profit. The team's copy
    (`internal` in the context) adds who served and the client's contact
    details for sending it; the buyer's public link leaves those out."""

    receipt_no = serializers.CharField(source="receipt_code")
    business_name = serializers.CharField(source="business.name")
    currency = serializers.SerializerMethodField()
    shop = serializers.SerializerMethodField()
    client = serializers.SerializerMethodField()
    reference = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    discount = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    refunded = serializers.SerializerMethodField()
    refunded_at = serializers.SerializerMethodField()
    payment_label = serializers.CharField(source="get_payment_method_display")
    sold_by = serializers.CharField(source="sold_by.name", default="")

    class Meta:
        model = Sale
        fields = [
            "id", "receipt_no", "receipt_token", "business_name", "currency", "shop", "sold_at", "channel", "reference",
            "client", "items", "subtotal", "discount", "total", "refunded", "payment_method", "payment_label",
            "payment_reference", "refunded_at", "sold_by",
        ]

    def get_currency(self, sale):
        return sale.business.settings.get("currency", "USD")

    def get_shop(self, sale):
        loc = sale.location
        return {"name": loc.name, "address": loc.address, "phone": loc.phone} if loc else None

    def get_client(self, sale):
        c = sale.client
        if not c:
            return None
        out = {"name": c.name, "company": c.company}
        if self.context.get("internal"):
            out.update(phone=c.phone, email=c.email)
        return out

    def get_reference(self, sale):
        """The order or rental this sale came from."""
        if sale.shipment_id and sale.shipment:
            return sale.shipment.code
        if sale.rental_id and sale.rental:
            return sale.rental.code
        return ""

    def lines(self, sale):
        """Every item of the checkout. Cached, since several fields read it."""
        if getattr(self, "_lines_for", None) != sale.pk:
            self._lines_for, self._lines = sale.pk, list(sale.receipt_sales())
        return self._lines

    def get_items(self, sale):
        money = serializers.DecimalField(max_digits=14, decimal_places=2)
        return [
            {
                "name": s.product_name,
                "quantity": s.quantity,
                "unit_price": money.to_representation(s.unit_price),
                "amount": money.to_representation(s.unit_price * s.quantity),
                "returned": s.refunded_at is not None,
            }
            for s in self.lines(sale)
        ]

    def get_subtotal(self, sale):
        return self.money(sum(s.unit_price * s.quantity for s in self.lines(sale)))

    def get_discount(self, sale):
        return self.money(sum(s.discount for s in self.lines(sale)))

    def get_total(self, sale):
        return self.money(sum(s.revenue for s in self.lines(sale)))

    def get_refunded(self, sale):
        """What went back to the buyer for returned items."""
        return self.money(sum(s.revenue for s in self.lines(sale) if s.refunded_at))

    def get_refunded_at(self, sale):
        """When the last item came back, once every item has. Partly returned receipts stay paid."""
        dates = [s.refunded_at for s in self.lines(sale)]
        return serializers.DateTimeField().to_representation(max(dates)) if all(dates) else None

    @staticmethod
    def money(value):
        return serializers.DecimalField(max_digits=14, decimal_places=2).to_representation(value)

    def to_representation(self, sale):
        data = super().to_representation(sale)
        if not self.context.get("internal"):
            data.pop("receipt_token")
            data.pop("sold_by")
            data.pop("id")
        return data


class RentalReturnSerializer(serializers.Serializer):
    holidays = serializers.IntegerField(min_value=0, required=False, default=0)
    # How the rental was paid when it came back.
    payment_method = serializers.ChoiceField(choices=Sale.Method.choices, required=False, default=Sale.Method.CASH)


class StockRequestSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    product_unit = serializers.CharField(source="product.unit", read_only=True, default=None)
    to_location_id = tenant_field(Location, source="to_location")
    requested_by = serializers.CharField(source="requested_by.name", read_only=True, default="")
    requested_by_id = IdField()
    decided_by = serializers.CharField(source="decided_by.name", read_only=True, default="")
    transfer_id = IdField()
    from_location_id = serializers.SerializerMethodField()
    # "received" once the transfer it created has arrived.
    stage = serializers.SerializerMethodField()

    class Meta:
        model = StockRequest
        fields = [
            "id", "code", "product_id", "product_name", "product_unit", "quantity", "to_location_id", "note", "status",
            "stage", "requested_by",
            "requested_by_id", "created_at", "decided_by", "decided_at", "decision_note", "transfer_id", "from_location_id",
        ]
        read_only_fields = ["code", "status", "created_at", "decided_at", "decision_note"]

    def get_from_location_id(self, req):
        return str(req.transfer.from_location_id) if req.transfer and req.transfer.from_location_id else None

    def get_stage(self, req):
        if req.status == StockRequest.Status.APPROVED and req.transfer:
            return {"received": "received", "cancelled": "cancelled"}.get(req.transfer.status, "in_transit")
        return req.status


class ApproveRequestSerializer(serializers.Serializer):
    from_location_id = tenant_field(Location, source="from_location")
    quantity = serializers.IntegerField(min_value=1, required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class DeclineRequestSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class SupplierSerializer(serializers.ModelSerializer):
    id = IdField()

    class Meta:
        model = Supplier
        fields = ["id", "name", "company", "phone", "email", "address", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter at least 2 characters.")
        return value

    def to_representation(self, supplier):
        data = super().to_representation(supplier)
        if hasattr(supplier, "purchase_count"):
            data["stats"] = {
                "purchase_count": supplier.purchase_count,
                "spent": float(supplier.spent or 0),
                "last_purchase_at": supplier.last_purchase_at,
                # Open returns: what they still owe back, as money or replacements.
                "owed_back": float(supplier.owed_back or 0),
            }
            # What the business owes them. Owners and admins only, since payments are theirs to make.
            if self.context.get("show_owed"):
                data["stats"]["owed"] = float(supplier.owed or 0)
        return data


class PurchaseItemSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = IdField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    # How many were sent back to the supplier. Loaded with the purchase (see PurchaseViewSet).
    returned = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = PurchaseItem
        fields = ["id", "product_id", "product_name", "quantity", "unit_cost", "amount", "returned"]


class PurchaseSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    supplier = serializers.SerializerMethodField()
    location_id = IdField()
    created_by = serializers.CharField(source="created_by.name", read_only=True, default="")
    items = PurchaseItemSerializer(many=True, read_only=True)
    due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    payment_status = serializers.CharField(read_only=True)

    class Meta:
        model = Purchase
        fields = [
            "id", "code", "supplier", "location_id", "reference", "note", "purchased_at", "created_by", "created_at", "items", "total",
            "paid_amount", "due", "payment_status", "due_date",
        ]

    def get_supplier(self, purchase):
        s = purchase.supplier
        return {"id": str(s.id), "name": s.name, "company": s.company} if s else None


class NewProductSerializer(serializers.Serializer):
    """A product bought for the first time, created with the purchase. The rest is filled in later on its page."""

    name = serializers.CharField(max_length=200)
    unit = serializers.CharField(max_length=30, required=False, allow_blank=True, default="pcs")
    price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, default=0)
    barcode = serializers.CharField(max_length=128, required=False, allow_blank=True, default="")
    category = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    sku = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, data):
        data = {k: v.strip() if isinstance(v, str) else v for k, v in data.items()}
        if len(data["name"]) < 2:
            raise serializers.ValidationError({"name": "Enter the product's name."})
        data["sku"] = data["sku"].upper()
        return data


class PurchaseItemInputSerializer(serializers.Serializer):
    """An existing product (`product_id`) or a new one (`new_product`), with what was paid."""

    product_id = tenant_field(Product, source="product", required=False, allow_null=True)
    new_product = NewProductSerializer(required=False, allow_null=True)
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)


# How a supplier can be paid. "credit" only comes from a return.
PAYMENT_METHODS = [c for c in SupplierPayment.Method.choices if c[0] != SupplierPayment.Method.CREDIT]


class PurchaseCreateSerializer(serializers.Serializer):
    """A supplier's bill: the products bought, all received at one location."""

    supplier_id = tenant_field(Supplier, source="supplier", required=False, allow_null=True)
    location_id = tenant_field(Location, source="location")
    items = PurchaseItemInputSerializer(many=True, allow_empty=False, max_length=200)
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    # When it was bought, if not now. Never in the future.
    purchased_at = serializers.DateTimeField(required=False, allow_null=True)
    # What was paid now. Left out means all of it; less means the rest is bought on credit.
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False, allow_null=True)
    payment_method = serializers.ChoiceField(choices=PAYMENT_METHODS, required=False, default=SupplierPayment.Method.CASH)
    # When the rest is due. Optional.
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate_purchased_at(self, value):
        if value and value > timezone.now():
            raise serializers.ValidationError("The purchase date can't be in the future.")
        return value

    def validate_items(self, items):
        business = self.context["request"].user.business
        products = Product.objects.filter(business=business)
        seen = {"barcode": set(), "sku": set()}
        for item in items:
            new = item.get("new_product")
            if bool(new) == bool(item.get("product")):
                raise serializers.ValidationError("Each line needs a product, either an existing one or a new one.")
            if not new:
                continue
            for field, lookup in (("barcode", "barcode"), ("sku", "sku__iexact")):
                value = new[field]
                if not value:
                    continue
                if value.upper() in seen[field] or products.filter(**{lookup: value}).exists():
                    raise serializers.ValidationError(f'{field.upper() if field == "sku" else "Barcode"} "{value}" is already used by another product.')
                seen[field].add(value.upper())
        return items


class SupplierReturnSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    purchase_id = IdField()
    purchase_code = serializers.CharField(source="purchase.code", read_only=True)
    supplier = serializers.SerializerMethodField()
    location_id = IdField()
    product_id = IdField()
    value = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    outstanding = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    units_to_replace = serializers.IntegerField(read_only=True)
    created_by = serializers.CharField(source="created_by.name", read_only=True, default="")

    class Meta:
        model = SupplierReturn
        fields = [
            "id", "code", "purchase_id", "purchase_code", "supplier", "location_id", "product_id", "product_name", "quantity",
            "unit_cost", "reason", "status", "replaced_quantity", "refunded_amount", "credited_amount", "refund_method", "closed_note", "value",
            "outstanding", "units_to_replace", "created_by", "created_at", "finished_at",
        ]

    def get_supplier(self, ret):
        s = ret.supplier
        return {"id": str(s.id), "name": s.name, "company": s.company} if s else None


class SupplierReturnCreateSerializer(serializers.Serializer):
    # PurchaseItem has no business of its own; the view looks it up through its purchase.
    item_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=200)


class ReplacementSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1)


class RefundSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=SupplierReturn.RefundMethod.choices)


class CloseReturnSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class CreditSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))


class SupplierPaymentSerializer(serializers.ModelSerializer):
    id = IdField()
    code = serializers.CharField(read_only=True)
    supplier = serializers.SerializerMethodField()
    return_code = serializers.CharField(source="supplier_return.code", read_only=True, default=None)
    created_by = serializers.CharField(source="created_by.name", read_only=True, default="")
    # Which bills it paid, and how much of each.
    allocations = serializers.SerializerMethodField()

    class Meta:
        model = SupplierPayment
        fields = ["id", "code", "supplier", "amount", "method", "paid_at", "note", "return_code", "created_by", "created_at", "allocations"]

    def get_supplier(self, payment):
        s = payment.supplier
        return {"id": str(s.id), "name": s.name, "company": s.company} if s else None

    def get_allocations(self, payment):
        return [
            {"purchase_id": str(a.purchase_id), "purchase_code": a.purchase.code, "amount": float(a.amount)}
            for a in payment.allocations.all()
        ]


class SupplierPaymentCreateSerializer(serializers.Serializer):
    supplier_id = tenant_field(Supplier, source="supplier")
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=PAYMENT_METHODS)
    paid_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_paid_at(self, value):
        if value and value > timezone.now():
            raise serializers.ValidationError("The payment date can't be in the future.")
        return value
