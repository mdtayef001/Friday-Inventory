from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User

from .models import Location, Product, StockLevel

PASSWORD = "a-long-test-password-1"


class ApiTestCase(APITestCase):
    def setUp(self):
        cache.clear()  # reset the login rate limit
        self.biz = Business.objects.create(name="Shop A")
        self.other_biz = Business.objects.create(name="Shop B")
        self.owner = self.make_user("owner@a.com", User.Role.OWNER, self.biz)
        self.warehouse = Location.objects.create(business=self.biz, name="Main", type="warehouse")
        self.outlet = Location.objects.create(business=self.biz, name="Outlet 1", type="outlet")
        self.staff = self.make_user("staff@a.com", User.Role.STAFF, self.biz)
        self.staff.locations.set([self.outlet])
        self.product = Product.objects.create(business=self.biz, sku="TV-1", barcode="123", name="TV", rentable=True)
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.warehouse, quantity=10)

    def make_user(self, email, role, business):
        return User.objects.create_user(email=email, password=PASSWORD, name=email, role=role, business=business)

    def login(self, email):
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")
        return res.json()

    def qty(self, location):
        row = StockLevel.objects.filter(product=self.product, location=location).first()
        return row.quantity if row else 0


class AuthTests(ApiTestCase):
    def test_login_returns_session_user(self):
        data = self.login("OWNER@a.com")
        self.assertEqual(data["user"]["role"], "owner")
        self.assertEqual(data["user"]["tenantId"], self.biz.id)

    def test_endpoints_need_a_token(self):
        self.assertEqual(self.client.get("/api/products/").status_code, 401)

    def test_super_admin_cannot_use_tenant_endpoints(self):
        User.objects.create_superuser(email="root@x.com", password=PASSWORD, name="Root")
        self.login("root@x.com")
        self.assertEqual(self.client.get("/api/products/").status_code, 403)
        self.assertEqual(self.client.get("/api/platform/businesses/").status_code, 200)


class TenantTests(ApiTestCase):
    def test_other_business_data_is_invisible(self):
        Product.objects.create(business=self.other_biz, sku="X", name="Hidden")
        self.login("owner@a.com")
        names = [p["name"] for p in self.client.get("/api/products/").json()["results"]]
        self.assertEqual(names, ["TV"])

    def test_cannot_reference_other_business_location(self):
        foreign = Location.objects.create(business=self.other_biz, name="Theirs", type="outlet")
        self.login("owner@a.com")
        res = self.client.post(
            "/api/stock/adjust/", {"product": self.product.id, "location": foreign.id, "delta": 5}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_locked_business_is_refused(self):
        self.biz.trial_ends_at = timezone.now() - timedelta(days=1)
        self.biz.save()
        self.login("owner@a.com")
        self.assertEqual(self.client.get("/api/products/").status_code, 403)


class RoleTests(ApiTestCase):
    def test_staff_only_adjusts_stock_at_their_locations(self):
        self.login("staff@a.com")
        ok = self.client.post(
            "/api/stock/adjust/", {"product": self.product.id, "location": self.outlet.id, "delta": 3}, format="json"
        )
        self.assertEqual(ok.status_code, 204)
        denied = self.client.post(
            "/api/stock/adjust/", {"product": self.product.id, "location": self.warehouse.id, "delta": 3}, format="json"
        )
        self.assertEqual(denied.status_code, 403)

    def test_staff_cannot_see_clients_or_users(self):
        self.login("staff@a.com")
        self.assertEqual(self.client.get("/api/clients/").status_code, 403)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)

    def test_owner_creates_staff_who_can_log_in(self):
        self.login("owner@a.com")
        res = self.client.post(
            "/api/users/",
            {"name": "New", "email": "new@a.com", "role": "staff", "password": PASSWORD, "locationIds": [self.outlet.id]},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.client.credentials()
        self.assertEqual(self.login("new@a.com")["user"]["locationIds"], [self.outlet.id])


class StockFlowTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.login("owner@a.com")
        self.client_id = self.client.post("/api/clients/", {"name": "Rahim"}, format="json").json()["id"]

    def test_transfer_moves_stock_on_receive(self):
        res = self.client.post(
            "/api/transfers/",
            {"product": self.product.id, "quantity": 4, "fromLocation": self.warehouse.id, "toLocation": self.outlet.id},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((self.qty(self.warehouse), self.qty(self.outlet)), (6, 0))
        self.client.post(f"/api/transfers/{res.json()['id']}/receive/")
        self.assertEqual((self.qty(self.warehouse), self.qty(self.outlet)), (6, 4))

    def test_cannot_ship_more_than_in_stock(self):
        res = self.client.post(
            "/api/shipments/",
            {"product": self.product.id, "quantity": 11, "client": self.client_id, "fromLocation": self.warehouse.id},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_cancelled_shipment_restocks(self):
        sh = self.client.post(
            "/api/shipments/",
            {"product": self.product.id, "quantity": 2, "client": self.client_id, "fromLocation": self.warehouse.id},
            format="json",
        ).json()
        self.assertEqual(self.qty(self.warehouse), 8)
        res = self.client.post(f"/api/shipments/{sh['id']}/status/", {"status": "cancelled"}, format="json")
        self.assertEqual(len(res.json()["history"]), 2)
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_weekly_rental_bills_every_started_week(self):
        res = self.client.post(
            "/api/rentals/",
            {
                "product": self.product.id, "quantity": 2, "client": self.client_id, "location": self.warehouse.id,
                "startDate": "2026-10-01", "days": 10, "plan": "weekly", "rate": "500",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(float(res.json()["total"]), 2000.0)  # 2 weeks × 500 × 2 units
        self.client.post(f"/api/rentals/{res.json()['id']}/return/")
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_disabled_module_is_refused(self):
        self.biz.settings["modules"]["rentals"] = False
        self.biz.save()
        self.assertEqual(self.client.get("/api/rentals/").status_code, 403)
