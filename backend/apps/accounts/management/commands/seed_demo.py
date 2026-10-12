"""Loads the same demo businesses, logins and inventory the frontend used
before the backend existed (frontend/src/lib/store/seed.ts and friends).

    python manage.py seed_demo          # skip if the demo data is already there
    python manage.py seed_demo --reset  # wipe the demo businesses and load them again
"""

from datetime import timedelta

from dateutil.relativedelta import relativedelta
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Business, User, default_settings
from apps.billing.models import Payment
from apps.inventory.models import Activity, Client, Location, Product, Rental, Shipment, ShipmentEvent, StockLevel, Transfer

DEMO_EMAILS = ["super@friday.app", "owner@friday.app", "manager@friday.app", "staff@friday.app", "cafe@friday.app", "urban@friday.app"]

LOCATIONS = [
    ("main", "Main Warehouse", "warehouse", "12 Industrial Rd, Block C", "+1 555 0100"),
    ("downtown", "Downtown Outlet", "outlet", "88 Market Street", "+1 555 0111"),
    ("uptown", "Uptown Outlet", "outlet", "401 Park Avenue", "+1 555 0122"),
    ("airport", "Airport Kiosk", "outlet", "Terminal 2, Gate B", "+1 555 0133"),
]

# key, name, category, sku, barcode, price, cost, extra
PRODUCTS = [
    ("prd-1", "Wireless Barcode Scanner", "Electronics", "ELC-1001", "8901234567011", 89, 52, {}),
    ("prd-2", '27" 4K Monitor', "Electronics", "ELC-1002", "8901234567028", 349, 240, {"low_stock_threshold": 3}),
    ("prd-3", "Mechanical Keyboard", "Electronics", "ELC-1003", "8901234567035", 79, 41, {}),
    ("prd-4", "Cordless Drill 20V", "Tools", "TLS-2001", "8901234567042", 129, 78, {"rentable": True, "rent_daily": 12, "rent_weekly": 60, "rent_monthly": 180}),
    ("prd-5", "Pressure Washer", "Tools", "TLS-2002", "8901234567059", 299, 190, {"rentable": True, "rent_daily": 25, "rent_weekly": 120, "rent_monthly": 380, "low_stock_threshold": 2}),
    ("prd-6", "Steel Ladder 3m", "Tools", "TLS-2003", "8901234567066", 149, 90, {"rentable": True, "rent_daily": 8, "rent_weekly": 40}),
    ("prd-7", "Office Chair Ergo", "Furniture", "FRN-3001", "8901234567073", 219, 130, {}),
    ("prd-8", "Folding Table 6ft", "Furniture", "FRN-3002", "8901234567080", 89, 48, {"rentable": True, "rent_daily": 6, "rent_weekly": 30, "low_stock_threshold": 10}),
    ("prd-9", "Event Tent 3×6m", "Event Equipment", "EVT-4001", "8901234567097", 599, 380, {"rentable": True, "rent_daily": 45, "rent_weekly": 220, "rent_monthly": 700, "low_stock_threshold": 2}),
    ("prd-10", "PA Speaker System", "Event Equipment", "EVT-4002", "8901234567103", 899, 610, {"rentable": True, "rent_daily": 60, "rent_weekly": 300, "low_stock_threshold": 2}),
    ("prd-11", "Projector 1080p", "Electronics", "ELC-1004", "8901234567110", 459, 300, {"rentable": True, "rent_daily": 30, "rent_weekly": 150, "rent_monthly": 450, "low_stock_threshold": 3}),
    ("prd-12", "A4 Copy Paper (Box)", "Office Supplies", "OFS-5001", "8901234567127", 32, 21, {"unit": "box", "low_stock_threshold": 20}),
    ("prd-13", "Thermal Label Roll", "Office Supplies", "OFS-5002", "8901234567134", 9, 4, {"unit": "roll", "low_stock_threshold": 30}),
    ("prd-14", "Safety Helmet", "Safety", "SFT-6001", "8901234567141", 24, 11, {"low_stock_threshold": 15}),
]

# Quantities at main, downtown, uptown, airport.
STOCK = {
    "prd-1": [40, 6, 4, 2], "prd-2": [12, 2, 1, 0], "prd-3": [55, 9, 7, 5], "prd-4": [18, 4, 3, 0],
    "prd-5": [6, 1, 0, 0], "prd-6": [10, 2, 2, 0], "prd-7": [24, 3, 5, 0], "prd-8": [60, 8, 4, 0],
    "prd-9": [5, 1, 0, 0], "prd-10": [3, 1, 1, 0], "prd-11": [9, 2, 1, 1], "prd-12": [150, 18, 12, 6],
    "prd-13": [400, 25, 20, 8], "prd-14": [12, 3, 2, 0],
}

