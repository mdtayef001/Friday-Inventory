from datetime import timedelta

import csv
import re
from decimal import Decimal

from django.db.models import (
    Case, Count, DecimalField, Exists, ExpressionWrapper, F, IntegerField, Max, Min, OuterRef, Prefetch, Q, Subquery, Sum, Value,
    When,
)
from django.db.models.functions import Coalesce, TruncDay, TruncMonth
from django.http import HttpResponse
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
from apps.api import Pagination

from . import services
from .models import (
    Activity, Client, Location, Product, Purchase, PurchaseItem, Rental, Sale, Shipment, StockLevel, StockRequest, Supplier, SupplierPayment,
    SupplierReturn, Transfer,
)
from .serializers import (
    ActivitySerializer,
    ApproveRequestSerializer,
    DeclineRequestSerializer,
    ClientSerializer,
    CloseReturnSerializer,
    CreditSerializer,
    LocationSerializer,
    ProductCreateSerializer,
    ProductSerializer,
    PurchaseCreateSerializer,
    PurchaseSerializer,
    RefundSerializer,
    ReplacementSerializer,
    PublicTrackingSerializer,
    ReceiptSerializer,
    RentalReturnSerializer,
    RentalSerializer,
    SaleSerializer,
    SellSerializer,
    ShipmentSerializer,
    ShipmentStatusSerializer,
    StockAdjustSerializer,
    StockLevelSerializer,
    StockRequestSerializer,
    SupplierPaymentCreateSerializer,
    SupplierPaymentSerializer,
    SupplierReturnCreateSerializer,
    SupplierReturnSerializer,
    SupplierSerializer,
    TransferSerializer,
)


def product_totals(user):
    """The business's products, each annotated with `scoped_total`: its stock across the user's locations."""
    allowed = allowed_location_ids(user)
    here = Q() if allowed is None else Q(stock__location_id__in=allowed)
    return Product.objects.filter(business=user.business).annotate(scoped_total=Coalesce(Sum("stock__quantity", filter=here), 0))


class TenantViewSet(viewsets.GenericViewSet):
    """Scopes every query to the user's business. Defaults to owners and managers."""

    permission_classes = [IsTenantMember, ManagerNeedsPermission]
    pagination_class = Pagination
    model = None
    # Fields ?search= looks in, ignoring case.
    search_fields = ()

    def get_queryset(self):
        return self.model.objects.filter(business=self.request.user.business)

    def search(self, qs):
        term = self.request.query_params.get("search", "").strip()
        if not term or not self.search_fields:
            return qs
        query = Q()
        for field in self.search_fields:
            query |= Q(**{f"{field}__icontains": term})
        return qs.filter(query)

    def id_param(self, name):
        """A numeric id from the query string, or None when it isn't given."""
        value = self.request.query_params.get(name)
        if not value:
            return None
        if not value.isdigit():
            raise ValidationError({name: "Unknown id."})
        return int(value)

    def filter_by_ids(self, qs, **fields):
        """?<param>=<id> for each param -> field pair, e.g. product="product_id"."""
        for param, field in fields.items():
            value = self.id_param(param)
            if value is not None:
                qs = qs.filter(**{field: value})
        return qs

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
    # A handful per business, and every page needs their names.
    pagination_class = None

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
    """Products, each with its stock at the user's locations (`stock` and `total`).

    List filters: ?search=, ?code= (exact barcode or SKU, for scanners), ?category=,
    ?rentable=1, ?location=<id> (kept there; add &in_stock=1 for some left there),
    ?stock=in|low|out (by the total at the user's locations), ?attention=1 (low or
    empty at one of the user's locations) and ?ordering=name.
    """

    model = Product
    allowed_roles = TEAM
    manager_permission = "managerProducts"
    search_fields = ("name", "sku", "barcode", "category")

    def get_serializer_class(self):
        return ProductCreateSerializer if self.action == "create" else ProductSerializer

    def get_queryset(self):
        allowed = allowed_location_ids(self.request.user)
        rows = StockLevel.objects.all() if allowed is None else StockLevel.objects.filter(location_id__in=allowed)
        return (
            super()
            .get_queryset()
            .select_related("created_by")
            .prefetch_related(Prefetch("stock", queryset=rows, to_attr="scoped_stock"))
        )

    def filter_queryset(self, qs):
        params = self.request.query_params
        allowed = allowed_location_ids(self.request.user)
        qs = self.search(qs)
        code = params.get("code", "").strip()
        if code:
            qs = qs.filter(Q(barcode=code) | Q(sku__iexact=code))
        if params.get("category"):
            qs = qs.filter(category=params["category"])
        if params.get("rentable") == "1":
            qs = qs.filter(rentable=True)

        location = self.id_param("location")
        if location is not None:
            if allowed is not None and location not in allowed:
                return qs.none()
            rows = StockLevel.objects.filter(product=OuterRef("pk"), location_id=location)
            if params.get("in_stock") == "1":
                rows = rows.filter(quantity__gt=0)
            qs = qs.filter(Exists(rows))

        here = Q() if allowed is None else Q(stock__location_id__in=allowed)
        level = params.get("stock")
        if level in ("in", "low", "out"):
            qs = qs.annotate(scoped_total=Coalesce(Sum("stock__quantity", filter=here), 0))
            if level == "out":
                qs = qs.filter(scoped_total=0)
            elif level == "low":
                qs = qs.filter(scoped_total__gt=0, scoped_total__lte=F("low_stock_threshold"))
            else:
                qs = qs.filter(scoped_total__gt=F("low_stock_threshold"))
        if params.get("attention") == "1":
            # A location with no stock row counts as empty, so: fewer healthy rows than locations.
            locations = Location.objects.filter(business=self.request.user.business).count() if allowed is None else len(allowed)
            healthy = Count("stock", filter=here & Q(stock__quantity__gt=F("low_stock_threshold")))
            qs = qs.annotate(healthy=healthy).filter(healthy__lt=locations)
        if params.get("ordering") == "name":
            qs = qs.order_by("name")
        return qs

    @action(detail=False)
    def categories(self, request):
        """Every category in use, for filters and the product form."""
        names = (
            Product.objects.filter(business=request.user.business)
            .exclude(category="")
            .values_list("category", flat=True)
            .distinct()
            .order_by("category")
        )
        return Response(list(names))

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        user = request.user
        if user.role == User.Role.STAFF:
            # Staff may only create, only when the owner allows it, and only if they may add stock.
            if self.action != "create" or not user.business.permission_on("staffCreateProducts") or not user.may_add_stock:
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

    @action(detail=False)
    def summary(self, request):
        """Units, value (at cost) and low or empty products across the user's locations, and per location."""
        rows = self.get_queryset()
        value = ExpressionWrapper(F("quantity") * F("product__cost"), output_field=DecimalField(max_digits=18, decimal_places=2))
        totals = rows.aggregate(units=Sum("quantity"), value=Sum(value))
        per_location = (
            rows.values("location_id")
            .annotate(
                units=Sum("quantity"),
                value=Sum(value),
                products=Count("id", filter=Q(quantity__gt=0)),
                low=Count("id", filter=Q(quantity__lte=F("product__low_stock_threshold"))),
            )
            .order_by()
        )
        products = product_totals(request.user)
        return Response({
            "products": products.count(),
            "units": totals["units"] or 0,
            "value": float(totals["value"] or 0),
            "low": products.filter(scoped_total__gt=0, scoped_total__lte=F("low_stock_threshold")).count(),
            "out": products.filter(scoped_total=0).count(),
            "locations": [
                {
                    "location_id": str(r["location_id"]),
                    "units": r["units"] or 0,
                    "value": float(r["value"] or 0),
                    "products": r["products"],
                    "low": r["low"],
                }
                for r in per_location
            ],
        })

    @action(detail=False, methods=["post"])
    def adjust(self, request):
        if not request.user.may_add_stock:
            raise PermissionDenied("You aren't allowed to change stock. Ask your manager.")
        serializer = StockAdjustSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self.check_location(data["location"])
        services.adjust_stock(request.user, data["product"], data["location"], data["delta"], data.get("reason", ""))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientViewSet(TenantViewSet, viewsets.ModelViewSet):
    """Staff can see and add clients (to rent to them at the counter); only owners
    and managers edit or delete."""

    model = Client
    serializer_class = ClientSerializer
    allowed_roles = TEAM
    search_fields = ("name", "company", "phone", "email")

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.user.role == User.Role.STAFF and self.action not in ("list", "retrieve", "create"):
            raise PermissionDenied()

    def filter_queryset(self, qs):
        qs = self.search(qs)
        if self.request.query_params.get("stats") == "1":
            qs = self.with_stats(qs)
        return qs

    def with_stats(self, qs):
        """Open rentals and orders, and what each client has paid, at the user's locations."""
        allowed = allowed_location_ids(self.request.user)

        def scoped(rows, field):
            return rows if allowed is None else rows.filter(**{f"{field}__in": allowed})

        def count(rows):
            return Coalesce(Subquery(rows.values("client").annotate(n=Count("id")).values("n"), output_field=IntegerField()), 0)

        rentals = scoped(Rental.objects.filter(client=OuterRef("pk"), status=Rental.Status.ACTIVE), "location_id")
        orders = scoped(Shipment.objects.filter(client=OuterRef("pk"), status__in=Shipment.OPEN), "from_location_id")
        revenue, _ = SaleViewSet.money_expressions()
        paid = scoped(
            Sale.objects.filter(client=OuterRef("pk"), refunded_at__isnull=True),
            "location_id",
        )
        money = DecimalField(max_digits=16, decimal_places=2)
        return qs.annotate(
            active_rentals=count(rentals),
            overdue_rentals=count(rentals.filter(Rental.overdue_q())),
            open_orders=count(orders),
            lifetime_value=Coalesce(
                Subquery(paid.values("client").annotate(v=Sum(revenue)).values("v"), output_field=money), Value(0, output_field=money)
            ),
        )

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


