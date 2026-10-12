from django.contrib.auth.password_validation import validate_password
from django.db.models import Max
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.api import IdField, StrPrimaryKeyRelatedField
from apps.inventory.models import Location

from .models import Business, User
from .permissions import creatable_roles

# Shapes follow frontend/src/lib/types.ts (camelCased on the wire).

CURRENCIES = ["USD", "EUR", "GBP", "BDT", "INR", "AED", "SAR", "CAD", "AUD"]
MODULES = ["rentals", "tracking", "transfers", "trackingLinks"]
PERMISSIONS = ["managerUsers", "managerActivity", "managerProducts", "managerLocations", "staffCreateProducts", "managerProfit"]


class LoginSerializer(TokenObtainPairSerializer):
    """Adds the role and tenant to the token so the frontend can route without an extra call."""

    default_error_messages = {"no_active_account": "Incorrect email or password."}

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["tenant_id"] = str(user.business_id) if user.business_id else None
        return token

    def validate(self, attrs):
        attrs[self.username_field] = attrs.get(self.username_field, "").lower()
        data = super().validate(attrs)
        data["user"] = SessionUserSerializer(self.user).data
        return data


class SessionUserSerializer(serializers.ModelSerializer):
    id = IdField()
    tenant_id = IdField(source="business_id")
    location_ids = StrPrimaryKeyRelatedField(source="locations", many=True, read_only=True)

    class Meta:
        model = User
        fields = ["id", "name", "email", "role", "tenant_id", "location_ids"]


class BusinessSerializer(serializers.ModelSerializer):
    id = IdField()
    status = serializers.CharField(read_only=True)

    class Meta:
        model = Business
        fields = ["id", "name", "industry", "status", "suspended", "trial_ends_at", "paid_until", "created_at", "settings"]
        read_only_fields = ["suspended", "trial_ends_at", "paid_until", "created_at"]

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Business name must be at least 2 characters.")
        return value

    def validate_settings(self, value):
        """Exactly the shape of BusinessSettings in the frontend, nothing more."""
        try:
            modules, permissions = value["modules"], value["permissions"]
            clean = {
                "currency": value["currency"],
                "modules": {k: modules[k] for k in MODULES},
                "permissions": {k: permissions[k] for k in PERMISSIONS},
            }
        except (KeyError, TypeError):
            raise serializers.ValidationError("Settings are incomplete.")
        if clean["currency"] not in CURRENCIES:
            raise serializers.ValidationError("Unsupported currency.")
        flags = [*clean["modules"].values(), *clean["permissions"].values()]
        if not all(isinstance(f, bool) for f in flags):
            raise serializers.ValidationError("Feature switches must be on or off.")
        return clean


class BusinessSummarySerializer(BusinessSerializer):
    """For the super admin: adds the owner, team size and last login."""

    owner = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    last_active_at = serializers.SerializerMethodField()

    class Meta(BusinessSerializer.Meta):
        fields = BusinessSerializer.Meta.fields + ["owner", "user_count", "last_active_at"]

    def get_owner(self, business):
        owner = business.users.filter(role=User.Role.OWNER).order_by("date_joined").first()
        return {"id": str(owner.id), "name": owner.name, "email": owner.email} if owner else None

    def get_user_count(self, business):
        return business.users.count()

    def get_last_active_at(self, business):
        last = business.users.aggregate(last=Max("last_login"))["last"]
        return serializers.DateTimeField().to_representation(last) if last else None


class ManagedUserSerializer(serializers.ModelSerializer):
    id = IdField()
    tenant_id = IdField(source="business_id")
    location_ids = StrPrimaryKeyRelatedField(
        source="locations", many=True, required=False, queryset=Location.objects.all()
    )
    active = serializers.BooleanField(source="is_active", required=False)
    created_at = serializers.DateTimeField(source="date_joined", read_only=True)
    created_by = IdField(source="created_by_id")
    last_login_at = serializers.DateTimeField(source="last_login", read_only=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8, max_length=128)

    class Meta:
        model = User
        fields = [
            "id", "name", "email", "role", "tenant_id", "location_ids", "active", "created_at",
            "created_by", "last_login_at", "password",
        ]

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name must be at least 2 characters.")
        return value

    def validate_email(self, value):
        value = value.lower()
        taken = User.objects.filter(email=value)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_role(self, value):
        if value not in creatable_roles(self.context["request"].user.role):
            raise serializers.ValidationError("You are not allowed to create this type of account.")
        return value

    def validate_location_ids(self, locations):
        actor = self.context["request"].user
        if any(loc.business_id != actor.business_id for loc in locations):
            raise serializers.ValidationError("Unknown location.")
        if actor.role == User.Role.MANAGER:
            own = set(actor.locations.values_list("id", flat=True))
            if any(loc.id not in own for loc in locations):
                raise serializers.ValidationError("You can only assign your own locations.")
        return locations

    def validate(self, attrs):
        if self.instance is None:
            if not attrs.get("password"):
                raise serializers.ValidationError({"password": "A password is required for new users."})
            if attrs.get("role") != User.Role.OWNER and not attrs.get("locations"):
                raise serializers.ValidationError({"location_ids": "Assign at least one location."})
        if attrs.get("password"):
            validate_password(attrs["password"], self.instance)
        return attrs

    def create(self, validated):
        actor = self.context["request"].user
        locations = validated.pop("locations", [])
        user = User.objects.create_user(business=actor.business, created_by=actor, **validated)
        if user.role != User.Role.OWNER:
            user.locations.set(locations)
        return user

    def update(self, user, validated):
        password = validated.pop("password", None)
        locations = validated.pop("locations", None)
        for field, value in validated.items():
            setattr(user, field, value)
        if password:
            user.set_password(password)
        user.save()
        if locations is not None:
            user.locations.set(locations)
        return user


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(min_length=8, max_length=128)


class BusinessWithOwnerSerializer(serializers.Serializer):
    """Super admin creates a business and its first owner in one step."""

    name = serializers.CharField(max_length=80, min_length=2)
    industry = serializers.CharField(max_length=60, required=False, allow_blank=True)
    owner_name = serializers.CharField(max_length=80, min_length=2)
    owner_email = serializers.EmailField()
    owner_password = serializers.CharField(min_length=8, max_length=128)

    def validate_owner_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def create(self, validated):
        business = Business.objects.create(name=validated["name"].strip(), industry=validated.get("industry", "").strip())
        # A brand-new business starts with one shop, like the frontend's createEmpty().
        Location.objects.create(
            business=business, name="Main Store", type=Location.Type.OUTLET,
            address="Add your address in Warehouses & Shops",
        )
        User.objects.create_user(
            email=validated["owner_email"],
            password=validated["owner_password"],
            name=validated["owner_name"].strip(),
            role=User.Role.OWNER,
            business=business,
            created_by=self.context["request"].user,
        )
        return business

    def to_representation(self, business):
        return BusinessSummarySerializer(business).data
