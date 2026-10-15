from rest_framework import serializers

from apps.api import IdField, tenant_field

from .models import Activity, Client, Location, Product, Rental, Sale, Shipment, ShipmentEvent, StockLevel, StockRequest, Transfer

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


# Paid at the counter or on the doorstep: everything but SSLCommerz.
OFFLINE_METHODS = [c for c in Sale.Method.choices if c[0] != Sale.Method.ONLINE]


class ShipmentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Shipment.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    # How the client paid. Only used when the order is marked delivered.
    payment_method = serializers.ChoiceField(choices=OFFLINE_METHODS, required=False, default=Sale.Method.CASH)


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
    # Null until the sale is paid.
    receipt_no = serializers.CharField(source="receipt_code", read_only=True)
    receipt_token = serializers.SerializerMethodField()

    PRIVATE = ("unit_cost", "cost", "profit")

    class Meta:
        model = Sale
        fields = [
            "id", "channel", "product_id", "product_name", "quantity", "unit_price", "unit_cost", "discount",
            "revenue", "cost", "profit", "location_id", "client_id", "client_name", "order_id", "rental_id", "sold_by",
            "sold_by_id", "sold_at", "refunded_at", "payment_method", "payment_status", "gateway_method",
            "payment_reference", "receipt_no", "receipt_token", "refunded_by", "refund_reason", "refund_status",
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


class SellSerializer(serializers.Serializer):
    product_id = tenant_field(Product, source="product")
    location_id = tenant_field(Location, source="location")
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
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
    """A paid sale as the buyer's receipt. Never cost or profit. The team's copy
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
    total = serializers.DecimalField(source="revenue", max_digits=14, decimal_places=2)
    payment_label = serializers.CharField(source="get_payment_method_display")
    sold_by = serializers.CharField(source="sold_by.name", default="")

    class Meta:
        model = Sale
        fields = [
            "id", "receipt_no", "receipt_token", "business_name", "currency", "shop", "sold_at", "channel", "reference",
            "client", "items", "subtotal", "discount", "total", "payment_method", "payment_label", "gateway_method",
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

    def get_items(self, sale):
        # One line for now; a checkout with several items will group sales under one receipt.
        money = serializers.DecimalField(max_digits=14, decimal_places=2)
        return [{
            "name": sale.product_name,
            "quantity": sale.quantity,
            "unit_price": money.to_representation(sale.unit_price),
            "amount": money.to_representation(sale.unit_price * sale.quantity),
        }]

    def get_subtotal(self, sale):
        return serializers.DecimalField(max_digits=14, decimal_places=2).to_representation(sale.unit_price * sale.quantity)

    def to_representation(self, sale):
        data = super().to_representation(sale)
        if not self.context.get("internal"):
            data.pop("receipt_token")
            data.pop("sold_by")
            data.pop("id")
        return data


class RentalReturnSerializer(serializers.Serializer):
    holidays = serializers.IntegerField(min_value=0, required=False, default=0)
    # How the rental was paid when it came back. Online isn't offered here.
    payment_method = serializers.ChoiceField(choices=OFFLINE_METHODS, required=False, default=Sale.Method.CASH)


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
