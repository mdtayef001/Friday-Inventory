from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User

from .models import Location, Product, Rental, Shipment, StockLevel

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
        self.assertEqual(data["user"]["tenantId"], str(self.biz.id))

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
        names = [p["name"] for p in self.client.get("/api/products/").json()]
        self.assertEqual(names, ["TV"])

    def test_cannot_reference_other_business_location(self):
        foreign = Location.objects.create(business=self.other_biz, name="Theirs", type="outlet")
        self.login("owner@a.com")
        res = self.client.post(
            "/api/stock/adjust/", {"productId": self.product.id, "locationId": foreign.id, "delta": 5}, format="json"
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
            "/api/stock/adjust/", {"productId": self.product.id, "locationId": self.outlet.id, "delta": 3}, format="json"
        )
        self.assertEqual(ok.status_code, 204)
        denied = self.client.post(
            "/api/stock/adjust/", {"productId": self.product.id, "locationId": self.warehouse.id, "delta": 3}, format="json"
        )
        self.assertEqual(denied.status_code, 403)

    def test_staff_can_pick_clients_but_not_manage_them_or_users(self):
        self.login("staff@a.com")
        self.assertEqual(self.client.get("/api/clients/").status_code, 200)  # to rent to them
        created = self.client.post("/api/clients/", {"name": "Walk-in Ali"}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self.client.patch(f"/api/clients/{created.json()['id']}/", {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/clients/{created.json()['id']}/").status_code, 403)
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
        self.assertEqual(self.login("new@a.com")["user"]["locationIds"], [str(self.outlet.id)])


class StockFlowTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.login("owner@a.com")
        self.client_id = self.client.post("/api/clients/", {"name": "Rahim"}, format="json").json()["id"]

    def test_transfer_moves_stock_on_receive(self):
        res = self.client.post(
            "/api/transfers/",
            {"productId": self.product.id, "quantity": 4, "fromLocationId": self.warehouse.id, "toLocationId": self.outlet.id},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((self.qty(self.warehouse), self.qty(self.outlet)), (6, 0))
        self.client.post(f"/api/transfers/{res.json()['id']}/receive/")
        self.assertEqual((self.qty(self.warehouse), self.qty(self.outlet)), (6, 4))

    def test_cannot_ship_more_than_in_stock(self):
        res = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 11, "clientId": self.client_id, "fromLocationId": self.warehouse.id},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_cancelled_shipment_restocks(self):
        sh = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 2, "clientId": self.client_id, "fromLocationId": self.warehouse.id},
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
                "productId": self.product.id, "quantity": 2, "clientId": self.client_id, "locationId": self.warehouse.id,
                "startDate": "2026-10-01T09:00:00Z", "days": 10, "plan": "weekly", "rate": "500",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["total"], 2000)  # 2 weeks × 500 × 2 units
        self.client.post(f"/api/rentals/{res.json()['id']}/return/")
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_disabled_module_is_refused(self):
        self.biz.settings["modules"]["rentals"] = False
        self.biz.save()
        self.assertEqual(self.client.get("/api/rentals/").status_code, 403)


class PublicTrackingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.login("owner@a.com")
        client_id = self.client.post("/api/clients/", {"name": "Rahim"}, format="json").json()["id"]
        self.order = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 2, "clientId": client_id, "fromLocationId": self.warehouse.id, "notes": "secret note"},
            format="json",
        ).json()
        self.client.credentials()  # the client has no login

    def track(self, token=None):
        return self.client.get(f"/api/track/{token or self.order['trackingToken']}/")

    def test_client_sees_status_without_logging_in(self):
        res = self.track()
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual((data["businessName"], data["productName"], data["status"]), ("Shop A", "TV", "pending"))
        self.assertEqual([e["status"] for e in data["history"]], ["pending"])

    def test_nothing_internal_is_shown(self):
        body = self.track().content.decode()
        for private in ("secret note", "Main", "price", "cost", "owner@a.com", "Rahim", '"by"'):
            self.assertNotIn(private, body)

    def test_unknown_or_order_number_tokens_fail(self):
        self.assertEqual(self.track("not-a-real-token").status_code, 404)
        self.assertEqual(self.track(self.order["code"]).status_code, 404)

    def test_owner_can_turn_links_off(self):
        self.biz.settings["modules"]["trackingLinks"] = False
        self.biz.save()
        self.assertEqual(self.track().status_code, 404)

    def test_link_expires_30_days_after_delivery(self):
        from .models import ShipmentEvent

        shipment = Shipment.objects.get(pk=self.order["id"])
        shipment.status = "delivered"
        shipment.save()
        ShipmentEvent.objects.create(shipment=shipment, status="delivered")
        self.assertEqual(self.track().status_code, 200)
        ShipmentEvent.objects.filter(shipment=shipment).update(at=timezone.now() - timedelta(days=31))
        Shipment.objects.filter(pk=shipment.pk).update(created_at=timezone.now() - timedelta(days=40))
        self.assertEqual(self.track().status_code, 404)

    def test_locked_business_hides_links(self):
        self.biz.trial_ends_at = timezone.now() - timedelta(days=1)
        self.biz.save()
        self.assertEqual(self.track().status_code, 404)


class SalesBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.product.price, self.product.cost = 500, 300
        self.product.save()
        self.login("owner@a.com")
        self.client_id = self.client.post("/api/clients/", {"name": "Rahim"}, format="json").json()["id"]

    def sell(self, **body):
        data = {"productId": self.product.id, "locationId": self.warehouse.id, "quantity": 2, "unitPrice": "480", **body}
        return self.client.post("/api/sales/", data, format="json")


class SalesTests(SalesBase):
    def test_walk_in_sale_takes_stock_and_freezes_price(self):
        res = self.sell(discount="60")
        self.assertEqual(res.status_code, 201, res.content)
        sale = res.json()
        self.assertEqual((sale["revenue"], sale["cost"], sale["profit"]), (900, 600, 300))
        self.assertEqual(self.qty(self.warehouse), 8)
        # A later price change doesn't rewrite the past.
        self.product.price, self.product.cost = 999, 999
        self.product.save()
        again = self.client.get("/api/sales/").json()[0]
        self.assertEqual((again["unitPrice"], again["unitCost"], again["profit"]), (480, 300, 300))

    def test_bad_sales_are_refused_and_leave_stock_alone(self):
        self.assertEqual(self.sell(quantity=99).status_code, 400)
        self.assertEqual(self.sell(discount="5000").status_code, 400)
        self.assertEqual(self.qty(self.warehouse), 10)
        self.assertEqual(self.client.get("/api/sales/").json(), [])

    def test_staff_sell_at_their_shop_without_seeing_cost(self):
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=5)
        self.client.credentials()
        self.login("staff@a.com")
        res = self.sell(locationId=self.outlet.id, quantity=1, clientId=self.client_id)
        self.assertEqual(res.status_code, 201, res.content)
        for private in ("unitCost", "cost", "profit"):
            self.assertNotIn(private, res.json())
        self.assertIsNone(res.json()["clientId"])
        self.assertEqual(self.sell().status_code, 403)  # not their shop
        mine = self.client.get("/api/sales/").json()
        self.assertEqual([x["soldBy"] for x in mine], ["staff@a.com"])

    def test_delivered_order_becomes_a_sale_and_return_refunds_it(self):
        order = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 3, "clientId": self.client_id, "fromLocationId": self.warehouse.id, "unitPrice": "450"},
            format="json",
        ).json()
        self.assertEqual(order["unitPrice"], 450)
        self.product.price = 999  # changed after the order was agreed
        self.product.save()
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "delivered"}, format="json")
        sale = self.client.get("/api/sales/").json()[0]
        self.assertEqual((sale["channel"], sale["orderId"], sale["revenue"], sale["profit"]), ("order", order["id"], 1350, 450))
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "returned"}, format="json")
        self.assertIsNotNone(self.client.get("/api/sales/").json()[0]["refundedAt"])

    def test_order_price_defaults_to_product_price(self):
        order = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "fromLocationId": self.warehouse.id},
            format="json",
        ).json()
        self.assertEqual(order["unitPrice"], 500)

    def test_returned_rental_records_its_income(self):
        rental = self.client.post(
            "/api/rentals/",
            {"productId": self.product.id, "quantity": 2, "clientId": self.client_id, "locationId": self.warehouse.id,
             "startDate": "2026-10-01T09:00:00Z", "days": 3, "plan": "daily", "rate": "100"},
            format="json",
        ).json()
        self.assertEqual(self.client.get("/api/sales/").json(), [])  # counts when it comes back
        Rental.objects.filter(pk=rental["id"]).update(start_date=timezone.now() - timedelta(days=3, minutes=-1))
        self.client.post(f"/api/rentals/{rental['id']}/return/")
        sale = self.client.get("/api/sales/").json()[0]
        self.assertEqual((sale["channel"], sale["revenue"], sale["profit"], sale["rentalId"]), ("rental", 600, 600, rental["id"]))

    def test_manager_sees_own_shops_sales_without_profit(self):
        manager = User.objects.create_user(email="m@a.com", password=PASSWORD, name="M", role="manager", business=self.biz)
        manager.locations.set([self.outlet])
        self.sell()  # at the warehouse
        self.client.credentials()
        self.login("m@a.com")
        self.assertEqual(self.client.get("/api/sales/").json(), [])
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=5)
        self.sell(locationId=self.outlet.id, quantity=1)
        sales = self.client.get("/api/sales/").json()
        self.assertEqual(len(sales), 1)
        self.assertNotIn("profit", sales[0])


