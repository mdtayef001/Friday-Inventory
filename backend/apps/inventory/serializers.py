from rest_framework import serializers

from .models import Activity, Client, Location, Product, Rental, Shipment, ShipmentEvent, StockLevel, Transfer


class TenantRelatedField(serializers.PrimaryKeyRelatedField):
    """Only accepts ids from the requesting user's own business."""

    def get_queryset(self):
        return super().get_queryset().filter(business=self.context["request"].user.business)


def tenant_field(model, **kwargs):
    return TenantRelatedField(queryset=model.objects.all(), **kwargs)


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ["id", "name", "type", "address", "phone"]


class ProductSerializer(serializers.ModelSerializer):
    rent_rates = serializers.DictField(child=serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0), required=False)
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
        data["rent_rates"] = {k: float(v) for k, v in rates.items() if v is not None}
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

        if "rent_rates" in attrs:
            rates = attrs.pop("rent_rates")
            for plan in self.PLANS:
                attrs[f"rent_{plan}"] = rates.get(plan)
        return attrs


class ProductCreateSerializer(ProductSerializer):
    """Adds optional opening stock when a product is created."""

    initial_location = tenant_field(Location, required=False, allow_null=True, write_only=True)
    initial_quantity = serializers.IntegerField(min_value=0, required=False, default=0, write_only=True)

    class Meta(ProductSerializer.Meta):
        fields = ProductSerializer.Meta.fields + ["initial_location", "initial_quantity"]


class StockLevelSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(read_only=True)
    location_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockLevel
        fields = ["product_id", "location_id", "quantity"]


class StockAdjustSerializer(serializers.Serializer):
    product = tenant_field(Product)
    location = tenant_field(Location)
    delta = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=200)


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "name", "company", "phone", "email", "address", "created_at"]
        read_only_fields = ["created_at"]


class ShipmentEventSerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="by.name", read_only=True, default=None)

    class Meta:
        model = ShipmentEvent
        fields = ["status", "at", "by", "note"]


class ShipmentSerializer(serializers.ModelSerializer):
    product = tenant_field(Product)
    client = tenant_field(Client)
    from_location = tenant_field(Location)
    history = ShipmentEventSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = ["id", "code", "product", "quantity", "client", "from_location", "status", "notes", "created_at", "history"]
        read_only_fields = ["code", "status", "created_at"]


class ShipmentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Shipment.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class RentalSerializer(serializers.ModelSerializer):
    product = tenant_field(Product)
    client = tenant_field(Client)
    location = tenant_field(Location)

    class Meta:
        model = Rental
        fields = [
            "id", "code", "product", "quantity", "client", "location", "start_date", "days", "plan",
            "rate", "deposit", "total", "status", "returned_at", "notes", "created_at",
        ]
        read_only_fields = ["code", "total", "status", "returned_at", "created_at"]


class TransferSerializer(serializers.ModelSerializer):
    product = tenant_field(Product)
    from_location = tenant_field(Location)
    to_location = tenant_field(Location)
    created_by = serializers.CharField(source="created_by.name", read_only=True, default=None)

    class Meta:
        model = Transfer
        fields = [
            "id", "code", "product", "quantity", "from_location", "to_location", "status",
            "created_at", "created_by", "received_at",
        ]
        read_only_fields = ["code", "status", "created_at", "received_at"]


class ActivitySerializer(serializers.ModelSerializer):
    user = serializers.CharField(source="user.name", read_only=True, default=None)

    class Meta:
        model = Activity
        fields = ["id", "at", "user", "action", "detail"]