CLIENTS = [
    ("cl-1", "Rafi Ahmed", "BrightBuild Co.", "+1 555 0201", "rafi@brightbuild.co", "5 Lake View", 50),
    ("cl-2", "Sara Khan", "Bloom Events", "+1 555 0202", "sara@bloomevents.com", "77 Garden Lane", 45),
    ("cl-3", "Tanvir Chowdhury", "TechNest Ltd.", "+1 555 0203", "tanvir@technest.io", "9 Silicon Ave", 40),
    ("cl-4", "Mim Akter", "", "+1 555 0204", "mim.akter@mail.com", "21 River Road", 20),
    ("cl-5", "Jamal Uddin", "Uddin Interiors", "+1 555 0205", "jamal@uddininteriors.com", "3 Oak Street", 12),
]

# code, product, qty, client, from, status path, started days ago
SHIPMENTS = [
    ("SHP-7A21C4", "prd-2", 4, "cl-3", "main", ["pending", "processing", "in_delivery"], 2),
    ("SHP-19BD02", "prd-7", 10, "cl-5", "main", ["pending", "processing", "in_delivery", "delivered"], 6),
    ("SHP-C4E911", "prd-12", 25, "cl-1", "downtown", ["pending"], 0),
    ("SHP-5F0A3B", "prd-3", 8, "cl-3", "uptown", ["pending", "processing"], 1),
    ("SHP-88D3E0", "prd-1", 2, "cl-4", "downtown", ["pending", "processing", "in_delivery", "delivered", "returned"], 10),
]

# code, product, qty, client, location, plan, rate, days, started days ago, status
RENTALS = [
    ("RNT-3B7E10", "prd-9", 1, "cl-2", "main", "daily", 45, 3, 1, "active"),
    ("RNT-A0C6F2", "prd-10", 1, "cl-2", "downtown", "weekly", 300, 7, 9, "active"),
    ("RNT-61E9D8", "prd-4", 2, "cl-1", "uptown", "weekly", 60, 14, 5, "active"),
    ("RNT-F24B55", "prd-8", 12, "cl-2", "main", "fixed", 150, 2, 20, "returned"),
    ("RNT-0D93AA", "prd-11", 1, "cl-3", "main", "monthly", 450, 30, 4, "active"),
]