class SalesSummaryTests(SalesBase):
    def test_summary_totals_and_margin(self):
        self.sell(quantity=2, unitPrice="500")  # revenue 1000, cost 600
        self.sell(quantity=1, unitPrice="400", discount="100")  # revenue 300, cost 300
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual((s["count"], s["revenue"], s["cost"], s["profit"], s["unitsSold"]), (2, 1300, 900, 400, 3))
        self.assertEqual(s["margin"], 30.8)
        self.assertEqual(s["channels"]["store"]["revenue"], 1300)
        self.assertEqual(s["sellers"], [{"id": str(self.owner.id), "name": self.owner.name}])

    def test_refunded_sales_are_left_out(self):
        order = self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": 2, "clientId": self.client_id, "fromLocationId": self.warehouse.id},
            format="json",
        ).json()
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "delivered"}, format="json")
        self.assertEqual(self.client.get("/api/sales/summary/").json()["revenue"], 1000)
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "returned"}, format="json")
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual((s["revenue"], s["count"], s["refundedCount"]), (0, 0, 1))

    def test_filters_by_date_shop_product_and_type(self):
        self.sell(quantity=1)
        from .models import Sale

        Sale.objects.update(sold_at=timezone.now() - timedelta(days=10))
        self.sell(quantity=2)
        since = (timezone.now() - timedelta(days=1)).isoformat()
        self.assertEqual(len(self.client.get("/api/sales/", {"from": since}).json()), 1)
        self.assertEqual(self.client.get("/api/sales/summary/", {"to": since}).json()["unitsSold"], 1)
        self.assertEqual(self.client.get("/api/sales/summary/", {"location": self.outlet.id}).json()["count"], 0)
        self.assertEqual(self.client.get("/api/sales/summary/", {"product": self.product.id}).json()["count"], 2)
        self.assertEqual(self.client.get("/api/sales/summary/", {"channel": "rental"}).json()["count"], 0)
        self.assertEqual(self.client.get("/api/sales/", {"from": "yesterday"}).status_code, 400)

    def test_manager_summary_has_no_profit(self):
        manager = User.objects.create_user(email="m2@a.com", password=PASSWORD, name="M", role="manager", business=self.biz)
        manager.locations.set([self.warehouse])
        self.sell()
        self.client.credentials()
        self.login("m2@a.com")
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual(s["revenue"], 960)
        for private in ("cost", "profit", "margin"):
            self.assertNotIn(private, s)
            self.assertNotIn(private, s["channels"]["store"])


