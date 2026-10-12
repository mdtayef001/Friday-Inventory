from datetime import timedelta

from decimal import Decimal

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import TEAM, IsTenantMember, ManagerNeedsPermission, allowed_location_ids

from . import services
from .models import Activity, Client, Location, Product, Rental, Sale, Shipment, StockLevel, Transfer
from .serializers import (
    ActivitySerializer,
    ClientSerializer,
    LocationSerializer,
    ProductCreateSerializer,
    ProductSerializer,
    PublicTrackingSerializer,
    RentalSerializer,
    SaleSerializer,
    SellSerializer,
    ShipmentSerializer,
    ShipmentStatusSerializer,
    StockAdjustSerializer,
    StockLevelSerializer,
    TransferSerializer,
)


class TenantViewSet(viewsets.GenericViewSet):
    """Scopes every query to the user's business. Defaults to owners and managers."""

    permission_classes = [IsTenantMember, ManagerNeedsPermission]
    model = None

    def get_queryset(self):
        return self.model.objects.filter(business=self.request.user.business)

    def check_location(self, *locations):
        """Managers and staff can only touch stock at their own locations."""
        allowed = allowed_location_ids(self.request.user)
        if allowed is None:
            return
        for location in locations:
            if location.id not in allowed:
                raise PermissionDenied(f"You don't work at {location.name}.")

    def scope_to_locations(self, qs, *fields):
        """Keep rows that touch at least one of the user's locations."""
        allowed = allowed_location_ids(self.request.user)
        if allowed is None:
            return qs
        query = Q()
        for field in fields:
            query |= Q(**{f"{field}__in": allowed})
        return qs.filter(query)


class LocationViewSet(TenantViewSet, viewsets.ModelViewSet):
    model = Location
    serializer_class = LocationSerializer
    allowed_roles = TEAM
    manager_permission = "managerLocations"

    # Everyone sees every location's name (transfers and lookups need them);
    # stock and edits stay limited to the user's own locations.

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            role = request.user.role
            # Only owners add or delete locations; managers may edit their own.
            editing = self.action in ("update", "partial_update")
            if role == User.Role.STAFF or (role == User.Role.MANAGER and not editing):
                raise PermissionDenied()

    def perform_create(self, serializer):
        location = serializer.save(business=self.request.user.business)
        services.log(self.request.user, "Location added", f"{location.name} ({location.type})")

    def perform_update(self, serializer):
        self.check_location(serializer.instance)
        location = serializer.save()
        services.log(self.request.user, "Location updated", location.name)

    def perform_destroy(self, location):
        services.check_location_deletable(location)
        services.log(self.request.user, "Location deleted", location.name)
        location.delete()


class ProductViewSet(TenantViewSet, viewsets.ModelViewSet):
    model = Product
    allowed_roles = TEAM
    manager_permission = "managerProducts"

    def get_serializer_class(self):
        return ProductCreateSerializer if self.action == "create" else ProductSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("created_by")
        # Fast lookup for the scanner on the entry page: ?code=<barcode or sku>
        code = self.request.query_params.get("code")
        if code:
            qs = qs.filter(Q(barcode=code) | Q(sku__iexact=code))
        return qs

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        user = request.user
        if user.role == User.Role.STAFF:
            # Staff may only create, and only when the owner allows it.
            if self.action != "create" or not user.business.permission_on("staffCreateProducts"):
                raise PermissionDenied()

    def perform_create(self, serializer):
        location = serializer.validated_data.pop("initial_location", None)
        quantity = serializer.validated_data.pop("initial_quantity", 0)
        if location and quantity:
            self.check_location(location)
        product = serializer.save(business=self.request.user.business, created_by=self.request.user)
        services.add_product(self.request.user, product, location, quantity)

    def perform_update(self, serializer):
        product = serializer.save()
        services.log(self.request.user, "Product updated", product.name)

    def perform_destroy(self, product):
        services.check_product_deletable(product)
        services.log(self.request.user, "Product deleted", product.name)
        product.delete()


