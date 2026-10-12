from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.inventory.models import Location

from .models import Business, User
from .permissions import creatable_roles


class LoginSerializer(TokenObtainPairSerializer):
    """Adds the role and tenant to the token so the frontend can route without an extra call."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["name"] = user.name
        token["role"] = user.role
        token["tenantId"] = user.business_id
        return token

    def validate(self, attrs):
        attrs["email"] = attrs.get("email", "").lower()
        data = super().validate(attrs)
        if self.user.business and self.user.business.suspended:
            raise serializers.ValidationError("This business has been suspended. Contact support.")
        data["user"] = SessionUserSerializer(self.user).data
        return data


class SessionUserSerializer(serializers.ModelSerializer):
    tenant_id = serializers.IntegerField(source="business_id", read_only=True)
    location_ids = serializers.PrimaryKeyRelatedField(source="locations", many=True, read_only=True)

    class Meta:
        model = User
        fields = ["id", "name", "email", "role", "tenant_id", "location_ids"]


class BusinessSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)

    class Meta:
        model = Business
        fields = ["id", "name", "industry", "status", "suspended", "trial_ends_at", "paid_until", "created_at", "settings"]
        read_only_fields = ["suspended", "trial_ends_at", "paid_until", "created_at"]


class ManagedUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])
    location_ids = serializers.PrimaryKeyRelatedField(
        source="locations", many=True, required=False, queryset=Location.objects.all()
    )

    class Meta:
        model = User
        fields = ["id", "name", "email", "role", "location_ids", "is_active", "date_joined", "last_login", "password"]
        read_only_fields = ["date_joined", "last_login"]

    def validate_email(self, value):
        return value.lower()

    def validate_role(self, value):
        if value not in creatable_roles(self.context["request"].user.role):
            raise serializers.ValidationError("You can't create users with this role.")
        return value

    def validate_location_ids(self, locations):
        actor = self.context["request"].user
        for loc in locations:
            if loc.business_id != actor.business_id:
                raise serializers.ValidationError("Unknown location.")
        return locations

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "A password is required for new users."})
        return attrs

    def create(self, validated):
        actor = self.context["request"].user
        locations = validated.pop("locations", [])
        password = validated.pop("password")
        user = User.objects.create_user(
            password=password, business=actor.business, created_by=actor, **validated
        )
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


class BusinessWithOwnerSerializer(serializers.Serializer):
    """Super admin creates a business and its first owner in one step."""

    name = serializers.CharField(max_length=200)
    industry = serializers.CharField(max_length=100, required=False, allow_blank=True)
    owner_name = serializers.CharField(max_length=150)
    owner_email = serializers.EmailField()
    owner_password = serializers.CharField(validators=[validate_password])

    def validate_owner_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def create(self, validated):
        business = Business.objects.create(name=validated["name"], industry=validated.get("industry", ""))
        User.objects.create_user(
            email=validated["owner_email"],
            password=validated["owner_password"],
            name=validated["owner_name"],
            role=User.Role.OWNER,
            business=business,
            created_by=self.context["request"].user,
        )
        return business

    def to_representation(self, business):
        return BusinessSerializer(business).data