class PurchasesFeature:
    """Owners and admins; managers only when the owner switches "managerPurchases" on.
    Reading too, since purchases show what the business paid."""

    def check_permissions(self, request):
        super().check_permissions(request)
        user = request.user
        if user.role == User.Role.MANAGER and not user.business.permission_on("managerPurchases"):
            raise PermissionDenied("The owner hasn't turned on purchases for managers.")


class SupplierViewSet(PurchasesFeature, TenantViewSet, viewsets.ModelViewSet):
    """Who the business buys from. ?search=, and ?stats=1 for purchases and spend at the user's locations."""

    model = Supplier
    serializer_class = SupplierSerializer
    search_fields = ("name", "company", "phone", "email")

    def filter_queryset(self, qs):
        qs = self.search(qs)
        if self.request.query_params.get("stats") == "1":
            qs = self.with_stats(qs)
        return qs

    def with_stats(self, qs):
        purchases = Purchase.objects.filter(supplier=OuterRef("pk"))
        items = PurchaseItem.objects.filter(purchase__supplier=OuterRef("pk"))
        open_returns = SupplierReturn.objects.filter(supplier=OuterRef("pk"), status=SupplierReturn.Status.OPEN)
        allowed = allowed_location_ids(self.request.user)
        if allowed is not None:
            purchases = purchases.filter(location_id__in=allowed)
            items = items.filter(purchase__location_id__in=allowed)
            open_returns = open_returns.filter(location_id__in=allowed)
        money = DecimalField(max_digits=16, decimal_places=2)
        amount = ExpressionWrapper(F("unit_cost") * F("quantity"), output_field=money)
        owed = SupplierReturnViewSet.owed_expression()
        return qs.annotate(
            purchase_count=Coalesce(
                Subquery(purchases.values("supplier").annotate(n=Count("id")).values("n"), output_field=IntegerField()), 0
            ),
            spent=Coalesce(
                Subquery(items.values("purchase__supplier").annotate(v=Sum(amount)).values("v"), output_field=money),
                Value(0, output_field=money),
            ),
            last_purchase_at=Subquery(purchases.order_by("-purchased_at").values("purchased_at")[:1]),
            owed_back=Coalesce(
                Subquery(open_returns.values("supplier").annotate(v=Sum(owed)).values("v"), output_field=money),
                Value(0, output_field=money),
            ),
            owed=Coalesce(
                Subquery(
                    purchases.filter(paid_amount__lt=F("total")).values("supplier").annotate(v=Sum(F("total") - F("paid_amount"))).values("v"),
                    output_field=money,
                ),
                Value(0, output_field=money),
            ),
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "show_owed": self.request.user.role == User.Role.OWNER}

    @action(detail=True)
    def statement(self, request, pk=None):
        """Owners and admins: every bill and payment with this supplier, oldest first, with
        what's owed after each. Plus the total owed now and how much of it is overdue."""
        if request.user.role != User.Role.OWNER:
            raise PermissionDenied()
        supplier = self.get_object()
        purchases = Purchase.objects.filter(supplier=supplier)
        payments = SupplierPayment.objects.filter(supplier=supplier).select_related("supplier_return")
        rows = [
            {"kind": "purchase", "id": str(p.id), "code": p.code, "at": p.purchased_at, "reference": p.reference, "amount": p.total,
             "due_date": p.due_date, "status": p.payment_status}
            for p in purchases
        ] + [
            {"kind": "payment", "id": str(p.id), "code": p.code, "at": p.paid_at, "method": p.method, "note": p.note, "amount": p.amount,
             "return_code": p.supplier_return.code if p.supplier_return else None}
            for p in payments
        ]
        # Same moment: the bill before what was paid on it.
        rows.sort(key=lambda r: (r["at"], r["kind"] == "payment"))
        balance = Decimal(0)
        for row in rows:
            balance += row["amount"] if row["kind"] == "purchase" else -row["amount"]
            row["balance"] = float(balance)
            row["amount"] = float(row["amount"])
        due = purchases.filter(paid_amount__lt=F("total"))
        overdue = due.filter(due_date__lt=timezone.localdate()).aggregate(v=Sum(F("total") - F("paid_amount")))["v"] or 0
        return Response({
            "owed": float(due.aggregate(v=Sum(F("total") - F("paid_amount")))["v"] or 0),
            "overdue": float(overdue),
            "entries": rows[::-1],
        })

    def perform_create(self, serializer):
        supplier = serializer.save(business=self.request.user.business)
        services.log(self.request.user, "Supplier added", supplier.name)

    def perform_update(self, serializer):
        supplier = serializer.save()
        services.log(self.request.user, "Supplier updated", supplier.name)

    def perform_destroy(self, supplier):
        services.check_supplier_deletable(supplier)
        services.log(self.request.user, "Supplier deleted", supplier.name)
        supplier.delete()