class StockViewSet(TenantViewSet, mixins.ListModelMixin):
    model = StockLevel
    serializer_class = StockLevelSerializer
    allowed_roles = TEAM

    def get_queryset(self):
        return self.scope_to_locations(super().get_queryset(), "location_id")

    @action(detail=False, methods=["post"])
    def adjust(self, request):
        serializer = StockAdjustSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self.check_location(data["location"])
        services.adjust_stock(request.user, data["product"], data["location"], data["delta"], data.get("reason", ""))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientViewSet(TenantViewSet, viewsets.ModelViewSet):
    model = Client
    serializer_class = ClientSerializer

    def perform_create(self, serializer):
        client = serializer.save(business=self.request.user.business)
        services.log(self.request.user, "Client added", client.name)

    def perform_update(self, serializer):
        client = serializer.save()
        services.log(self.request.user, "Client updated", client.name)

    def perform_destroy(self, client):
        services.check_client_deletable(client)
        services.log(self.request.user, "Client deleted", client.name)
        client.delete()


class ShipmentViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    model = Shipment
    serializer_class = ShipmentSerializer
    module = "tracking"

    def get_queryset(self):
        qs = super().get_queryset().prefetch_related("history__by")
        return self.scope_to_locations(qs, "from_location_id")

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["from_location"])
        serializer.instance = services.create_shipment(self.request.user, **data)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        serializer = ShipmentStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shipment = services.set_shipment_status(request.user, self.get_object(), **serializer.validated_data)
        return Response(ShipmentSerializer(shipment, context={"request": request}).data)


class RentalViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    model = Rental
    serializer_class = RentalSerializer
    module = "rentals"

    def get_queryset(self):
        return self.scope_to_locations(super().get_queryset(), "location_id")

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["location"])
        serializer.instance = services.create_rental(self.request.user, **data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_(self, request, pk=None):
        rental = services.return_rental(request.user, self.get_object())
        return Response(RentalSerializer(rental, context={"request": request}).data)


class TransferViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    model = Transfer
    serializer_class = TransferSerializer
    module = "transfers"

    def get_queryset(self):
        qs = super().get_queryset().select_related("created_by")
        return self.scope_to_locations(qs, "from_location_id", "to_location_id")

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["from_location"])
        serializer.instance = services.create_transfer(self.request.user, **data)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        transfer = self.get_object()
        self.check_location(transfer.to_location)
        transfer = services.receive_transfer(request.user, transfer)
        return Response(TransferSerializer(transfer, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        transfer = self.get_object()
        self.check_location(transfer.from_location)
        transfer = services.cancel_transfer(request.user, transfer)
        return Response(TransferSerializer(transfer, context={"request": request}).data)


class ActivityViewSet(TenantViewSet, mixins.ListModelMixin):
    model = Activity
    serializer_class = ActivitySerializer

    def get_queryset(self):
        return super().get_queryset().select_related("user")

    def list(self, request):
        # The most recent 500 entries, like the frontend's log.
        return Response(self.get_serializer(self.get_queryset()[:500], many=True).data)

    def check_permissions(self, request):
        super().check_permissions(request)
        user = request.user
        if user.role == User.Role.MANAGER and not user.business.permission_on("managerActivity"):
            raise PermissionDenied()


class PublicTrackingView(APIView):
    """A client's order tracking link. No login: the long random token is the key.

    Hidden when the owner turns client links off, when the business is locked
    or suspended, and 30 days after the order is finished.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        shipment = (
            Shipment.objects.select_related("business", "product", "from_location")
            .prefetch_related("history")
            .filter(tracking_token=token)
            .first()
        )
        if not shipment or not self.visible(shipment):
            raise NotFound("This tracking link isn't available.")
        return Response(PublicTrackingSerializer(shipment).data)

    @staticmethod
    def visible(shipment):
        business = shipment.business
        if not business.is_open or not business.module_on("tracking") or not business.module_on("trackingLinks"):
            return False
        if shipment.status in Shipment.CLOSED:
            last = shipment.history.all()
            closed_at = max((e.at for e in last), default=shipment.created_at)
            if timezone.now() - closed_at > timedelta(days=Shipment.TRACKING_LINK_DAYS):
                return False
        return True


class SaleViewSet(TenantViewSet, mixins.ListModelMixin, mixins.CreateModelMixin):
    """Sales. Anyone on the team can record a walk-in sale at their own shops;
    owners and managers can list them (managers only for their shops). Cost and
    profit are shown to owners only."""

    model = Sale
    serializer_class = SaleSerializer
    allowed_roles = TEAM

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "show_profit": self.request.user.role == User.Role.OWNER}

    LIST_LIMIT = 500

    def get_queryset(self):
        qs = super().get_queryset().select_related("sold_by")
        return self.scope_to_locations(qs, "location_id")

    def filtered(self):
        """Sales matching ?from=&to= (ISO times), ?location=, ?product=, ?seller= and ?channel=."""
        qs = self.get_queryset()
        params = self.request.query_params
        for name, lookup in (("from", "sold_at__gte"), ("to", "sold_at__lt")):
            if params.get(name):
                when = parse_datetime(params[name])
                if when is None:
                    raise ValidationError({name: "Use an ISO date and time."})
                qs = qs.filter(**{lookup: when})
        for name, field in (("location", "location_id"), ("product", "product_id"), ("seller", "sold_by_id")):
            if params.get(name):
                if not params[name].isdigit():
                    raise ValidationError({name: "Unknown id."})
                qs = qs.filter(**{field: int(params[name])})
        if params.get("channel"):
            if params["channel"] not in Sale.Channel.values:
                raise ValidationError({"channel": "Unknown sale type."})
            qs = qs.filter(channel=params["channel"])
        return qs

    def check_can_read(self):
        if self.request.user.role == User.Role.STAFF:
            raise PermissionDenied()

    def list(self, request):
        """The newest sales matching the filters (up to 500; the summary has the full totals)."""
        self.check_can_read()
        sales = self.filtered()[: self.LIST_LIMIT]
        return Response(self.get_serializer(sales, many=True).data)

    @action(detail=False)
    def summary(self, request):
        """Totals for the filtered sales. Refunded sales are counted separately and left out."""
        self.check_can_read()
        qs = self.filtered()
        money = DecimalField(max_digits=16, decimal_places=2)
        revenue = ExpressionWrapper(F("unit_price") * F("quantity") - F("discount"), output_field=money)
        cost = ExpressionWrapper(F("unit_cost") * F("quantity"), output_field=money)
        zero = Decimal("0")

        def totals(rows):
            agg = rows.aggregate(count=Count("id"), revenue=Sum(revenue), cost=Sum(cost), units=Sum("quantity"))
            r, c = agg["revenue"] or zero, agg["cost"] or zero
            return {"count": agg["count"], "revenue": r, "cost": c, "profit": r - c, "units": agg["units"] or 0}

        counted = qs.filter(refunded_at__isnull=True)
        overall = totals(counted)
        channels = {ch: totals(counted.filter(channel=ch)) for ch in Sale.Channel.values}
        show_profit = request.user.role == User.Role.OWNER

        def public(t):
            out = {"count": t["count"], "revenue": float(t["revenue"])}
            if show_profit:
                out.update(cost=float(t["cost"]), profit=float(t["profit"]))
            return out

        data = {
            **public(overall),
            # Units of products sold; a rental is income, not units sold.
            "units_sold": channels["store"]["units"] + channels["order"]["units"],
            "refunded_count": qs.filter(refunded_at__isnull=False).count(),
            "channels": {ch: public(t) for ch, t in channels.items()},
            # Everyone who has sold within this user's view, for the seller filter.
            "sellers": [
                {"id": str(uid), "name": name}
                for uid, name in self.get_queryset().filter(sold_by__isnull=False)
                .values_list("sold_by_id", "sold_by__name").distinct().order_by("sold_by__name")
            ],
        }
        if show_profit:
            data["margin"] = round(float(overall["profit"] / overall["revenue"] * 100), 1) if overall["revenue"] else None
        return Response(data)

    def create(self, request):
        serializer = SellSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get("client") and request.user.role == User.Role.STAFF:
            # Staff can't see the client list, so they can't pick one either.
            data["client"] = None
        self.check_location(data["location"])
        sale = services.sell(request.user, **data)
        return Response(self.get_serializer(sale).data, status=status.HTTP_201_CREATED)