class SalesInsightTests(SalesBase):
    def test_series_fills_empty_days(self):
        self.sell(quantity=2, unitPrice="500")
        since = (timezone.localtime() - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        series = self.client.get("/api/sales/summary/", {"from": since.isoformat()}).json()["series"]
        self.assertEqual(series["bucket"], "day")
        self.assertEqual(len(series["points"]), 7)
        self.assertEqual(series["points"][-1], {"date": timezone.localdate().isoformat(), "revenue": 1000, "profit": 400})
        self.assertEqual(series["points"][0]["revenue"], 0)

    def test_long_ranges_group_by_month(self):
        self.sell()
        since = (timezone.now() - timedelta(days=200)).isoformat()
        series = self.client.get("/api/sales/summary/", {"from": since}).json()["series"]
        self.assertEqual(series["bucket"], "month")
        self.assertTrue(series["points"][-1]["date"].endswith("-01"))
        self.assertEqual(sum(p["revenue"] for p in series["points"]), 960)

    def test_top_products_leave_out_rentals(self):
        self.sell(quantity=3, unitPrice="500")
        top = self.client.get("/api/sales/summary/").json()["topProducts"]
        self.assertEqual(top, [{"productId": str(self.product.id), "name": "TV", "units": 3, "revenue": 1500, "profit": 600}])

    def test_csv_export_opens_in_excel_and_is_safe(self):
        self.product.name = "=HYPERLINK(evil)"
        self.product.save()
        self.sell(quantity=2, unitPrice="500")
        res = self.client.get("/api/sales/export/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("attachment;", res["Content-Disposition"])
        body = res.content.decode("utf-8")
        self.assertTrue(body.startswith("﻿"))
        lines = body.lstrip("﻿").splitlines()
        self.assertEqual(lines[0], "Date,Type,Product,Quantity,Unit price,Discount,Total,Unit cost,Cost,Profit,Payment,Payment status,Shop,Client,Sold by,Refunded")
        self.assertIn("'=HYPERLINK(evil)", lines[1])
        self.assertIn(",1000.00,", lines[1])

    def test_manager_sees_profit_only_when_the_owner_allows(self):
        manager = User.objects.create_user(email="m3@a.com", password=PASSWORD, name="M", role="manager", business=self.biz)
        manager.locations.set([self.warehouse])
        self.sell()
        self.client.credentials()
        self.login("m3@a.com")
        self.assertNotIn("profit", self.client.get("/api/sales/summary/").json())
        self.assertNotIn("Profit", self.client.get("/api/sales/export/").content.decode())
        self.biz.settings["permissions"]["managerProfit"] = True
        self.biz.save()
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual((s["profit"], s["topProducts"][0]["profit"]), (360, 360))
        self.assertIn("profit", self.client.get("/api/sales/").json()[0])
        self.assertIn("Profit", self.client.get("/api/sales/export/").content.decode())

    def test_staff_cannot_export(self):
        self.client.credentials()
        self.login("staff@a.com")
        self.assertEqual(self.client.get("/api/sales/export/").status_code, 403)


class MySalesTests(SalesBase):
    def test_staff_only_ever_see_their_own_sales(self):
        self.sell(quantity=1)  # by the owner
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=5)
        self.client.credentials()
        self.login("staff@a.com")
        self.sell(locationId=self.outlet.id, quantity=2, unitPrice="450")
        sales = self.client.get("/api/sales/").json()
        self.assertEqual([(x["productName"], x["quantity"], x["revenue"]) for x in sales], [("TV", 2, 900)])
        s = self.client.get("/api/sales/summary/", {"seller": str(self.owner.id)}).json()
        self.assertEqual((s["count"], s["unitsSold"], s["revenue"], s["sellers"]), (1, 2, 900, []))
        for private in ("profit", "cost", "margin"):
            self.assertNotIn(private, s)
        self.assertNotIn("profit", s["topProducts"][0])
        self.assertEqual(self.client.get("/api/sales/export/").status_code, 403)

    def test_owner_can_ask_for_just_their_own(self):
        self.sell(quantity=1)
        staff = User.objects.get(email="staff@a.com")
        from .models import Sale

        Sale.objects.create(business=self.biz, channel="store", product=self.product, product_name="TV", quantity=1, unit_price=1, sold_by=staff)
        self.assertEqual(len(self.client.get("/api/sales/").json()), 2)
        self.assertEqual(len(self.client.get("/api/sales/", {"mine": "1"}).json()), 1)


class StaffRightsTests(SalesBase):
    def setUp(self):
        super().setUp()
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=5)
        self.staff = User.objects.get(email="staff@a.com")

    def as_staff(self):
        self.client.credentials()
        self.login("staff@a.com")

    def adjust(self, delta):
        return self.client.post(
            "/api/stock/adjust/", {"productId": self.product.id, "locationId": self.outlet.id, "delta": delta}, format="json"
        )

    def test_owner_turns_off_selling_for_one_staff_member(self):
        res = self.client.patch(f"/api/users/{self.staff.id}/", {"canSell": False}, format="json")
        self.assertEqual((res.status_code, res.json()["canSell"], res.json()["canAddStock"]), (200, False, True))
        self.as_staff()
        self.assertFalse(self.client.get("/api/auth/me/").json()["user"]["canSell"])
        self.assertEqual(self.sell(locationId=self.outlet.id, quantity=1).status_code, 403)
        self.assertEqual(self.adjust(2).status_code, 204)

    def test_owner_turns_off_stock_entry(self):
        self.client.patch(f"/api/users/{self.staff.id}/", {"canAddStock": False}, format="json")
        self.as_staff()
        self.assertEqual(self.adjust(2).status_code, 403)
        self.assertEqual(self.adjust(-1).status_code, 403)
        new = self.client.post("/api/products/", {"sku": "NEW-1", "name": "New", "price": 1}, format="json")
        self.assertEqual(new.status_code, 403)
        self.assertEqual(self.sell(locationId=self.outlet.id, quantity=1).status_code, 201)

    def test_managers_and_owners_always_have_both(self):
        self.owner.can_sell = self.owner.can_add_stock = False
        self.owner.save()
        me = self.client.get("/api/auth/me/").json()["user"]
        self.assertEqual((me["canSell"], me["canAddStock"]), (True, True))
        self.assertEqual(self.sell(quantity=1).status_code, 201)

    def test_manager_sets_rights_for_staff_at_their_shop(self):
        manager = User.objects.create_user(email="mg@a.com", password=PASSWORD, name="Mg", role="manager", business=self.biz)
        manager.locations.set([self.outlet])
        self.client.credentials()
        self.login("mg@a.com")
        res = self.client.patch(f"/api/users/{self.staff.id}/", {"canSell": False}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.can_sell)