class PurchaseViewSet(PurchasesFeature, TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    """Stock bought in, newest first. Managers see their own locations only.
    List filters: ?search= (P-000012, the supplier's bill number or the supplier), ?supplier=,
    ?location=, ?product=, ?from=&to= (ISO times)."""

    model = Purchase
    serializer_class = PurchaseSerializer

    def get_queryset(self):
        items = PurchaseItem.objects.annotate(returned=Coalesce(Sum("returns__quantity"), 0))
        qs = super().get_queryset().select_related("supplier", "created_by").prefetch_related(Prefetch("items", queryset=items))
        return self.scope_to_locations(qs, "location_id")

    def filter_queryset(self, qs):
        params = self.request.query_params
        qs = self.filter_by_ids(qs, supplier="supplier_id", location="location_id")
        product = self.id_param("product")
        if product is not None:
            qs = qs.filter(Exists(PurchaseItem.objects.filter(purchase=OuterRef("pk"), product_id=product)))
        for name, lookup in (("from", "purchased_at__gte"), ("to", "purchased_at__lt")):
            if params.get(name):
                when = parse_datetime(params[name])
                if when is None:
                    raise ValidationError({name: "Use an ISO date and time."})
                qs = qs.filter(**{lookup: when})
        payment = params.get("payment")
        if payment == "unpaid":
            qs = qs.filter(paid_amount__lt=F("total"))
        elif payment == "overdue":
            qs = qs.filter(paid_amount__lt=F("total"), due_date__lt=timezone.localdate())
        elif payment == "paid":
            qs = qs.filter(paid_amount__gte=F("total"))
        elif payment:
            raise ValidationError({"payment": "Use paid, unpaid or overdue."})
        term = params.get("search", "").strip()
        if term:
            # A purchase number as printed ("P-000012") or just the number ("12").
            number = re.sub(r"^p\s*-?\s*", "", term, flags=re.IGNORECASE)
            query = Q(reference__icontains=term) | Q(supplier__name__icontains=term) | Q(supplier__company__icontains=term)
            if number.isdigit():
                query |= Q(number=int(number))
            qs = qs.filter(query)
        return qs

    @action(detail=False)
    def summary(self, request):
        """How many purchases match the filters, what they cost in total, and how much of that is still owed."""
        qs = self.filter_queryset(self.get_queryset())
        totals = qs.aggregate(total=Sum("total"), paid=Sum("paid_amount"))
        total, paid = totals["total"] or 0, totals["paid"] or 0
        return Response({"count": qs.count(), "total": float(total), "due": float(total - paid)})

    def create(self, request):
        body = PurchaseCreateSerializer(data=request.data, context={"request": request})
        body.is_valid(raise_exception=True)
        self.check_location(body.validated_data["location"])
        user = request.user
        if any(i.get("new_product") for i in body.validated_data["items"]):
            if user.role == User.Role.MANAGER and not user.business.permission_on("managerProducts"):
                raise PermissionDenied("You can't add new products. Ask the owner to add them first.")
        purchase = services.record_purchase(user, **body.validated_data)
        purchase = self.get_queryset().get(pk=purchase.pk)
        return Response(self.get_serializer(purchase).data, status=status.HTTP_201_CREATED)


class SupplierPaymentViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin):
    """Money paid to suppliers, newest first. Owners and admins only.
    List filters: ?supplier=. A payment is given to the supplier's oldest unpaid bills."""

    model = SupplierPayment
    serializer_class = SupplierPaymentSerializer
    allowed_roles = (User.Role.OWNER,)

    def get_queryset(self):
        return super().get_queryset().select_related("supplier", "supplier_return", "created_by").prefetch_related("allocations__purchase")

    def filter_queryset(self, qs):
        return self.filter_by_ids(qs, supplier="supplier_id")

    @action(detail=False)
    def summary(self, request):
        """What the business owes all its suppliers, how much is overdue, and to how many."""
        due = Purchase.objects.filter(business=request.user.business, paid_amount__lt=F("total"))
        left = F("total") - F("paid_amount")
        overdue = due.filter(due_date__lt=timezone.localdate()).aggregate(v=Sum(left))["v"] or 0
        return Response({
            "owed": float(due.aggregate(v=Sum(left))["v"] or 0),
            "overdue": float(overdue),
            "supplier_count": due.values("supplier").distinct().count(),
        })

    def create(self, request):
        body = SupplierPaymentCreateSerializer(data=request.data, context={"request": request})
        body.is_valid(raise_exception=True)
        payment = services.pay_supplier(request.user, **body.validated_data)
        return Response(self.get_serializer(self.get_queryset().get(pk=payment.pk)).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, payment):
        services.delete_payment(self.request.user, payment)


