"""Adds a lot of sample data to one business, to try paging, search and filters.

    python manage.py seed_bulk                          # into the demo store (owner@friday.app)
    python manage.py seed_bulk --owner you@example.com  # into another owner's business
    python manage.py seed_bulk --reset                  # remove what it added

Everything it adds is marked (SKU "BLK-", client emails @sample.test, activity
ending in "(sample)"), so --reset removes only that.
"""

import random
import secrets
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.inventory.models import (
    Activity, Client, Location, Product, Rental, Sale, Shipment, ShipmentEvent, StockLevel, StockRequest, Transfer,
)

SKU = "BLK-"
EMAIL = "@sample.test"
MARK = " (sample)"

CATEGORIES = {
    "Electronics": ["Monitor", "Keyboard", "Mouse", "Webcam", "Headset", "Router", "Speaker", "Tablet", "Charger", "Cable"],
    "Tools": ["Drill", "Saw", "Hammer", "Wrench Set", "Sander", "Grinder", "Ladder", "Toolbox", "Level", "Clamp"],
    "Furniture": ["Chair", "Desk", "Shelf", "Cabinet", "Stool", "Bench", "Sofa", "Table", "Lamp", "Rack"],
    "Event Equipment": ["Tent", "Stage Light", "PA System", "Projector", "Screen", "Chair Set", "Heater", "Generator", "Fog Machine", "Banner Stand"],
    "Office Supplies": ["Paper Ream", "Stapler", "Binder", "Whiteboard", "Marker Pack", "Label Printer", "Shredder", "Laminator", "Envelope Box", "Planner"],
    "Safety": ["Helmet", "Gloves", "Vest", "Goggles", "First Aid Kit", "Fire Extinguisher", "Ear Muffs", "Mask Box", "Boots", "Harness"],
}
ADJECTIVES = ["Pro", "Lite", "Max", "Mini", "Plus", "Heavy Duty", "Compact", "Classic", "Smart", "Ultra", "Eco", "XL"]
FIRST = ["Rahim", "Karim", "Nadia", "Ayesha", "Tanvir", "Sadia", "Imran", "Farzana", "Arif", "Nusrat", "Hasan", "Mitu", "Rafi", "Sumaiya", "Jamal", "Lima"]
LAST = ["Ahmed", "Hossain", "Rahman", "Islam", "Khan", "Chowdhury", "Uddin", "Akter", "Sarkar", "Biswas", "Das", "Roy"]
COMPANIES = ["", "", "Events Co", "Builders Ltd", "Interiors", "Traders", "Catering", "Studio", "Hotel", "School", "Clinic", "Agency"]