class Command(BaseCommand):
    help = "Load the demo businesses, logins and inventory."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete the demo data first.")

    @transaction.atomic
    def handle(self, *args, reset=False, **options):
        if reset:
            Business.objects.filter(users__email__in=DEMO_EMAILS).distinct().delete()
            User.objects.filter(email__in=DEMO_EMAILS).delete()
        elif User.objects.filter(email__in=DEMO_EMAILS).exists():
            self.stdout.write("Demo data is already loaded. Use --reset to load it again.")
            return

        self.now = timezone.now()
        ago = self.ago

        User.objects.create_superuser(email="super@friday.app", password="super123", name="Platform Admin")

        demo = Business.objects.create(
            name="Friday Demo Store", industry="Electronics & tools",
            trial_ends_at=ago(113), paid_until=ago(-18),
        )
        cafe_settings = default_settings()
        cafe_settings["modules"] = {"rentals": False, "tracking": True, "transfers": False}
        cafe = Business.objects.create(
            name="Green Leaf Café", industry="Food & beverage", trial_ends_at=ago(-2), settings=cafe_settings,
        )
        urban = Business.objects.create(
            name="Urban Party Rentals", industry="Event rentals", trial_ends_at=ago(38), paid_until=ago(8),
        )
        # created_at is auto_now_add, so set it afterwards.
        for business, days in ((demo, 120), (cafe, 5), (urban, 45)):
            Business.objects.filter(pk=business.pk).update(created_at=ago(days))

        locs = {
            key: Location.objects.create(business=demo, name=name, type=type_, address=address, phone=phone)
            for key, name, type_, address, phone in LOCATIONS
        }
        for business in (cafe, urban):
            Location.objects.create(business=business, name="Main Store", type="outlet", address="Add your address in Warehouses & Shops")

        user = lambda email, name, role, business, password, locations=(): self.user(email, name, role, business, password, locations)  # noqa: E731
        owner = user("owner@friday.app", "Ayesha Rahman", "owner", demo, "owner123")
        manager = user("manager@friday.app", "Karim Hasan", "manager", demo, "manager123", [locs["downtown"], locs["uptown"]])
        staff = user("staff@friday.app", "Nadia Islam", "staff", demo, "staff123", [locs["main"]])
        user("cafe@friday.app", "Sara Khan", "owner", cafe, "cafe1234")
        urban_owner = user("urban@friday.app", "Jamal Uddin", "owner", urban, "urban123")

        products = {}
        for key, name, category, sku, barcode, price, cost, extra in PRODUCTS:
            fields = {"unit": "pcs", "low_stock_threshold": 5, **extra}
            products[key] = Product.objects.create(
                business=demo, name=name, category=category, sku=sku, barcode=barcode,
                price=price, cost=cost, created_by=owner, **fields,
            )
        Product.objects.filter(business=demo).update(created_at=ago(60))

        order = ["main", "downtown", "uptown", "airport"]
        for key, quantities in STOCK.items():
            for loc_key, qty in zip(order, quantities):
                if qty:
                    StockLevel.objects.create(business=demo, product=products[key], location=locs[loc_key], quantity=qty)

        clients = {}
        for key, name, company, phone, email, address, days in CLIENTS:
            clients[key] = Client.objects.create(business=demo, name=name, company=company, phone=phone, email=email, address=address)
            Client.objects.filter(pk=clients[key].pk).update(created_at=ago(days))

        for code, product, qty, client, loc, path, days in SHIPMENTS:
            shipment = Shipment.objects.create(
                business=demo, code=code, product=products[product], quantity=qty, client=clients[client],
                from_location=locs[loc], status=path[-1],
            )
            Shipment.objects.filter(pk=shipment.pk).update(created_at=ago(days))
            for i, status in enumerate(path):
                event = ShipmentEvent.objects.create(shipment=shipment, status=status, by=manager)
                ShipmentEvent.objects.filter(pk=event.pk).update(at=ago(days) + timedelta(hours=20 * i))

        for code, product, qty, client, loc, plan, rate, days, started, status in RENTALS:
            rental = Rental.objects.create(
                business=demo, code=code, product=products[product], quantity=qty, client=clients[client],
                location=locs[loc], start_date=ago(started), days=days, plan=plan, rate=rate,
                deposit=round(rate * 2), total=Rental.quote(plan, rate, days, qty), status=status,
                returned_at=ago(started - days) if status == "returned" else None,
            )
            Rental.objects.filter(pk=rental.pk).update(created_at=ago(started))

        t1 = Transfer.objects.create(
            business=demo, code="TRF-2C81E7", product=products["prd-3"], quantity=10,
            from_location=locs["main"], to_location=locs["airport"], created_by=manager,
        )
        t2 = Transfer.objects.create(
            business=demo, code="TRF-B9F004", product=products["prd-12"], quantity=20,
            from_location=locs["main"], to_location=locs["downtown"], status="received",
            created_by=owner, received_at=ago(7),
        )
        Transfer.objects.filter(pk=t1.pk).update(created_at=ago(1))
        Transfer.objects.filter(pk=t2.pk).update(created_at=ago(8))

        for hours, who, action, detail in [
            (1, staff, "Stock added", "+20 Thermal Label Roll at Main Warehouse"),
            (5, manager, "Shipment created", "SHP-C4E911 · 25 × A4 Copy Paper (Box) to Rafi Ahmed"),
            (24, manager, "Transfer started", "TRF-2C81E7 · 10 × Mechanical Keyboard → Airport Kiosk"),
            (24, owner, "Rental created", "RNT-3B7E10 · Event Tent 3×6m to Sara Khan"),
            (96, owner, "Rental created", "RNT-0D93AA · Projector 1080p to Tanvir Chowdhury"),
        ]:
            entry = Activity.objects.create(business=demo, user=who, action=action, detail=detail)
            Activity.objects.filter(pk=entry.pk).update(at=self.now - timedelta(hours=hours))

        n = 0
        for business, payer, days, method in [
            (demo, owner, 113, "bKash"), (demo, owner, 72, "bKash"), (demo, owner, 42, "VISA-Dutch Bangla Bank"),
            (urban, urban_owner, 38, "Nagad"), (demo, owner, 12, "bKash"),
        ]:
            n += 1
            start = ago(days)
            payment = Payment.objects.create(
                tran_id=f"FRISEED{n:04d}", business=business, amount=1000, currency="BDT", status="paid",
                method=method, paid_at=start, period_start=start, period_end=start + relativedelta(months=1),
                invoice_no=f"INV-{start.year}-{n:04d}", val_id=f"SEED{n}", bank_tran_id=f"SEEDBANK{n}",
                payer_name=payer.name, payer_email=payer.email, payer_phone="01711000000",
            )
            Payment.objects.filter(pk=payment.pk).update(created_at=start)
        failed = Payment.objects.create(
            tran_id="FRIURBANFAIL", business=urban, amount=1000, currency="BDT", status="failed",
            payer_name=urban_owner.name, payer_email=urban_owner.email, payer_phone="01811000000",
        )
        Payment.objects.filter(pk=failed.pk).update(created_at=ago(3))

        self.stdout.write(self.style.SUCCESS("Demo data loaded. Logins:"))
        for email, password in [
            ("super@friday.app", "super123"), ("owner@friday.app", "owner123"), ("manager@friday.app", "manager123"),
            ("staff@friday.app", "staff123"), ("cafe@friday.app", "cafe1234"), ("urban@friday.app", "urban123"),
        ]:
            self.stdout.write(f"  {email} / {password}")

    def ago(self, days):
        return self.now - timedelta(days=days)

    def user(self, email, name, role, business, password, locations):
        user = User(email=email, name=name, role=role, business=business)
        # Demo passwords are short on purpose; skip the strength validators.
        user.set_password(password)
        user.save()
        user.locations.set(locations)
        return user