class SupplierReturnViewSet(PurchasesFeature, TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    """Stock sent back to suppliers, newest first. Managers see their own locations only.
    List filters: ?status=open|settled|closed, ?supplier=, ?purchase=, ?search= (SR-000003, product, supplier)."""

    model = SupplierReturn
    serializer_class = SupplierReturnSerializer

    @staticmethod
    def owed_expression():
        """What the supplier still owes on a return, in the database."""
        money = DecimalField(max_digits=16, decimal_places=2)
        return ExpressionWrapper(
            F("unit_cost") * (F("quantity") - F("replaced_quantity")) - F("refunded_amount") - F("credited_amount"), output_field=money
        )

    def get_queryset(self):
        qs = super().get_queryset().select_related("supplier", "purchase", "created_by")
        return self.scope_to_locations(qs, "location_id")

    def filter_queryset(self, qs):
        params = self.request.query_params
        qs = self.filter_by_ids(qs, supplier="supplier_id", purchase="purchase_id", location="location_id")
        if params.get("status"):
            if params["status"] not in SupplierReturn.Status.values:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=params["status"])
        term = params.get("search", "").strip()
        if term:
            number = re.sub(r"^sr\s*-?\s*", "", term, flags=re.IGNORECASE)
            query = Q(product_name__icontains=term) | Q(supplier__name__icontains=term) | Q(reason__icontains=term)
            if number.isdigit():
                query |= Q(number=int(number))
            qs = qs.filter(query)
        return qs

    @action(detail=False)
    def summary(self, request):
        """Returns still waiting on the supplier, and what they're owed back in total."""
        waiting = self.get_queryset().filter(status=SupplierReturn.Status.OPEN)
        owed = waiting.aggregate(v=Sum(self.owed_expression()))["v"] or 0
        return Response({"open_count": waiting.count(), "owed": float(owed)})

    def create(self, request):
        body = SupplierReturnCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        item = PurchaseItem.objects.filter(pk=data["item_id"], purchase__business=request.user.business).select_related("purchase__location").first()
        if not item:
            raise ValidationError({"item_id": "Unknown purchase item."})
        if item.purchase.location:
            self.check_location(item.purchase.location)
        ret = services.return_to_supplier(request.user, item, data["quantity"], data["reason"])
        return Response(self.get_serializer(ret).data, status=status.HTTP_201_CREATED)

    def settle(self, body_class, do):
        body = body_class(data=self.request.data)
        body.is_valid(raise_exception=True)
        return Response(self.get_serializer(do(self.request.user, self.get_object(), **body.validated_data)).data)

    @action(detail=True, methods=["post"])
    def replacement(self, request, pk=None):
        """The supplier sent new units instead: they go back into stock."""
        return self.settle(ReplacementSerializer, services.receive_replacement)

    @action(detail=True, methods=["post"])
    def refund(self, request, pk=None):
        """The supplier gave money back."""
        return self.settle(RefundSerializer, services.receive_refund)

    @action(detail=True, methods=["post"])
    def credit(self, request, pk=None):
        """Taken off what the business owes the supplier. Owners and admins, who handle payments."""
        if request.user.role != User.Role.OWNER:
            raise PermissionDenied("Only the owner or an admin can take a return off what's owed.")
        return self.settle(CreditSerializer, services.credit_return)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """The supplier won't settle the rest. Owners and admins only, since it writes off money."""
        if request.user.role != User.Role.OWNER:
            raise PermissionDenied("Only the owner or an admin can close a return unsettled.")
        return self.settle(CloseReturnSerializer, services.close_return)


class ShipmentViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    """Orders. List filters: ?search=, ?status=<status> or open, ?product=, ?client=, ?location=."""

    model = Shipment
    serializer_class = ShipmentSerializer
    module = "tracking"
    search_fields = ("code", "product__name", "client__name", "client__company")

    def get_queryset(self):
        qs = super().get_queryset().select_related("product", "client").prefetch_related("history__by")
        return self.scope_to_locations(qs, "from_location_id")

    def filter_queryset(self, qs):
        qs = self.filter_by_ids(self.search(qs), product="product_id", client="client_id", location="from_location_id")
        status_ = self.request.query_params.get("status")
        if status_ == "open":
            qs = qs.filter(status__in=Shipment.OPEN)
        elif status_:
            if status_ not in Shipment.Status.values:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=status_)
        return qs

    @action(detail=False)
    def counts(self, request):
        """How many orders are in each status, for the filter chips. Takes ?location=.
        A list, since the camelCase renderer would rename keys like "in_delivery"."""
        qs = self.filter_by_ids(super().get_queryset(), location="from_location_id")
        qs = self.scope_to_locations(qs, "from_location_id")
        counts = dict(qs.values_list("status").annotate(n=Count("id")).order_by())
        return Response([{"status": s, "count": counts.get(s, 0)} for s in Shipment.Status.values])

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["from_location"])
        serializer.instance = services.create_shipment(self.request.user, **data)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        serializer = ShipmentStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["status"] == Shipment.Status.DELIVERED and data["payment_method"] not in services.enabled_methods(request.user.business):
            raise ValidationError("This payment method isn't turned on for your business.")
        shipment = services.set_shipment_status(request.user, self.get_object(), **data)
        return Response(ShipmentSerializer(shipment, context={"request": request}).data)


class RentalViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    """Staff can see rentals and scan them out and in at their own shops, if they may rent."""

    model = Rental
    serializer_class = RentalSerializer
    module = "rentals"
    allowed_roles = TEAM
    search_fields = ("code", "product__name", "client__name")

    def get_queryset(self):
        qs = super().get_queryset().select_related("product", "client")
        return self.scope_to_locations(qs, "location_id")

    def filter_queryset(self, qs):
        """?search=, ?status=active|returned, ?overdue=1, ?product=, ?client=, ?location=, and
        ?code= for scanning in: a rental code, or the barcode or SKU of the item."""
        params = self.request.query_params
        qs = self.filter_by_ids(self.search(qs), product="product_id", client="client_id", location="location_id")
        if params.get("status"):
            if params["status"] not in Rental.Status.values:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=params["status"])
        if params.get("overdue") == "1":
            qs = qs.filter(Rental.overdue_q())
        code = params.get("code", "").strip()
        if code:
            qs = qs.filter(Q(code__iexact=code) | Q(product__barcode=code) | Q(product__sku__iexact=code))
        return qs

    @action(detail=False)
    def summary(self, request):
        """Counts and money for the rentals page. Takes ?product= and ?location=."""
        qs = self.filter_by_ids(self.get_queryset(), product="product_id", location="location_id")
        active = qs.filter(status=Rental.Status.ACTIVE)
        now = timezone.now()
        # What the rentals out now have run up so far, at today's count of days.
        running = sum(
            Rental.quote(r.plan, r.rate, Rental.count_days(r.start_date, now), r.quantity)
            for r in active.select_related(None).only("plan", "rate", "start_date", "quantity")
        )
        return Response({
            "active": active.count(),
            "active_units": active.aggregate(n=Sum("quantity"))["n"] or 0,
            "overdue": active.filter(Rental.overdue_q()).count(),
            "running": float(running),
            "earned": float(qs.filter(status=Rental.Status.RETURNED).aggregate(t=Sum("total"))["t"] or 0),
        })

    def check_permissions(self, request):
        super().check_permissions(request)
        if not request.user.may_rent:
            raise PermissionDenied("You aren't allowed to rent items out. Ask your manager.")

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["location"])
        serializer.instance = services.create_rental(self.request.user, **data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_(self, request, pk=None):
        body = RentalReturnSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        rental = self.get_object()
        self.check_location(rental.location)
        if body.validated_data["payment_method"] not in services.enabled_methods(request.user.business):
            raise ValidationError("This payment method isn't turned on for your business.")
        rental = services.return_rental(request.user, rental, **body.validated_data)
        return Response(RentalSerializer(rental, context={"request": request}).data)


class TransferViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    model = Transfer
    serializer_class = TransferSerializer
    module = "transfers"
    search_fields = ("code", "product__name")

    def get_queryset(self):
        qs = super().get_queryset().select_related("created_by", "product")
        return self.scope_to_locations(qs, "from_location_id", "to_location_id")

    def filter_queryset(self, qs):
        """?search=, ?status=, ?product=, ?to=<location>, and ?location= for either end."""
        qs = self.filter_by_ids(self.search(qs), product="product_id", to="to_location_id")
        location = self.id_param("location")
        if location is not None:
            qs = qs.filter(Q(from_location_id=location) | Q(to_location_id=location))
        status_ = self.request.query_params.get("status")
        if status_:
            if status_ not in Transfer.Status.values:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=status_)
        return qs

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
    """The activity log, newest first. Owners, and managers the owner allows, see
    everyone's; anyone can see their own with ?mine=1.

    List filters: ?search=, ?user=<id>, ?mine=1 and ?action= (repeat it for several).
    """

    model = Activity
    serializer_class = ActivitySerializer
    allowed_roles = TEAM
    search_fields = ("action", "detail")
    # Without ?page=, the most recent entries.
    LIST_LIMIT = 500

    def get_queryset(self):
        return super().get_queryset().select_related("user")

    def mine_only(self):
        return self.request.query_params.get("mine") == "1"

    def filter_queryset(self, qs):
        qs = self.filter_by_ids(self.search(qs), user="user_id")
        if self.mine_only():
            qs = qs.filter(user=self.request.user)
        actions = self.request.query_params.getlist("action")
        if actions:
            qs = qs.filter(action__in=actions)
        return qs

    def list(self, request):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(qs[: self.LIST_LIMIT], many=True).data)

    @action(detail=False)
    def people(self, request):
        """Everyone who appears in the log, for the person filter."""
        rows = self.get_queryset().filter(user__isnull=False).values_list("user_id", "user__name").distinct().order_by("user__name")
        return Response([{"id": str(uid), "name": name} for uid, name in rows])

    def check_permissions(self, request):
        super().check_permissions(request)
        user = request.user
        if self.action == "list" and self.mine_only():
            return
        if user.role == User.Role.STAFF:
            raise PermissionDenied()
        if user.role == User.Role.MANAGER and not user.business.permission_on("managerActivity"):
            raise PermissionDenied()


