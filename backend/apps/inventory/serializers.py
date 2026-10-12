from rest_framework import serializers

from apps.api import IdField, tenant_field

from .models import Activity, Client, Location, Product, Rental, Shipment, ShipmentEvent, StockLevel, Transfer

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

    class Meta:
        model = Shipment
        fields = [
            "id", "code", "product_id", "quantity", "client_id", "from_location_id", "status", "notes",
            "created_at", "history",
        ]
        read_only_fields = ["code", "status", "created_at"]


class ShipmentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Shipment.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class RentalSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    client_id = tenant_field(Client, source="client")
    location_id = tenant_field(Location, source="location")

    class Meta:
        model = Rental
        fields = [
            "id", "code", "product_id", "quantity", "client_id", "location_id", "start_date", "days", "plan",
            "rate", "deposit", "total", "status", "returned_at", "notes", "created_at",
        ]
        read_only_fields = ["code", "total", "status", "returned_at", "created_at"]


class TransferSerializer(serializers.ModelSerializer):
    id = IdField()
    product_id = tenant_field(Product, source="product")
    from_location_id = tenant_field(Location, source="from_location")
    to_location_id = tenant_field(Location, source="to_location")
    created_by = serializers.CharField(source="created_by.name", read_only=True, default="")

    class Meta:
        model = Transfer
        fields = [
            "id", "code", "product_id", "quantity", "from_location_id", "to_location_id", "status",
            "created_at", "created_by", "received_at",
        ]
        read_only_fields = ["code", "status", "created_at", "received_at"]


class ActivitySerializer(serializers.ModelSerializer):
    id = IdField()
    user = serializers.CharField(source="user.name", read_only=True, default="")

    class Meta:
        model = Activity
        fields = ["id", "at", "user", "action", "detail"]