class RentalScanTests(SalesBase):
    def scan_out(self, plan="daily", rate="100", quantity=1, **extra):
        res = self.client.post(
            "/api/rentals/",
            {"productId": self.product.id, "quantity": quantity, "clientId": self.client_id, "locationId": self.warehouse.id,
             "startDate": timezone.now().isoformat(), "plan": plan, "rate": rate, **extra},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def scan_in(self, rental, days_out, holidays=None):
        Rental.objects.filter(pk=rental["id"]).update(start_date=timezone.now() - timedelta(days=days_out, minutes=-1))
        body = {} if holidays is None else {"holidays": holidays}
        return self.client.post(f"/api/rentals/{rental['id']}/return/", body, format="json")

    def test_no_days_needed_to_scan_out(self):
        rental = self.scan_out()
        self.assertIsNone(rental["days"])
        self.assertEqual(self.qty(self.warehouse), 9)

    def test_per_day_price_is_actual_days_minus_holidays(self):
        res = self.scan_in(self.scan_out(quantity=2), days_out=7, holidays=1)
        self.assertEqual(res.status_code, 200, res.content)
        r = res.json()
        self.assertEqual((r["daysOut"], r["holidays"], r["total"]), (7, 1, 1200))  # 6 days × 100 × 2
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_holidays_ignored_for_weekly_and_monthly(self):
        r = self.scan_in(self.scan_out(plan="weekly", rate="500"), days_out=10, holidays=3).json()
        self.assertEqual((r["daysOut"], r["holidays"], r["total"]), (10, 0, 1000))  # 2 started weeks

    def test_too_many_holidays_refused(self):
        rental = self.scan_out()
        self.assertEqual(self.scan_in(rental, days_out=3, holidays=3).status_code, 400)
        self.assertEqual(self.qty(self.warehouse), 9)  # still out

    def test_same_day_return_is_one_day(self):
        rental = self.scan_out(rate="80")
        r = self.client.post(f"/api/rentals/{rental['id']}/return/", {}, format="json").json()
        self.assertEqual((r["daysOut"], r["total"]), (1, 80))

    def test_staff_scan_out_and_in_at_their_shop_if_they_may_sell(self):
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=3)
        staff = User.objects.get(email="staff@a.com")
        self.client.credentials()
        self.login("staff@a.com")
        body = {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "locationId": self.outlet.id,
                "startDate": timezone.now().isoformat(), "plan": "daily", "rate": "50"}
        res = self.client.post("/api/rentals/", body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.client.post("/api/rentals/", {**body, "locationId": self.warehouse.id}, format="json").status_code, 403)
        staff.can_sell = False
        staff.save()
        self.assertEqual(self.client.post(f"/api/rentals/{res.json()['id']}/return/", {}, format="json").status_code, 403)


class StockRequestTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.manager = User.objects.create_user(email="shop@a.com", password=PASSWORD, name="Shop Mgr", role="manager", business=self.biz)
        self.manager.locations.set([self.outlet])
        self.login("shop@a.com")

    def ask(self, quantity=4):
        res = self.client.post("/api/stock-requests/", {"productId": self.product.id, "quantity": quantity, "toLocationId": self.outlet.id, "note": "Weekend rush"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def as_owner(self):
        self.client.credentials()
        self.login("owner@a.com")

    def test_shop_asks_owner_approves_and_stock_arrives(self):
        req = self.ask()
        self.assertEqual((req["status"], req["stage"], req["requestedBy"]), ("pending", "pending", "Shop Mgr"))
        self.as_owner()
        res = self.client.post(f"/api/stock-requests/{req['id']}/approve/", {"fromLocationId": self.warehouse.id, "quantity": 3}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        approved = res.json()
        self.assertEqual((approved["status"], approved["stage"], approved["fromLocationId"]), ("approved", "in_transit", str(self.warehouse.id)))
        self.assertEqual(self.qty(self.warehouse), 7)  # left the warehouse
        self.client.post(f"/api/transfers/{approved['transferId']}/receive/")
        self.assertEqual(self.client.get("/api/stock-requests/").json()[0]["stage"], "received")
        self.assertEqual(self.qty(self.outlet), 3)

    def test_cannot_approve_more_than_the_warehouse_has(self):
        req = self.ask(quantity=50)
        self.as_owner()
        res = self.client.post(f"/api/stock-requests/{req['id']}/approve/", {"fromLocationId": self.warehouse.id}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.client.get("/api/stock-requests/").json()[0]["status"], "pending")

    def test_manager_cannot_send_from_a_location_they_dont_run(self):
        req = self.ask()
        res = self.client.post(f"/api/stock-requests/{req['id']}/approve/", {"fromLocationId": self.warehouse.id}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_decline_cancel_and_no_double_handling(self):
        req = self.ask()
        self.assertEqual(self.client.post(f"/api/stock-requests/{req['id']}/decline/", {}, format="json").status_code, 403)
        self.as_owner()
        declined = self.client.post(f"/api/stock-requests/{req['id']}/decline/", {"note": "Order next week"}, format="json").json()
        self.assertEqual((declined["status"], declined["decisionNote"], declined["decidedBy"]), ("declined", "Order next week", "owner@a.com"))
        again = self.client.post(f"/api/stock-requests/{req['id']}/approve/", {"fromLocationId": self.warehouse.id}, format="json")
        self.assertEqual(again.status_code, 400)
        self.client.credentials()
        self.login("shop@a.com")
        other = self.ask()
        self.assertEqual(self.client.post(f"/api/stock-requests/{other['id']}/cancel/").json()["status"], "cancelled")

    def test_only_for_own_shop_and_needs_transfers_on(self):
        res = self.client.post("/api/stock-requests/", {"productId": self.product.id, "quantity": 1, "toLocationId": self.warehouse.id}, format="json")
        self.assertEqual(res.status_code, 403)
        self.biz.settings["modules"]["transfers"] = False
        self.biz.save()
        self.assertEqual(self.client.get("/api/stock-requests/").status_code, 403)


class PaymentMethodTests(SalesBase):
    def settings_with(self, **payments):
        current = self.client.get("/api/business/").json()["settings"]
        current["payments"] = {**current["payments"], **payments}
        return self.client.patch("/api/business/", {"settings": current}, format="json")

    def save_merchant(self):
        return self.client.put("/api/business/merchant/", {"storeId": "shop123", "storePassword": "s3cret", "sandbox": True}, format="json")

    def test_cash_only_by_default(self):
        self.assertEqual(self.sell(paymentMethod="card").status_code, 400)
        res = self.sell()
        self.assertEqual((res.json()["paymentMethod"], res.json()["paymentStatus"]), ("cash", "paid"))

    def test_owner_turns_on_mobile_and_card(self):
        self.assertEqual(self.settings_with(mobile=True).status_code, 400)  # needs the number
        self.assertEqual(self.settings_with(mobile=True, mobileNumber="bKash 01711000000", card=True).status_code, 200)
        self.assertEqual(self.sell(paymentMethod="mobile").json()["paymentMethod"], "mobile")
        self.assertEqual(self.sell(quantity=1, paymentMethod="card").status_code, 201)
        methods = self.client.get("/api/sales/summary/").json()["methods"]
        self.assertEqual((methods["mobile"]["count"], methods["card"]["count"], methods["cash"]["count"]), (1, 1, 0))

    def test_merchant_password_is_encrypted_and_never_returned(self):
        self.assertEqual(self.settings_with(online=True).status_code, 400)  # account first
        res = self.save_merchant()
        self.assertEqual(res.json(), {"configured": True, "storeId": "shop123", "sandbox": True, "hasPassword": True})
        from apps.accounts.models import MerchantAccount

        stored = MerchantAccount.objects.get(business=self.biz)
        self.assertNotIn("s3cret", stored.store_password)
        self.assertEqual(stored.password, "s3cret")
        self.assertEqual(self.settings_with(online=True).status_code, 200)
        self.client.credentials()
        self.login("staff@a.com")
        self.assertEqual(self.client.get("/api/business/merchant/").status_code, 403)

    def online_sale(self):
        from unittest import mock

        self.save_merchant()
        self.settings_with(online=True)
        with mock.patch("apps.billing.sslcommerz.open_session", return_value=("https://sandbox.sslcommerz.com/pay/x", None)) as opened:
            res = self.sell(quantity=2, unitPrice="500", paymentMethod="online")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(opened.call_args.kwargs["amount"], 1000)
        return res.json()

    def test_online_sale_holds_stock_until_paid(self):
        from unittest import mock

        sale = self.online_sale()
        self.assertEqual((sale["paymentStatus"], sale["paymentUrl"]), ("pending", "https://sandbox.sslcommerz.com/pay/x"))
        self.assertEqual(self.qty(self.warehouse), 8)  # held
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual((s["revenue"], s["waitingCount"]), (0, 1))
        from .models import Sale

        tran = Sale.objects.get(pk=sale["id"]).tran_id
        # A forged callback: SSLCommerz says it isn't valid.
        with mock.patch("apps.billing.sslcommerz.check", return_value=(False, "", "")):
            self.client.credentials()
            self.client.post("/api/sale-payments/success/", {"tranId": tran, "valId": "FAKE"}, format="json")
        self.login("owner@a.com")
        self.assertEqual(self.client.get(f"/api/sales/{sale['id']}/").json()["paymentStatus"], "pending")
        with mock.patch("apps.billing.sslcommerz.check", return_value=(True, "BKASH-BKash", "BANK1")):
            res = self.client.post("/api/sale-payments/success/", {"tranId": tran, "valId": "VAL1"}, format="json")
        self.assertEqual(res.json()["status"], "success")
        paid = self.client.get(f"/api/sales/{sale['id']}/").json()
        self.assertEqual((paid["paymentStatus"], paid["gatewayMethod"]), ("paid", "BKASH-BKash"))
        self.assertEqual(self.client.get("/api/sales/summary/").json()["methods"]["online"]["revenue"], 1000)

    def test_failed_or_cancelled_online_payment_gives_stock_back(self):
        sale = self.online_sale()
        from .models import Sale

        tran = Sale.objects.get(pk=sale["id"]).tran_id
        self.client.post("/api/sale-payments/fail/", {"tranId": tran}, format="json")
        self.assertEqual(self.qty(self.warehouse), 10)
        self.assertEqual(self.client.get(f"/api/sales/{sale['id']}/").json()["paymentStatus"], "failed")
        other = self.online_sale()
        self.client.post(f"/api/sales/{other['id']}/cancel-payment/")
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_unfinished_online_payment_expires_after_30_minutes(self):
        sale = self.online_sale()
        from .models import Sale

        Sale.objects.filter(pk=sale["id"]).update(sold_at=timezone.now() - timedelta(minutes=31))
        self.assertEqual(self.client.get(f"/api/sales/{sale['id']}/").json()["paymentStatus"], "cancelled")
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_rental_return_records_how_it_was_paid(self):
        rental = self.client.post(
            "/api/rentals/",
            {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "locationId": self.warehouse.id,
             "startDate": timezone.now().isoformat(), "plan": "daily", "rate": "100"},
            format="json",
        ).json()
        self.assertEqual(self.client.post(f"/api/rentals/{rental['id']}/return/", {"paymentMethod": "card"}, format="json").status_code, 400)
        self.client.post(f"/api/rentals/{rental['id']}/return/", {"paymentMethod": "cash"}, format="json")
        self.assertEqual(self.client.get("/api/sales/").json()[0]["paymentMethod"], "cash")