class Command(BaseCommand):
    help = "Add lots of sample data to one business, for trying paging and search."

    def add_arguments(self, parser):
        parser.add_argument("--owner", default="owner@friday.app", help="Email of the business owner to add data for.")
        parser.add_argument("--reset", action="store_true", help="Remove the sample data instead.")
        parser.add_argument("--products", type=int, default=400)
        parser.add_argument("--clients", type=int, default=250)

    @transaction.atomic
    def handle(self, *args, owner, reset, products, clients, **options):
        user = User.objects.filter(email__iexact=owner, role=User.Role.OWNER).first()
        if not user:
            raise CommandError(f"No owner with the email {owner}.")
        business = user.business
        self.remove(business)
        if reset:
            self.stdout.write(self.style.SUCCESS(f"Removed the sample data from {business.name}."))
            return

        locations = list(Location.objects.filter(business=business))
        if not locations:
            raise CommandError(f"{business.name} has no locations yet.")
        rng = random.Random(7)
        now = timezone.now()
        team = list(User.objects.filter(business=business, is_active=True)) or [user]

        made = self.products(business, user, locations, products, rng, now)
        people = self.clients(business, clients, rng, now)
        self.rentals(business, made, people, locations, rng, now)
        self.orders(business, made, people, locations, team, rng, now)
        self.transfers(business, made, locations, team, rng, now)
        self.requests(business, made, locations, team, rng, now)
        self.sales(business, made, people, locations, team, rng, now)
        self.activity(business, team, rng, now)

        self.stdout.write(self.style.SUCCESS(
            f"Added to {business.name}: {len(made)} products, {len(people)} clients, and orders, rentals, "
            f"transfers, sales and activity to go with them. Log in as {owner}."
        ))

    def remove(self, business):
        sample = {"business": business, "product__sku__startswith": SKU}
        for model in (Sale, Rental, Shipment, Transfer, StockRequest):
            model.objects.filter(**sample).delete()
        Client.objects.filter(business=business, email__endswith=EMAIL).delete()
        Product.objects.filter(business=business, sku__startswith=SKU).delete()
        Activity.objects.filter(business=business, detail__endswith=MARK).delete()

    def products(self, business, user, locations, count, rng, now):
        rows = []
        for i in range(count):
            category = rng.choice(list(CATEGORIES))
            name = f"{rng.choice(CATEGORIES[category])} {rng.choice(ADJECTIVES)} {i + 1}"
            cost = Decimal(rng.randrange(5, 800))
            rentable = category in ("Tools", "Event Equipment") and rng.random() < 0.6
            daily = (cost / 12).quantize(Decimal("1")) + 1
            rows.append(Product(
                business=business, sku=f"{SKU}{i + 1:04d}", barcode=f"99{i + 1:011d}", name=name, category=category,
                price=(cost * Decimal("1.4")).quantize(Decimal("1")), cost=cost, low_stock_threshold=rng.choice([0, 3, 5, 10]),
                rentable=rentable, rent_daily=daily if rentable else None, rent_weekly=daily * 5 if rentable else None,
                created_by=user,
            ))
        made = Product.objects.bulk_create(rows)
        # Spread over the last year, so "newest first" means something.
        for p in made:
            p.created_at = now - timedelta(days=rng.randrange(0, 365), minutes=rng.randrange(0, 1440))
        Product.objects.bulk_update(made, ["created_at"])

        stock = []
        for p in made:
            for loc in locations:
                roll = rng.random()
                if roll < 0.25:
                    continue  # never kept here
                # Some empty and some running low, so the low stock filters have something to show.
                qty = 0 if roll < 0.32 else rng.randrange(1, p.low_stock_threshold + 1) if roll < 0.45 and p.low_stock_threshold else rng.randrange(5, 120)
                stock.append(StockLevel(business=business, product=p, location=loc, quantity=qty))
        StockLevel.objects.bulk_create(stock)
        return made

    def clients(self, business, count, rng, now):
        rows = []
        for i in range(count):
            first, last = rng.choice(FIRST), rng.choice(LAST)
            company = rng.choice(COMPANIES)
            rows.append(Client(
                business=business, name=f"{first} {last}", company=f"{last} {company}" if company else "",
                phone=f"017{rng.randrange(10_000_000, 99_999_999)}", email=f"{first.lower()}.{last.lower()}{i}{EMAIL}",
                address=f"{rng.randrange(1, 200)} Road {rng.randrange(1, 40)}, Dhaka",
            ))
        return Client.objects.bulk_create(rows)

    def rentals(self, business, products, people, locations, rng, now):
        rentable = [p for p in products if p.rentable]
        rows = []
        for i in range(160):
            p = rng.choice(rentable)
            start = now - timedelta(days=rng.randrange(0, 90), hours=rng.randrange(0, 24))
            days = rng.choice([None, 1, 3, 7, 14])
            returned = rng.random() < 0.55 and (now - start).days > 1
            days_out = Rental.count_days(start, start + timedelta(days=rng.randrange(1, 15))) if returned else None
            rows.append(Rental(
                business=business, code=f"RNT-{secrets.token_hex(3).upper()}", product=p, quantity=rng.randrange(1, 3),
                client=rng.choice(people), location=rng.choice(locations), start_date=start, days=days,
                due_at=start + timedelta(days=days) if days else None, plan=Rental.Plan.DAILY, rate=p.rent_daily,
                total=p.rent_daily * (days_out or days or 1), status=Rental.Status.RETURNED if returned else Rental.Status.ACTIVE,
                returned_at=start + timedelta(days=days_out) if returned else None, days_out=days_out,
            ))
        Rental.objects.bulk_create(rows)

    def orders(self, business, products, people, locations, team, rng, now):
        flow = ["pending", "processing", "in_delivery", "delivered"]
        made, events = [], []
        for i in range(220):
            p = rng.choice(products)
            status = rng.choices(["pending", "processing", "in_delivery", "delivered", "returned", "cancelled"], [3, 2, 2, 8, 1, 2])[0]
            made.append(Shipment(
                business=business, code=f"SHP-{secrets.token_hex(3).upper()}", product=p, quantity=rng.randrange(1, 6),
                client=rng.choice(people), from_location=rng.choice(locations), status=status, unit_price=p.price, unit_cost=p.cost,
            ))
        made = Shipment.objects.bulk_create(made)
        for s in made:
            s.created_at = now - timedelta(days=rng.randrange(0, 120), hours=rng.randrange(0, 24))
            steps = flow[: flow.index(s.status) + 1] if s.status in flow else ["pending", s.status]
            for n, step in enumerate(steps):
                events.append(ShipmentEvent(shipment=s, status=step, by=rng.choice(team), note=""))
        Shipment.objects.bulk_update(made, ["created_at"])
        ShipmentEvent.objects.bulk_create(events)

    def transfers(self, business, products, locations, team, rng, now):
        if len(locations) < 2:
            return
        rows = []
        for i in range(120):
            a, b = rng.sample(locations, 2)
            status = rng.choices(["in_transit", "received", "cancelled"], [2, 8, 1])[0]
            rows.append(Transfer(
                business=business, code=f"TRF-{secrets.token_hex(3).upper()}", product=rng.choice(products),
                quantity=rng.randrange(1, 20), from_location=a, to_location=b, status=status, created_by=rng.choice(team),
                received_at=now if status == "received" else None,
            ))
        Transfer.objects.bulk_create(rows)

    def requests(self, business, products, locations, team, rng, now):
        rows = [
            StockRequest(
                business=business, code=f"REQ-{secrets.token_hex(3).upper()}", product=rng.choice(products),
                quantity=rng.randrange(2, 30), to_location=rng.choice(locations), note="Running low" if i % 3 == 0 else "",
                requested_by=rng.choice(team), status=StockRequest.Status.PENDING if i < 8 else StockRequest.Status.DECLINED,
            )
            for i in range(20)
        ]
        StockRequest.objects.bulk_create(rows)

    def sales(self, business, products, people, locations, team, rng, now):
        rows = []
        for i in range(700):
            p = rng.choice(products)
            qty = rng.randrange(1, 5)
            rows.append(Sale(
                business=business, channel=Sale.Channel.STORE, product=p, product_name=p.name, quantity=qty,
                unit_price=p.price, unit_cost=p.cost, discount=Decimal(rng.choice([0, 0, 0, 5, 10])),
                location=rng.choice(locations), client=rng.choice(people) if rng.random() < 0.3 else None,
                sold_by=rng.choice(team), sold_at=now - timedelta(days=rng.randrange(0, 180), minutes=rng.randrange(0, 1440)),
                payment_method=rng.choice(["cash", "cash", "mobile", "card"]),
            ))
        Sale.objects.bulk_create(rows)

    def activity(self, business, team, rng, now):
        actions = ["Stock added", "Stock removed", "Product updated", "Sold", "Transfer sent", "Order created", "Client added"]
        rows = [
            Activity(business=business, user=rng.choice(team), action=rng.choice(actions), detail=f"Sample entry {i + 1}{MARK}")
            for i in range(1200)
        ]
        made = Activity.objects.bulk_create(rows)
        for a in made:
            a.at = now - timedelta(days=rng.randrange(0, 200), minutes=rng.randrange(0, 1440))
        Activity.objects.bulk_update(made, ["at"])