class OverviewView(APIView):
    """The dashboard in one call: stock totals, what's running low, open orders,
    overdue rentals, waiting stock and refund requests and recent activity, all limited to
    the user's locations and the features they can use.

    ?only=badges returns just the counts the sidebar shows.
    """

    permission_classes = [IsTenantMember]
    allowed_roles = TEAM
    LIST_LENGTH = 6

    def get(self, request):
        user = request.user
        business = user.business
        allowed = allowed_location_ids(user)
        lead = user.role != User.Role.STAFF

        def scoped(qs, field):
            return qs if allowed is None else qs.filter(**{f"{field}__in": allowed})

        rentals_on = user.may_rent and business.module_on("rentals")
        tracking_on = lead and business.module_on("tracking")
        transfers_on = lead and business.module_on("transfers")
        rentals = scoped(Rental.objects.filter(business=business), "location_id")
        overdue = rentals.filter(Rental.overdue_q())
        shipments = scoped(Shipment.objects.filter(business=business), "from_location_id")

        data = {
            "overdue_rentals": overdue.count() if rentals_on else 0,
            "open_orders": shipments.filter(status__in=Shipment.OPEN).count() if tracking_on else 0,
            "waiting_requests": self.waiting_requests(user) if transfers_on else 0,
            # Sales staff asked to take back; only an owner can accept them.
            "return_requests": Sale.objects.filter(
                business=business, return_request=Sale.ReturnRequest.REQUESTED, refunded_at__isnull=True
            ).count() if user.role == User.Role.OWNER else 0,
        }
        if request.query_params.get("only") == "badges":
            return Response(data)

        stock = scoped(StockLevel.objects.filter(business=business), "location_id")
        value = ExpressionWrapper(F("quantity") * F("product__cost"), output_field=DecimalField(max_digits=18, decimal_places=2))
        totals = stock.aggregate(units=Sum("quantity"), value=Sum(value))
        per_location = dict(stock.values_list("location_id").annotate(units=Sum("quantity")).order_by())
        data.update(
            products=Product.objects.filter(business=business).count(),
            units=totals["units"] or 0,
            value=float(totals["value"] or 0),
            units_by_location={str(k): v for k, v in per_location.items()},
            **self.low_stock(user, stock),
        )
        if rentals_on:
            data["active_rentals"] = rentals.filter(status=Rental.Status.ACTIVE).count()
            data["overdue_list"] = RentalSerializer(
                overdue.select_related("product", "client").order_by("due_at")[: self.LIST_LENGTH], many=True,
                context={"request": request},
            ).data
        if tracking_on:
            counts = dict(shipments.filter(status__in=Shipment.OPEN).values_list("status").annotate(n=Count("id")).order_by())
            # A list, since the camelCase renderer would rename keys like "in_delivery".
            data["orders_by_status"] = [{"status": s, "count": counts.get(s, 0)} for s in Shipment.OPEN]
        if user.role == User.Role.OWNER or (user.role == User.Role.MANAGER and business.permission_on("managerActivity")):
            recent = Activity.objects.filter(business=business).select_related("user")[: self.LIST_LENGTH]
            data["recent_activity"] = ActivitySerializer(recent, many=True).data
        return Response(data)

    def low_stock(self, user, stock):
        """Products with none left anywhere the user works, then products running low where they're kept.
        A shop that never carries an item isn't "out" of it."""
        out = product_totals(user).filter(scoped_total=0)
        running_low = stock.filter(quantity__gt=0, quantity__lte=F("product__low_stock_threshold"))
        rows = [
            {"product_id": str(p.id), "product_name": p.name, "location_id": None, "quantity": 0}
            for p in out.order_by("name")[: self.LIST_LENGTH]
        ]
        if len(rows) < self.LIST_LENGTH:
            rows += [
                {"product_id": str(r.product_id), "product_name": r.product.name, "location_id": str(r.location_id), "quantity": r.quantity}
                for r in running_low.select_related("product").order_by("quantity", "product__name")[: self.LIST_LENGTH - len(rows)]
            ]
        return {"low_stock_count": out.count() + running_low.count(), "low_stock": rows}

    @staticmethod
    def waiting_requests(user):
        """Requests waiting for someone other than the person who asked (owners see all of them)."""
        waiting = StockRequest.objects.filter(business=user.business, status=StockRequest.Status.PENDING)
        if user.role != User.Role.OWNER:
            waiting = waiting.exclude(requested_by=user)
        return waiting.count()


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


class PublicReceiptView(APIView):
    """The buyer's receipt link. No login: the long random token is the key.
    Kept while the business is open, like order tracking links."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        sale = (
            Sale.objects.select_related("business", "location", "client", "shipment", "rental")
            .filter(receipt_token=token, receipt_no__isnull=False)
            .order_by("id")
            .first()
        )
        if not sale or not sale.business.is_open:
            raise NotFound("This receipt isn't available.")
        return Response(ReceiptSerializer(sale).data)


class SaleViewSet(TenantViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin):
    """Sales. Anyone on the team can record a walk-in sale at their own shops;
    owners and managers can list them (managers only for their shops). Cost and
    profit are shown to owners only."""

    model = Sale
    serializer_class = SaleSerializer
    allowed_roles = TEAM

    def show_profit(self):
        """Owners always; managers when the owner switches "managerProfit" on."""
        user = self.request.user
        if user.role == User.Role.OWNER:
            return True
        return user.role == User.Role.MANAGER and user.business.permission_on("managerProfit")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "show_profit": self.show_profit()}

    LIST_LIMIT = 500

    def get_queryset(self):
        qs = super().get_queryset().select_related("sold_by", "client", "refunded_by", "return_requested_by")
        if self.request.user.role == User.Role.STAFF:
            qs = qs.filter(sold_by=self.request.user)
        return self.scope_to_locations(qs, "location_id")

    def mine_only(self):
        """Staff only ever see their own sales; anyone can ask for theirs with ?mine=1."""
        return self.request.user.role == User.Role.STAFF or self.request.query_params.get("mine") == "1"

    def filtered(self):
        """Sales matching ?from=&to= (ISO times), ?location=, ?product=, ?seller=, ?channel=, ?mine=1 and ?search=<receipt number>."""
        qs = self.get_queryset()
        if self.mine_only():
            qs = qs.filter(sold_by=self.request.user)
        params = self.request.query_params
        for name, lookup in (("from", "sold_at__gte"), ("to", "sold_at__lt")):
            if params.get(name):
                when = parse_datetime(params[name])
                if when is None:
                    raise ValidationError({name: "Use an ISO date and time."})
                qs = qs.filter(**{lookup: when})
        for name, field in (("location", "location_id"), ("product", "product_id"), ("seller", "sold_by_id")):
            if name == "seller" and self.mine_only():
                continue  # already limited to the user's own sales
            if params.get(name):
                if not params[name].isdigit():
                    raise ValidationError({name: "Unknown id."})
                qs = qs.filter(**{field: int(params[name])})
        if params.get("channel"):
            if params["channel"] not in Sale.Channel.values:
                raise ValidationError({"channel": "Unknown sale type."})
            qs = qs.filter(channel=params["channel"])
        if params.get("search", "").strip():
            # A receipt number, as printed ("R-000706") or just the number ("706").
            number = re.sub(r"^r\s*-?\s*", "", params["search"].strip(), flags=re.IGNORECASE)
            qs = qs.filter(receipt_no=int(number)) if number.isdigit() else qs.none()
        if params.get("returns") == "requested":
            qs = qs.filter(return_request=Sale.ReturnRequest.REQUESTED)
        if params.get("method"):
            method = "" if params["method"] == "none" else params["method"]
            if method and method not in Sale.Method.values:
                raise ValidationError({"method": "Unknown payment method."})
            qs = qs.filter(payment_method=method)
        return qs

    def list(self, request):
        """The newest sales matching the filters, by page with ?page=, otherwise up to 500.
        The summary has the full totals."""
        qs = self.filtered()
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(qs[: self.LIST_LIMIT], many=True).data)

    @action(detail=False)
    def summary(self, request):
        """Totals for the filtered sales. Refunded sales are counted separately and left out."""
        qs = self.filtered()
        revenue, cost = self.money_expressions()
        zero = Decimal("0")

        def totals(rows):
            agg = rows.aggregate(count=Count("id"), revenue=Sum(revenue), cost=Sum(cost), units=Sum("quantity"))
            r, c = agg["revenue"] or zero, agg["cost"] or zero
            return {"count": agg["count"], "revenue": r, "cost": c, "profit": r - c, "units": agg["units"] or 0}

        # Only money actually received: not refunded.
        counted = qs.filter(refunded_at__isnull=True)
        overall = totals(counted)
        channels = {ch: totals(counted.filter(channel=ch)) for ch in Sale.Channel.values}
        show_profit = self.show_profit()

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
            # By how it was paid; "none" = not recorded (orders, older sales).
            "methods": {
                (m or "none"): {"count": t["count"], "revenue": float(t["revenue"])}
                for m in [*Sale.Method.values, ""]
                for t in [totals(counted.filter(payment_method=m))]
            },
            "channels": {ch: public(t) for ch, t in channels.items()},
            # Everyone who has sold within this user's view, for the seller filter.
            "sellers": [] if self.mine_only() else [
                {"id": str(uid), "name": name}
                for uid, name in self.get_queryset().filter(sold_by__isnull=False)
                .values_list("sold_by_id", "sold_by__name").distinct().order_by("sold_by__name")
            ],
        }
        if show_profit:
            data["margin"] = round(float(overall["profit"] / overall["revenue"] * 100), 1) if overall["revenue"] else None
        data["series"] = self.series(counted, show_profit)
        data["top_products"] = self.top_products(counted, show_profit)
        return Response(data)

    @staticmethod
    def money_expressions():
        money = DecimalField(max_digits=16, decimal_places=2)
        revenue = ExpressionWrapper(F("unit_price") * F("quantity") - F("discount"), output_field=money)
        cost = ExpressionWrapper(F("unit_cost") * F("quantity"), output_field=money)
        return revenue, cost

    def series(self, counted, show_profit):
        """Revenue (and profit) per day, or per month when the range is longer than two months.
        Days or months with no sales are included as zero, so the chart has no gaps."""
        params = self.request.query_params
        now = timezone.localtime()
        start = parse_datetime(params["from"]) if params.get("from") else counted.aggregate(m=Min("sold_at"))["m"]
        end = parse_datetime(params["to"]) if params.get("to") else now
        if start is None:
            return {"bucket": "day", "points": []}
        start, end = timezone.localtime(start), timezone.localtime(min(end, now))
        bucket = "day" if (end - start).days <= 62 else "month"
        trunc = TruncDay if bucket == "day" else TruncMonth
        revenue, cost = self.money_expressions()
        rows = {
            timezone.localtime(r["period"]).date(): r
            for r in counted.annotate(period=trunc("sold_at")).values("period").annotate(revenue=Sum(revenue), cost=Sum(cost))
        }
        points, day = [], start.date() if bucket == "day" else start.date().replace(day=1)
        while day <= end.date():
            r = rows.get(day, {})
            point = {"date": day.isoformat(), "revenue": float(r.get("revenue") or 0)}
            if show_profit:
                point["profit"] = float((r.get("revenue") or 0) - (r.get("cost") or 0))
            points.append(point)
            day = day + timedelta(days=1) if bucket == "day" else (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        return {"bucket": bucket, "points": points}

    @staticmethod
    def top_products(counted, show_profit):
        """Products sold (not rentals), best revenue first."""
        revenue, cost = SaleViewSet.money_expressions()
        rows = (
            counted.exclude(channel=Sale.Channel.RENTAL)
            .values("product_id")
            .annotate(name=Max("product_name"), units=Sum("quantity"), revenue=Sum(revenue), cost=Sum(cost))
            .order_by("-revenue")[:100]
        )
        out = []
        for r in rows:
            item = {
                "product_id": str(r["product_id"]) if r["product_id"] else None,
                "name": r["name"] if r["product_id"] else "Deleted products",
                "units": r["units"],
                "revenue": float(r["revenue"]),
            }
            if show_profit:
                item["profit"] = float(r["revenue"] - r["cost"])
            out.append(item)
        return out

    @action(detail=False)
    def export(self, request):
        """Every sale matching the filters as a CSV file that opens in Excel."""
        if request.user.role == User.Role.STAFF:
            raise PermissionDenied()
        show_profit = self.show_profit()
        sales = self.filtered().select_related("location", "client", "sold_by")
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="sales-{timezone.localdate().isoformat()}.csv"'
        response.write("\ufeff")  # BOM, so Excel reads the file as UTF-8 (names, ৳)
        writer = csv.writer(response)

        def text(value):
            # Typed by users: stop Excel from running a name like "=HYPERLINK(...)" as a formula.
            value = value or ""
            return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value

        header = ["Date", "Type", "Product", "Quantity", "Unit price", "Discount", "Total"]
        if show_profit:
            header += ["Unit cost", "Cost", "Profit"]
        writer.writerow(header + ["Payment", "Shop", "Client", "Sold by", "Refunded"])
        for s in sales.iterator():
            row = [
                timezone.localtime(s.sold_at).strftime("%Y-%m-%d %H:%M"),
                s.get_channel_display(),
                text(s.product_name),
                s.quantity,
                s.unit_price,
                s.discount,
                s.revenue,
            ]
            if show_profit:
                row += [s.unit_cost, s.cost, s.profit]
            row += [s.get_payment_method_display() if s.payment_method else ""]
            row += [
                text(s.location.name if s.location else ""),
                text(s.client.name if s.client else "Walk-in"),
                text(s.sold_by.name if s.sold_by else ""),
                timezone.localtime(s.refunded_at).strftime("%Y-%m-%d %H:%M") if s.refunded_at else "",
            ]
            writer.writerow(row)
        return response

    def create(self, request):
        if not request.user.may_sell:
            raise PermissionDenied("You aren't allowed to sell. Ask your manager.")
        serializer = SellSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get("client") and request.user.role == User.Role.STAFF:
            # Staff can't see the client list, so they can't pick one either.
            data["client"] = None
        self.check_location(data["location"])
        sales = services.sell(request.user, **data)
        # The first item, with every item of the checkout for the till's screen.
        body = {**self.get_serializer(sales[0]).data, "sales": self.get_serializer(sales, many=True).data}
        return Response(body, status=status.HTTP_201_CREATED)

    @action(detail=True)
    def receipt(self, request, pk=None):
        """The printable receipt, for whoever can see the sale."""
        sale = self.get_object()
        if not sale.receipt_no:
            raise NotFound("This sale has no receipt.")
        return Response(ReceiptSerializer(sale, context={"internal": True}).data)

    def reason(self, key="reason"):
        value = self.request.data.get(key, "")
        if not isinstance(value, str) or len(value) > 200:
            raise ValidationError({key: "Keep it under 200 characters."})
        return value

    @action(detail=True, methods=["post"], url_path="return")
    def return_sale(self, request, pk=None):
        """Owners and admins take a sale back (or approve a manager's request). Managers ask instead."""
        if request.user.role != User.Role.OWNER:
            raise PermissionDenied("Only the owner or an admin can return a sale. Send them a return request.")
        return Response(self.get_serializer(services.return_sale(request.user, self.get_object(), self.reason())).data)

    @action(detail=True, methods=["post"], url_path="request-return")
    def request_return(self, request, pk=None):
        if request.user.role != User.Role.MANAGER:
            raise PermissionDenied("Managers ask for returns; owners and admins return the sale directly.")
        return Response(self.get_serializer(services.request_return(request.user, self.get_object(), self.reason())).data)

    @action(detail=True, methods=["post"], url_path="decline-return")
    def decline_return(self, request, pk=None):
        if request.user.role != User.Role.OWNER:
            raise PermissionDenied("Only the owner or an admin can decline a return.")
        return Response(self.get_serializer(services.decline_return(request.user, self.get_object(), self.reason("note"))).data)


class StockRequestViewSet(TenantViewSet, mixins.ListModelMixin, mixins.CreateModelMixin):
    """Shops ask for stock; the owner, or a manager of the location it ships from, approves.

    Managers see requests for their own shops plus every waiting request they could
    fill from a location they run. Part of the transfers feature.
    """

    model = StockRequest
    serializer_class = StockRequestSerializer
    module = "transfers"

    def get_queryset(self):
        qs = super().get_queryset().select_related("requested_by", "decided_by", "transfer", "product")
        allowed = allowed_location_ids(self.request.user)
        if allowed is None:
            return qs
        return qs.filter(Q(to_location_id__in=allowed) | Q(status=StockRequest.Status.PENDING) | Q(transfer__from_location_id__in=allowed))

    search_fields = ("code", "product__name", "note")

    def filter_queryset(self, qs):
        """?search=, ?location=<the shop it's for>, and ?status=pending|approved|declined|cancelled,
        or ?status=handled for everything but waiting. Waiting requests come first."""
        qs = self.filter_by_ids(self.search(qs), location="to_location_id")
        status_ = self.request.query_params.get("status")
        if status_ == "handled":
            qs = qs.exclude(status=StockRequest.Status.PENDING)
        elif status_:
            if status_ not in StockRequest.Status.values:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=status_)
        waiting_first = Case(When(status=StockRequest.Status.PENDING, then=Value(0)), default=Value(1))
        return qs.order_by(waiting_first, "-created_at")

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.check_location(data["to_location"])
        serializer.instance = services.request_stock(self.request.user, **data)

    def respond(self, req):
        return Response(StockRequestSerializer(req, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        body = ApproveRequestSerializer(data=request.data, context={"request": request})
        body.is_valid(raise_exception=True)
        # Whoever sends it must run the location it leaves from.
        self.check_location(body.validated_data["from_location"])
        return self.respond(services.approve_request(request.user, self.get_object(), **body.validated_data))

    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        req = self.get_object()
        if request.user.role != User.Role.OWNER and req.requested_by_id == request.user.id:
            raise PermissionDenied("Someone else has to decline your own request. You can cancel it.")
        body = DeclineRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self.respond(services.decline_request(request.user, req, **body.validated_data))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        req = self.get_object()
        if request.user.role != User.Role.OWNER and req.requested_by_id != request.user.id:
            raise PermissionDenied("Only the person who asked can cancel it.")
        return self.respond(services.cancel_request(request.user, req))
