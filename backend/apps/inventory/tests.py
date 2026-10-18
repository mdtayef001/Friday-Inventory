from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User

from .models import Location, Product, Purchase, PurchaseItem, Rental, Shipment, StockLevel, Supplier

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

    def sell(self, items=None, **body):
        """One item (productId, quantity, unitPrice in `body`) unless `items` lists several."""
        item = {"productId": self.product.id, "quantity": 2, "unitPrice": "480"}
        item.update({k: body.pop(k) for k in list(body) if k in item})
        data = {"locationId": self.warehouse.id, "items": [item] if items is None else items, **body}
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
        self.assertEqual(lines[0], "Date,Type,Product,Quantity,Unit price,Discount,Total,Unit cost,Cost,Profit,Payment,Shop,Client,Sold by,Refunded")
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


class PaymentsBase(SalesBase):
    def settings_with(self, **payments):
        current = self.client.get("/api/business/").json()["settings"]
        current["payments"] = {**current["payments"], **payments}
        return self.client.patch("/api/business/", {"settings": current}, format="json")



class PaymentMethodTests(PaymentsBase):
    def test_cash_only_by_default(self):
        self.assertEqual(self.sell(paymentMethod="card").status_code, 400)
        self.assertEqual(self.sell().json()["paymentMethod"], "cash")

    def test_owner_turns_on_mobile_and_card(self):
        self.assertEqual(self.settings_with(mobile=True, card=True).status_code, 200)
        self.assertEqual(self.sell(paymentMethod="mobile").status_code, 400)  # needs the transaction ID
        sale = self.sell(paymentMethod="mobile", paymentReference=" 9AB3CD7XYZ ").json()
        self.assertEqual((sale["paymentMethod"], sale["paymentReference"]), ("mobile", "9AB3CD7XYZ"))
        self.assertEqual(self.client.get(f"/api/sales/{sale['id']}/receipt/").json()["paymentReference"], "9AB3CD7XYZ")
        self.assertEqual(self.sell(paymentMethod="mobile", paymentReference="9ab3cd7xyz").status_code, 400)  # used already
        self.assertEqual(self.sell(quantity=1, paymentMethod="card").status_code, 201)
        methods = self.client.get("/api/sales/summary/").json()["methods"]
        self.assertEqual((methods["mobile"]["count"], methods["card"]["count"], methods["cash"]["count"]), (1, 1, 0))
        self.assertNotIn("online", methods)

    def test_online_payment_is_not_offered(self):
        # Old clients may still send the switch: it's ignored, and the method is refused.
        self.assertEqual(self.settings_with(online=True).status_code, 200)
        self.assertNotIn("online", self.client.get("/api/business/").json()["settings"]["payments"])
        self.assertEqual(self.sell(paymentMethod="online").status_code, 400)
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


class ReceiptTests(PaymentsBase):
    def order(self, quantity=1):
        return self.client.post(
            "/api/shipments/",
            {"productId": self.product.id, "quantity": quantity, "clientId": self.client_id, "fromLocationId": self.warehouse.id},
            format="json",
        ).json()

    def test_paid_sales_are_numbered_per_business(self):
        first, second = self.sell(quantity=1).json(), self.sell(quantity=1).json()
        self.assertEqual((first["receiptNo"], second["receiptNo"]), ("R-000001", "R-000002"))
        # Another business starts at 1 too.
        from .models import Sale

        other = Product.objects.create(business=self.other_biz, sku="X", name="X")
        sale = Sale.objects.create(business=self.other_biz, channel="store", product=other, product_name="X", quantity=1, unit_price=1)
        from .services import number_receipt

        self.assertEqual(number_receipt(sale).receipt_code, "R-000001")

    def test_team_receipt_has_the_bill_and_who_served(self):
        sale = self.sell(discount="60", clientId=self.client_id).json()
        res = self.client.get(f"/api/sales/{sale['id']}/receipt/")
        self.assertEqual(res.status_code, 200, res.content)
        r = res.json()
        self.assertEqual((r["receiptNo"], r["businessName"], r["shop"]["name"]), ("R-000001", "Shop A", "Main"))
        self.assertEqual(r["items"], [{"name": "TV", "quantity": 2, "unitPrice": 480, "amount": 960, "returned": False}])
        self.assertEqual((r["subtotal"], r["discount"], r["total"], r["paymentLabel"]), (960, 60, 900, "Cash"))
        self.assertEqual((r["soldBy"], r["client"]["name"], r["receiptToken"]), ("owner@a.com", "Rahim", sale["receiptToken"]))
        for private in ("unitCost", "cost", "profit"):
            self.assertNotIn(private, r)

    def test_staff_only_open_receipts_for_their_own_sales(self):
        sale = self.sell(quantity=1).json()
        self.client.credentials()
        self.login("staff@a.com")
        self.assertEqual(self.client.get(f"/api/sales/{sale['id']}/receipt/").status_code, 404)

    def test_buyer_link_works_without_login_and_hides_internal_details(self):
        sale = self.sell(clientId=self.client_id).json()
        self.client.credentials()
        res = self.client.get(f"/api/receipts/{sale['receiptToken']}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["total"], 960)
        body = res.content.decode()
        for private in ("owner@a.com", "cost", "profit", "receiptToken", '"id"', "soldBy"):
            self.assertNotIn(private, body)
        self.assertEqual(self.client.get("/api/receipts/not-a-real-token/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/receipts/{sale['receiptNo']}/").status_code, 404)
        self.biz.trial_ends_at = timezone.now() - timedelta(days=1)
        self.biz.save()
        self.assertEqual(self.client.get(f"/api/receipts/{sale['receiptToken']}/").status_code, 404)

    def test_refunded_sale_keeps_its_receipt_marked_refunded(self):
        order = self.order()
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "delivered"}, format="json")
        self.client.post(f"/api/shipments/{order['id']}/status/", {"status": "returned"}, format="json")
        sale = self.client.get("/api/sales/").json()[0]
        r = self.client.get(f"/api/sales/{sale['id']}/receipt/").json()
        self.assertEqual(r["reference"], order["code"])
        self.assertIsNotNone(r["refundedAt"])

    def test_delivered_order_records_payment_cash_by_default(self):
        first = self.order()
        self.client.post(f"/api/shipments/{first['id']}/status/", {"status": "delivered"}, format="json")
        self.assertEqual(self.client.get("/api/sales/").json()[0]["paymentMethod"], "cash")
        second = self.order()
        # Card isn't turned on, and there's no online payment.
        for method in ("card", "online"):
            res = self.client.post(f"/api/shipments/{second['id']}/status/", {"status": "delivered", "paymentMethod": method}, format="json")
            self.assertEqual(res.status_code, 400)
        self.settings_with(card=True)
        self.client.post(f"/api/shipments/{second['id']}/status/", {"status": "delivered", "paymentMethod": "card"}, format="json")
        self.assertEqual(self.client.get("/api/sales/").json()[0]["paymentMethod"], "card")

    def test_rental_return_is_cash_by_default(self):
        rental = self.client.post(
            "/api/rentals/",
            {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "locationId": self.warehouse.id,
             "startDate": timezone.now().isoformat(), "plan": "daily", "rate": "100"},
            format="json",
        ).json()
        self.client.post(f"/api/rentals/{rental['id']}/return/")
        sale = self.client.get("/api/sales/").json()[0]
        self.assertEqual((sale["paymentMethod"], sale["receiptNo"]), ("cash", "R-000001"))


class CheckoutTests(PaymentsBase):
    """Several items on one bill: one discount, one payment, one receipt, each item still its own sale."""

    def setUp(self):
        super().setUp()
        self.radio = Product.objects.create(business=self.biz, sku="RD-1", name="Radio", price=100, cost=40)
        StockLevel.objects.create(business=self.biz, product=self.radio, location=self.warehouse, quantity=5)

    def cart(self, **body):
        items = [
            {"productId": self.product.id, "quantity": 2, "unitPrice": "500"},  # 1000
            {"productId": self.radio.id, "quantity": 3, "unitPrice": "100"},  # 300
        ]
        return self.sell(items=items, **body)

    def radio_qty(self):
        return StockLevel.objects.get(product=self.radio, location=self.warehouse).quantity

    def test_one_receipt_and_the_discount_shared_by_amount(self):
        res = self.cart(discount="130")
        self.assertEqual(res.status_code, 201, res.content)
        sales = res.json()["sales"]
        self.assertEqual([s["productName"] for s in sales], ["TV", "Radio"])
        self.assertEqual(len({s["receiptNo"] for s in sales} | {s["receiptToken"] for s in sales}), 2)  # one number, one token
        self.assertEqual([(s["discount"], s["revenue"], s["profit"]) for s in sales], [(100, 900, 300), (30, 270, 150)])
        self.assertEqual((self.qty(self.warehouse), self.radio_qty()), (8, 2))
        s = self.client.get("/api/sales/summary/").json()
        self.assertEqual((s["count"], s["revenue"], s["unitsSold"]), (2, 1170, 5))
        r = self.client.get(f"/api/sales/{sales[1]['id']}/receipt/").json()
        self.assertEqual((r["receiptNo"], len(r["items"]), r["subtotal"], r["discount"], r["total"]), ("R-000001", 2, 1300, 130, 1170))
        self.assertEqual(self.client.get(f"/api/receipts/{sales[0]['receiptToken']}/").json()["total"], 1170)
        self.assertEqual(self.sell(quantity=1).json()["receiptNo"], "R-000002")

    def test_discount_rounding_adds_up(self):
        items = [{"productId": self.radio.id, "quantity": 1, "unitPrice": "100"} for _ in range(3)]
        sales = self.sell(items=items, discount="10").json()["sales"]
        self.assertEqual(sum(s["discount"] for s in sales), 10)
        self.assertEqual(sorted(s["discount"] for s in sales), [3.33, 3.33, 3.34])

    def test_one_item_short_sells_nothing(self):
        items = [{"productId": self.product.id, "quantity": 1, "unitPrice": "500"}, {"productId": self.radio.id, "quantity": 6, "unitPrice": "100"}]
        self.assertEqual(self.sell(items=items).status_code, 400)
        self.assertEqual(self.cart(discount="1301").status_code, 400)
        self.assertEqual(self.sell(items=[]).status_code, 400)
        self.assertEqual((self.qty(self.warehouse), self.radio_qty()), (10, 5))
        self.assertEqual(self.client.get("/api/sales/").json(), [])



class ReturnTests(PaymentsBase):
    """Shop sales brought back: owners and admins return them, managers ask first."""

    def as_user(self, email):
        self.client.credentials()
        self.login(email)

    def test_owner_returns_a_cash_sale(self):
        sale = self.sell().json()
        self.assertEqual(self.qty(self.warehouse), 8)
        res = self.client.post(f"/api/sales/{sale['id']}/return/", {"reason": "Wrong size"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual((body["refundReason"], body["refundedBy"]), ("Wrong size", "owner@a.com"))
        self.assertIsNotNone(body["refundedAt"])
        self.assertEqual(self.qty(self.warehouse), 10)
        self.assertEqual(self.client.get("/api/sales/summary/").json()["revenue"], 0)
        self.assertEqual(self.client.post(f"/api/sales/{sale['id']}/return/", {}, format="json").status_code, 400)  # once

    def test_manager_asks_and_owner_decides(self):
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.warehouse])
        sale = self.sell().json()
        self.as_user("manager@a.com")
        self.assertEqual(self.client.post(f"/api/sales/{sale['id']}/return/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/sales/{sale['id']}/request-return/", {"reason": ""}, format="json").status_code, 400)
        asked = self.client.post(f"/api/sales/{sale['id']}/request-return/", {"reason": "Broken screen"}, format="json").json()
        self.assertEqual((asked["returnRequest"], asked["returnRequestedBy"]), ("requested", "manager@a.com"))
        self.assertEqual(self.client.post(f"/api/sales/{sale['id']}/decline-return/", {}, format="json").status_code, 403)
        self.assertEqual(self.qty(self.warehouse), 8)  # nothing moves until approved

        self.as_user("owner@a.com")
        waiting = self.client.get("/api/sales/?returns=requested").json()
        self.assertEqual([s["id"] for s in waiting], [sale["id"]])
        declined = self.client.post(f"/api/sales/{sale['id']}/decline-return/", {"note": "Used"}, format="json").json()
        self.assertEqual((declined["returnRequest"], declined["returnDeclineNote"], declined["refundedAt"]), ("declined", "Used", None))

        self.as_user("manager@a.com")
        self.client.post(f"/api/sales/{sale['id']}/request-return/", {"reason": "Customer insists"}, format="json")
        self.as_user("owner@a.com")
        approved = self.client.post(f"/api/sales/{sale['id']}/return/", {}, format="json").json()
        self.assertEqual((approved["returnRequest"], approved["refundReason"], approved["returnRequestedBy"]), ("", "Customer insists", "manager@a.com"))
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_staff_cannot_return_or_ask(self):
        self.staff.locations.set([self.warehouse])
        self.as_user("staff@a.com")
        sale = self.sell().json()
        for path in ("return", "request-return", "decline-return"):
            self.assertEqual(self.client.post(f"/api/sales/{sale['id']}/{path}/", {"reason": "x"}, format="json").status_code, 403, path)

    def test_search_by_receipt_number(self):
        first, second = self.sell().json(), self.sell(quantity=1).json()
        self.assertEqual((first["receiptNo"], second["receiptNo"]), ("R-000001", "R-000002"))
        for term in ("R-000002", "r2", " 2 ", "R 000002"):
            self.assertEqual([s["id"] for s in self.client.get("/api/sales/", {"search": term}).json()], [second["id"]], term)
        self.assertEqual(self.client.get("/api/sales/", {"search": "R-9"}).json(), [])
        self.assertEqual(self.client.get("/api/sales/", {"search": "TV"}).json(), [])



class ListingTests(ApiTestCase):
    """Pages, search and filters, so the app never has to load a whole list."""

    def setUp(self):
        super().setUp()
        self.login("owner@a.com")
        self.client_id = self.client.post("/api/clients/", {"name": "Rahim", "phone": "01711"}, format="json").json()["id"]

    def rent(self, days=None, start=None, location=None):
        body = {
            "productId": self.product.id, "quantity": 1, "clientId": self.client_id,
            "locationId": (location or self.warehouse).id, "startDate": (start or timezone.now()).isoformat(),
            "plan": "daily", "rate": "100",
        }
        if days:
            body["days"] = days
        res = self.client.post("/api/rentals/", body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def test_pages_only_when_asked_and_clamps_past_the_end(self):
        for i in range(3):
            Product.objects.create(business=self.biz, sku=f"P-{i}", name=f"Lamp {i}")
        self.assertIsInstance(self.client.get("/api/products/").json(), list)
        page = self.client.get("/api/products/", {"page": 1, "page_size": 2}).json()
        self.assertEqual((page["count"], page["page"], len(page["results"])), (4, 1, 2))
        last = self.client.get("/api/products/", {"page": 9, "page_size": 2}).json()
        self.assertEqual((last["page"], len(last["results"])), (2, 2))

    def test_products_carry_stock_at_the_users_locations(self):
        StockLevel.objects.create(business=self.biz, product=self.product, location=self.outlet, quantity=3)
        p = self.client.get(f"/api/products/{self.product.id}/").json()
        self.assertEqual(p["stock"], {str(self.warehouse.id): 10, str(self.outlet.id): 3})
        self.assertEqual(p["total"], 13)
        self.login("staff@a.com")
        p = self.client.get(f"/api/products/{self.product.id}/").json()
        self.assertEqual((p["stock"], p["total"]), ({str(self.outlet.id): 3}, 3))

    def test_product_search_and_stock_filters(self):
        lamp = Product.objects.create(business=self.biz, sku="LMP", name="Desk lamp", category="Lights", low_stock_threshold=5)
        StockLevel.objects.create(business=self.biz, product=lamp, location=self.outlet, quantity=2)
        names = lambda **q: [p["name"] for p in self.client.get("/api/products/", q).json()]
        self.assertEqual(names(search="desk"), ["Desk lamp"])
        self.assertEqual(names(search="lights"), ["Desk lamp"])
        self.assertEqual(names(code="lmp"), ["Desk lamp"])
        self.assertEqual(names(stock="low"), ["Desk lamp"])
        self.assertEqual(names(stock="in"), ["TV"])
        self.assertEqual(names(location=self.outlet.id, in_stock="1"), ["Desk lamp"])
        # The TV has no stock row at the outlet, so the outlet counts as empty.
        self.assertEqual(sorted(names(attention="1")), ["Desk lamp", "TV"])
        self.assertEqual(self.client.get("/api/products/categories/").json(), ["Lights"])

    def test_stock_summary(self):
        Product.objects.filter(pk=self.product.pk).update(cost=50)
        s = self.client.get("/api/stock/summary/").json()
        self.assertEqual((s["products"], s["units"], s["value"], s["low"], s["out"]), (1, 10, 500, 0, 0))
        self.assertEqual(s["locations"][0]["locationId"], str(self.warehouse.id))

    def test_overdue_rentals_and_summary(self):
        late = self.rent(days=2, start=timezone.now() - timedelta(days=5))
        self.rent(days=30)
        self.rent()
        rows = self.client.get("/api/rentals/", {"overdue": "1"}).json()
        self.assertEqual([r["id"] for r in rows], [late["id"]])
        self.assertEqual(rows[0]["client"]["name"], "Rahim")
        self.assertEqual(rows[0]["productName"], "TV")
        s = self.client.get("/api/rentals/summary/").json()
        self.assertEqual((s["active"], s["activeUnits"], s["overdue"]), (3, 3, 1))
        # Five days and a few seconds is six started days; the others are one day each. All at 100 a day.
        self.assertEqual(s["running"], 600 + 100 + 100)
        self.assertEqual(self.client.get("/api/rentals/", {"code": late["code"].lower()}).json()[0]["id"], late["id"])
        self.assertEqual(len(self.client.get("/api/rentals/", {"code": "123", "status": "active"}).json()), 3)

    def test_client_stats(self):
        self.rent(days=1, start=timezone.now() - timedelta(days=3))
        order = {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "fromLocationId": self.warehouse.id, "unitPrice": 700}
        self.client.post("/api/shipments/", order, format="json")
        delivered = self.client.post("/api/shipments/", order, format="json").json()
        for status_ in ("processing", "in_delivery", "delivered"):
            self.client.post(f"/api/shipments/{delivered['id']}/status/", {"status": status_}, format="json")
        stats = self.client.get("/api/clients/", {"stats": "1"}).json()[0]["stats"]
        self.assertEqual(stats, {"activeRentals": 1, "overdueRentals": 1, "openOrders": 1, "lifetimeValue": 700})
        self.assertNotIn("stats", self.client.get("/api/clients/").json()[0])

    def test_order_filters_and_counts(self):
        order = {"productId": self.product.id, "quantity": 1, "clientId": self.client_id, "fromLocationId": self.warehouse.id}
        first = self.client.post("/api/shipments/", order, format="json").json()
        self.client.post("/api/shipments/", order, format="json")
        self.client.post(f"/api/shipments/{first['id']}/status/", {"status": "cancelled"}, format="json")
        self.assertEqual(len(self.client.get("/api/shipments/", {"status": "open"}).json()), 1)
        self.assertEqual(len(self.client.get("/api/shipments/", {"search": "rahim"}).json()), 2)
        counts = {c["status"]: c["count"] for c in self.client.get("/api/shipments/counts/").json()}
        self.assertEqual((counts["pending"], counts["in_delivery"], counts["cancelled"]), (1, 0, 1))
        self.assertEqual(self.client.get("/api/shipments/", {"status": "lost"}).status_code, 400)

    def test_overview_and_badges(self):
        self.rent(days=1, start=timezone.now() - timedelta(days=3))
        Product.objects.create(business=self.biz, sku="X", name="Empty")
        o = self.client.get("/api/overview/").json()
        self.assertEqual((o["products"], o["units"], o["overdueRentals"], o["activeRentals"]), (2, 9, 1, 1))
        self.assertEqual(o["lowStock"][0]["productName"], "Empty")
        self.assertEqual(o["unitsByLocation"], {str(self.warehouse.id): 9})
        self.assertTrue(o["recentActivity"])
        self.assertEqual([s["status"] for s in o["ordersByStatus"]], ["pending", "processing", "in_delivery"])
        badges = self.client.get("/api/overview/", {"only": "badges"}).json()
        self.assertEqual(badges, {"overdueRentals": 1, "openOrders": 0, "waitingRequests": 0})

    def test_staff_see_only_their_own_activity(self):
        self.login("staff@a.com")
        self.assertEqual(self.client.get("/api/activity/").status_code, 403)
        self.client.post("/api/stock/adjust/", {"productId": self.product.id, "locationId": self.outlet.id, "delta": 2}, format="json")
        mine = self.client.get("/api/activity/", {"mine": "1", "action": ["Stock added", "Product added"]}).json()
        self.assertEqual([a["action"] for a in mine], ["Stock added"])
        self.assertEqual(self.client.get("/api/activity/people/").status_code, 403)

    def test_stock_request_filters(self):
        self.biz.settings["modules"]["transfers"] = True
        self.biz.save()
        ask = {"productId": self.product.id, "quantity": 2, "toLocationId": self.outlet.id}
        first = self.client.post("/api/stock-requests/", {**ask, "note": "for the weekend"}, format="json").json()
        self.client.post("/api/stock-requests/", ask, format="json")
        self.client.post(f"/api/stock-requests/{first['id']}/decline/", {}, format="json")
        rows = self.client.get("/api/stock-requests/").json()
        self.assertEqual([r["status"] for r in rows], ["pending", "declined"])  # waiting first
        self.assertEqual(len(self.client.get("/api/stock-requests/", {"status": "declined"}).json()), 1)
        self.assertEqual(len(self.client.get("/api/stock-requests/", {"search": "weekend"}).json()), 1)
        self.assertEqual(len(self.client.get("/api/stock-requests/", {"location": self.warehouse.id}).json()), 0)
        self.assertEqual(self.client.get("/api/stock-requests/", {"status": "lost"}).status_code, 400)


class PurchaseBase(SalesBase):
    def setUp(self):
        super().setUp()
        self.supplier_id = self.client.post("/api/suppliers/", {"name": "Rahim Traders", "phone": "01711"}, format="json").json()["id"]

    def buy(self, items=None, **body):
        item = {"productId": self.product.id, "quantity": 10, "unitCost": "360"}
        item.update({k: body.pop(k) for k in list(body) if k in item})
        data = {"supplierId": self.supplier_id, "locationId": self.warehouse.id, "items": [item] if items is None else items, **body}
        return self.client.post("/api/purchases/", data, format="json")


class PurchaseTests(PurchaseBase):
    """Stock bought from suppliers: stock goes up, cost is averaged, managers need the owner's switch."""

    def test_purchase_adds_stock_and_averages_the_cost(self):
        # 10 on hand at 300, 10 more at 360: cost 330.
        res = self.buy(reference=" INV-77 ")
        self.assertEqual(res.status_code, 201, res.content)
        p = res.json()
        self.assertEqual((p["code"], p["reference"], p["total"], p["supplier"]["name"]), ("P-000001", "INV-77", 3600, "Rahim Traders"))
        item = {k: v for k, v in p["items"][0].items() if k != "id"}
        self.assertEqual(item, {"productId": str(self.product.id), "productName": "TV", "quantity": 10, "unitCost": 360, "amount": 3600, "returned": 0})
        self.assertEqual(self.qty(self.warehouse), 20)
        self.product.refresh_from_db()
        self.assertEqual(self.product.cost, 330)
        # Sales from now on carry the new cost.
        self.assertEqual(self.sell(quantity=1, unitPrice="500").json()["cost"], 330)
        self.assertEqual(self.buy(quantity=1).json()["code"], "P-000002")

    def test_cost_is_what_was_paid_when_nothing_is_on_hand(self):
        radio = Product.objects.create(business=self.biz, sku="RD", name="Radio", cost=999)
        self.buy(items=[{"productId": radio.id, "quantity": 4, "unitCost": "40"}], supplierId=None)
        radio.refresh_from_db()
        self.assertEqual(radio.cost, 40)
        self.assertEqual(StockLevel.objects.get(product=radio, location=self.warehouse).quantity, 4)

    def test_bad_purchases_change_nothing(self):
        self.assertEqual(self.buy(items=[]).status_code, 400)
        self.assertEqual(self.buy(quantity=0).status_code, 400)
        self.assertEqual(self.buy(unitCost="-1").status_code, 400)
        self.assertEqual(self.buy(purchasedAt=(timezone.now() + timedelta(days=2)).isoformat()).status_code, 400)
        foreign = Supplier.objects.create(business=self.other_biz, name="Theirs")
        self.assertEqual(self.buy(supplierId=foreign.id).status_code, 400)
        self.assertEqual(self.qty(self.warehouse), 10)
        self.assertEqual(self.client.get("/api/purchases/").json(), [])

    def test_list_filters_search_and_summary(self):
        self.buy(reference="INV-1")
        self.buy(quantity=2, supplierId=None, purchasedAt=(timezone.now() - timedelta(days=3)).isoformat())
        self.assertEqual([p["code"] for p in self.client.get("/api/purchases/").json()], ["P-000001", "P-000002"])  # newest bought first
        for term in ("P-000002", "p2", "2"):
            self.assertEqual([p["code"] for p in self.client.get("/api/purchases/", {"search": term}).json()], ["P-000002"], term)
        self.assertEqual(len(self.client.get("/api/purchases/", {"search": "rahim"}).json()), 1)
        self.assertEqual(len(self.client.get("/api/purchases/", {"supplier": self.supplier_id}).json()), 1)
        self.assertEqual(len(self.client.get("/api/purchases/", {"product": self.product.id}).json()), 2)
        self.assertEqual(self.client.get("/api/purchases/summary/").json(), {"count": 2, "total": 4320.0, "due": 0.0})
        stats = self.client.get("/api/suppliers/", {"stats": "1"}).json()[0]["stats"]
        self.assertEqual((stats["purchaseCount"], stats["spent"]), (1, 3600.0))

    def test_supplier_with_purchases_cannot_be_deleted(self):
        self.buy()
        self.assertEqual(self.client.delete(f"/api/suppliers/{self.supplier_id}/").status_code, 400)
        spare = self.client.post("/api/suppliers/", {"name": "Spare"}, format="json").json()["id"]
        self.assertEqual(self.client.delete(f"/api/suppliers/{spare}/").status_code, 204)

    def test_deleting_the_product_keeps_the_purchase(self):
        self.buy()
        StockLevel.objects.filter(product=self.product).delete()
        self.assertEqual(self.client.delete(f"/api/products/{self.product.id}/").status_code, 204)
        item = self.client.get("/api/purchases/").json()[0]["items"][0]
        self.assertEqual((item["productId"], item["productName"]), (None, "TV"))

    def test_managers_need_the_switch_and_only_buy_for_their_shops(self):
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.outlet])
        self.buy()  # the owner's, at the warehouse
        self.client.credentials()
        self.login("manager@a.com")
        self.assertEqual(self.client.get("/api/purchases/").status_code, 403)
        self.assertEqual(self.client.get("/api/suppliers/").status_code, 403)
        self.biz.settings["permissions"]["managerPurchases"] = True
        self.biz.save()
        self.assertEqual(self.client.get("/api/purchases/").json(), [])  # not their location
        self.assertEqual(self.buy().status_code, 403)
        self.assertEqual(self.buy(locationId=self.outlet.id).status_code, 201)
        self.assertEqual(len(self.client.get("/api/purchases/").json()), 1)

    def test_staff_cannot_buy(self):
        self.client.credentials()
        self.login("staff@a.com")
        self.assertEqual(self.buy(locationId=self.outlet.id).status_code, 403)
        self.assertEqual(self.client.get("/api/suppliers/").status_code, 403)


class NewProductOnPurchaseTests(PurchaseBase):
    """A business with nothing set up yet adds products as it buys them."""

    def test_new_products_are_created_with_the_purchase(self):
        items = [
            {"newProduct": {"name": "Rice 5kg", "unit": "bag", "price": "450", "barcode": "4001"}, "quantity": 20, "unitCost": "380"},
            {"newProduct": {"name": "Lentils", "category": "Grocery"}, "quantity": 5, "unitCost": "120"},
        ]
        res = self.buy(items=items)
        self.assertEqual(res.status_code, 201, res.content)
        rice = Product.objects.get(business=self.biz, barcode="4001")
        self.assertEqual((rice.name, rice.unit, rice.price, rice.cost, rice.created_by), ("Rice 5kg", "bag", 450, 380, self.owner))
        self.assertEqual(StockLevel.objects.get(product=rice, location=self.warehouse).quantity, 20)
        lentils = Product.objects.get(business=self.biz, name="Lentils")
        self.assertRegex(lentils.sku, r"^GRO-\d{4}$")
        self.assertEqual([i["productName"] for i in res.json()["items"]], ["Rice 5kg", "Lentils"])

    def test_a_refused_purchase_creates_no_products(self):
        items = [
            {"newProduct": {"name": "Rice 5kg"}, "quantity": 1, "unitCost": "380"},
            {"productId": self.product.id, "quantity": 1, "unitCost": "380"},
        ]
        self.assertEqual(self.buy(items=items, locationId=999999).status_code, 400)
        taken = [{"newProduct": {"name": "Copy", "barcode": "123"}, "quantity": 1, "unitCost": "1"}]  # the TV's barcode
        self.assertEqual(self.buy(items=taken).status_code, 400)
        twice = [{"newProduct": {"name": n, "barcode": "777"}, "quantity": 1, "unitCost": "1"} for n in ("One", "Two")]
        self.assertEqual(self.buy(items=twice).status_code, 400)
        both = [{"productId": self.product.id, "newProduct": {"name": "X"}, "quantity": 1, "unitCost": "1"}]
        self.assertEqual(self.buy(items=both).status_code, 400)
        self.assertEqual(Product.objects.filter(business=self.biz).count(), 1)

    def test_managers_also_need_the_products_switch(self):
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.outlet])
        self.biz.settings["permissions"].update(managerPurchases=True, managerProducts=False)
        self.biz.save()
        self.client.credentials()
        self.login("manager@a.com")
        new = [{"newProduct": {"name": "Rice"}, "quantity": 1, "unitCost": "1"}]
        self.assertEqual(self.buy(items=new, locationId=self.outlet.id).status_code, 403)
        self.assertEqual(self.buy(locationId=self.outlet.id).status_code, 201)


class SupplierReturnTests(PurchaseBase):
    """Broken stock goes back: it leaves stock at once, and the supplier replaces it or refunds."""

    def setUp(self):
        super().setUp()
        self.purchase = self.buy().json()  # 10 TVs at 360, warehouse now has 20
        self.item_id = self.purchase["items"][0]["id"]

    def send_back(self, quantity=5, reason="Broken screen"):
        return self.client.post("/api/supplier-returns/", {"itemId": self.item_id, "quantity": quantity, "reason": reason}, format="json")

    def test_return_takes_stock_out_and_shows_what_is_owed(self):
        res = self.send_back()
        self.assertEqual(res.status_code, 201, res.content)
        r = res.json()
        self.assertEqual((r["code"], r["purchaseCode"], r["supplier"]["name"], r["status"]), ("SR-000001", "P-000001", "Rahim Traders", "open"))
        self.assertEqual((r["value"], r["outstanding"], r["unitsToReplace"]), (1800, 1800, 5))
        self.assertEqual(self.qty(self.warehouse), 15)
        self.product.refresh_from_db()
        self.assertEqual(self.product.cost, 330)  # cost left alone
        self.assertEqual(self.client.get("/api/purchases/").json()[0]["items"][0]["returned"], 5)
        self.assertEqual(self.client.get("/api/supplier-returns/summary/").json(), {"openCount": 1, "owed": 1800.0})
        self.assertEqual(self.client.get("/api/suppliers/", {"stats": "1"}).json()[0]["stats"]["owedBack"], 1800.0)

    def test_cannot_return_more_than_was_bought_or_without_a_reason(self):
        self.assertEqual(self.send_back(reason=" ").status_code, 400)
        self.assertEqual(self.send_back(quantity=11).status_code, 400)
        self.send_back(quantity=8)
        self.assertEqual(self.send_back(quantity=3).status_code, 400)  # only 2 left on that purchase
        self.assertEqual(self.send_back(quantity=2).status_code, 201)
        self.assertEqual(self.qty(self.warehouse), 10)

    def test_replacement_and_refund_settle_it(self):
        ret = self.send_back().json()
        url = f"/api/supplier-returns/{ret['id']}"
        r = self.client.post(f"{url}/replacement/", {"quantity": 3}, format="json").json()
        self.assertEqual((r["replacedQuantity"], r["outstanding"], r["status"]), (3, 720, "open"))
        self.assertEqual(self.qty(self.warehouse), 18)
        self.assertEqual(self.client.post(f"{url}/refund/", {"amount": "800", "method": "cash"}, format="json").status_code, 400)  # owes 720
        self.assertEqual(self.client.post(f"{url}/replacement/", {"quantity": 3}, format="json").status_code, 400)  # owes 2
        r = self.client.post(f"{url}/refund/", {"amount": "720", "method": "mobile"}, format="json").json()
        self.assertEqual((r["refundedAmount"], r["refundMethod"], r["outstanding"], r["status"]), (720, "mobile", 0, "settled"))
        self.assertIsNotNone(r["finishedAt"])
        self.assertEqual(self.client.post(f"{url}/refund/", {"amount": "1", "method": "cash"}, format="json").status_code, 400)
        self.assertEqual(self.client.get("/api/supplier-returns/", {"status": "open"}).json(), [])

    def test_full_replacement_settles_it(self):
        ret = self.send_back(quantity=2).json()
        r = self.client.post(f"/api/supplier-returns/{ret['id']}/replacement/", {"quantity": 2}, format="json").json()
        self.assertEqual(r["status"], "settled")
        self.assertEqual(self.qty(self.warehouse), 20)

    def test_only_owners_close_a_return_unsettled(self):
        ret = self.send_back().json()
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.warehouse])
        self.biz.settings["permissions"]["managerPurchases"] = True
        self.biz.save()
        self.client.credentials()
        self.login("manager@a.com")
        self.assertEqual(self.client.post(f"/api/supplier-returns/{ret['id']}/close/", {}, format="json").status_code, 403)
        self.client.credentials()
        self.login("owner@a.com")
        r = self.client.post(f"/api/supplier-returns/{ret['id']}/close/", {"note": "Supplier refused"}, format="json").json()
        self.assertEqual((r["status"], r["closedNote"]), ("closed", "Supplier refused"))
        self.assertEqual(self.client.get("/api/supplier-returns/summary/").json()["openCount"], 0)

    def test_search_and_other_business_items(self):
        self.send_back()
        for term in ("SR-000001", "sr1", "broken", "TV", "rahim"):
            self.assertEqual(len(self.client.get("/api/supplier-returns/", {"search": term}).json()), 1, term)
        other = Product.objects.create(business=self.other_biz, sku="X", name="X")
        theirs = Purchase.objects.create(business=self.other_biz, number=1)
        item = PurchaseItem.objects.create(purchase=theirs, product=other, product_name="X", quantity=5, unit_cost=1)
        res = self.client.post("/api/supplier-returns/", {"itemId": item.id, "quantity": 1, "reason": "x"}, format="json")
        self.assertEqual(res.status_code, 400)


class SupplierPaymentTests(PurchaseBase):
    """Buying on credit and paying later: payments go to the oldest bills first."""

    def pay(self, amount, **body):
        data = {"supplierId": self.supplier_id, "amount": str(amount), "method": "cash", **body}
        return self.client.post("/api/supplier-payments/", data, format="json")

    def owed(self):
        return self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").json()["owed"]

    def test_paid_in_full_unless_told_otherwise(self):
        p = self.buy().json()
        self.assertEqual((p["total"], p["paidAmount"], p["due"], p["paymentStatus"]), (3600, 3600, 0, "paid"))
        self.assertEqual(self.owed(), 0)
        self.assertEqual(self.pay(1).status_code, 400)  # nothing owed

    def test_credit_purchases_and_oldest_first_payments(self):
        old = self.buy(paidAmount="1000", dueDate=(timezone.localdate() - timedelta(days=1)).isoformat(),
                       purchasedAt=(timezone.now() - timedelta(days=5)).isoformat()).json()
        new = self.buy(quantity=2, paidAmount="0").json()  # 720 on credit
        self.assertEqual((old["due"], old["paymentStatus"], new["due"], new["paymentStatus"]), (2600, "partly_paid", 720, "unpaid"))
        statement = self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").json()
        self.assertEqual((statement["owed"], statement["overdue"]), (3320, 2600))
        self.assertEqual(self.client.get("/api/supplier-payments/summary/").json(), {"owed": 3320.0, "overdue": 2600.0, "supplierCount": 1})
        self.assertEqual([p["code"] for p in self.client.get("/api/purchases/", {"payment": "overdue"}).json()], [old["code"]])
        self.assertEqual(self.client.get("/api/suppliers/", {"stats": "1"}).json()[0]["stats"]["owed"], 3320.0)

        self.assertEqual(self.pay(5000).status_code, 400)  # more than owed
        res = self.pay(3000, method="mobile", note="bKash")
        self.assertEqual(res.status_code, 201, res.content)
        allocations = [(a["purchaseCode"], a["amount"]) for a in res.json()["allocations"]]
        self.assertEqual(allocations, [(old["code"], 2600), (new["code"], 400)])
        self.assertEqual(self.owed(), 320)
        rows = {p["code"]: p for p in self.client.get("/api/purchases/").json()}
        self.assertEqual((rows[old["code"]]["paymentStatus"], rows[new["code"]]["due"]), ("paid", 320))

        # The statement runs oldest to newest: bill, its payment, bill, payment.
        entries = self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").json()["entries"][::-1]
        self.assertEqual([(e["kind"], e["balance"]) for e in entries], [("purchase", 3600), ("payment", 2600), ("purchase", 3320), ("payment", 320)])

        # A payment made by mistake: deleting it makes the bills owed again.
        self.assertEqual(self.client.delete(f"/api/supplier-payments/{res.json()['id']}/").status_code, 204)
        self.assertEqual(self.owed(), 3320)

    def test_credit_needs_a_supplier_and_no_more_than_the_bill(self):
        self.assertEqual(self.buy(paidAmount="0", supplierId=None).status_code, 400)
        self.assertEqual(self.buy(paidAmount="4000").status_code, 400)
        self.assertEqual(self.client.get("/api/purchases/").json(), [])

    def test_a_return_can_come_off_what_is_owed(self):
        p = self.buy(paidAmount="0").json()  # owe 3600
        ret = self.client.post("/api/supplier-returns/", {"itemId": p["items"][0]["id"], "quantity": 2, "reason": "Broken"}, format="json").json()
        r = self.client.post(f"/api/supplier-returns/{ret['id']}/credit/", {"amount": "720"}, format="json").json()
        self.assertEqual((r["creditedAmount"], r["outstanding"], r["status"]), (720, 0, "settled"))
        self.assertEqual(self.owed(), 2880)
        credit = self.client.get("/api/supplier-payments/").json()[0]
        self.assertEqual((credit["method"], credit["returnCode"], credit["amount"]), ("credit", "SR-000001", 720))
        self.assertEqual(self.client.delete(f"/api/supplier-payments/{credit['id']}/").status_code, 400)

    def test_only_owners_handle_payments(self):
        self.buy(paidAmount="0")
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.warehouse])
        self.biz.settings["permissions"]["managerPurchases"] = True
        self.biz.save()
        self.client.credentials()
        self.login("manager@a.com")
        self.assertEqual(self.client.get("/api/supplier-payments/").status_code, 403)
        self.assertEqual(self.pay(100).status_code, 403)
        self.assertEqual(self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").status_code, 403)
        self.assertNotIn("owed", self.client.get("/api/suppliers/", {"stats": "1"}).json()[0]["stats"])
        # They still buy on credit at their shops, and see what each bill owes.
        res = self.buy(quantity=1, paidAmount="100")
        self.assertEqual((res.status_code, res.json()["due"]), (201, 260))


class PurchaseEdgeTests(PurchaseBase):
    """The awkward cases around returns and payments."""

    def setUp(self):
        super().setUp()
        self.purchase = self.buy(paidAmount="0").json()  # 10 TVs at 360 on credit; warehouse has 20
        self.item_id = self.purchase["items"][0]["id"]

    def send_back(self, quantity=5):
        return self.client.post("/api/supplier-returns/", {"itemId": self.item_id, "quantity": quantity, "reason": "Broken"}, format="json")

    def test_cannot_return_stock_that_is_no_longer_there(self):
        StockLevel.objects.filter(product=self.product, location=self.warehouse).update(quantity=3)  # most of it was sold
        self.assertEqual(self.send_back(5).status_code, 400)
        self.assertEqual(self.client.get("/api/supplier-returns/").json(), [])
        self.assertEqual(self.qty(self.warehouse), 3)

    def test_a_deleted_product_can_still_be_refunded_but_not_replaced(self):
        ret = self.send_back(2).json()
        StockLevel.objects.filter(product=self.product).delete()
        self.assertEqual(self.client.delete(f"/api/products/{self.product.id}/").status_code, 204)
        url = f"/api/supplier-returns/{ret['id']}"
        self.assertEqual(self.client.post(f"{url}/replacement/", {"quantity": 1}, format="json").status_code, 400)
        r = self.client.post(f"{url}/refund/", {"amount": "720", "method": "bank"}, format="json").json()
        self.assertEqual((r["status"], r["productName"]), ("settled", "TV"))

    def test_managers_only_see_returns_from_their_shops(self):
        ret = self.send_back().json()  # at the warehouse
        manager = self.make_user("manager@a.com", User.Role.MANAGER, self.biz)
        manager.locations.set([self.outlet])
        self.biz.settings["permissions"]["managerPurchases"] = True
        self.biz.save()
        self.client.credentials()
        self.login("manager@a.com")
        self.assertEqual(self.client.get("/api/supplier-returns/").json(), [])
        self.assertEqual(self.client.get(f"/api/supplier-returns/{ret['id']}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/supplier-returns/{ret['id']}/refund/", {"amount": "1", "method": "cash"}, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/supplier-returns/summary/").json(), {"openCount": 0, "owed": 0.0})

    def test_bad_payments_are_refused(self):
        pay = lambda **body: self.client.post("/api/supplier-payments/", {"supplierId": self.supplier_id, "amount": "100", "method": "cash", **body}, format="json")  # noqa: E731
        self.assertEqual(pay(paidAt=(timezone.now() + timedelta(days=1)).isoformat()).status_code, 400)
        self.assertEqual(pay(method="credit").status_code, 400)  # only returns make credits
        self.assertEqual(pay(amount="0").status_code, 400)
        theirs = Supplier.objects.create(business=self.other_biz, name="Theirs")
        self.assertEqual(pay(supplierId=theirs.id).status_code, 400)
        self.assertEqual(self.client.get(f"/api/suppliers/{theirs.id}/statement/").status_code, 404)
        self.assertEqual(self.client.get("/api/supplier-payments/").json(), [])
        self.assertEqual(self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").json()["owed"], 3600)

    def test_due_date_only_kept_while_something_is_owed(self):
        due = (timezone.localdate() + timedelta(days=7)).isoformat()
        self.assertIsNone(self.buy(quantity=1, dueDate=due).json()["dueDate"])  # paid in full
        self.assertEqual(self.buy(quantity=1, paidAmount="100", dueDate=due).json()["dueDate"], due)
        self.assertEqual(self.buy(quantity=1, paidAmount="0", supplierId=self.supplier_id, paymentMethod="credit").status_code, 400)

    def test_a_partly_refunded_return_can_be_credited_for_the_rest(self):
        ret = self.send_back(5).json()  # 1800 owed back; business owes 3600 - 1800 credit later
        url = f"/api/supplier-returns/{ret['id']}"
        self.client.post(f"{url}/refund/", {"amount": "800", "method": "cash"}, format="json")
        self.assertEqual(self.client.post(f"{url}/credit/", {"amount": "1001"}, format="json").status_code, 400)  # only 1000 left
        r = self.client.post(f"{url}/credit/", {"amount": "1000"}, format="json").json()
        self.assertEqual((r["refundedAmount"], r["creditedAmount"], r["status"]), (800, 1000, "settled"))
        self.assertEqual(self.client.get(f"/api/suppliers/{self.supplier_id}/statement/").json()["owed"], 2600)

    def test_super_admin_can_delete_a_business_with_purchases(self):
        ret = self.send_back(2).json()
        self.client.post(f"/api/supplier-returns/{ret['id']}/credit/", {"amount": "720"}, format="json")
        self.client.post("/api/supplier-payments/", {"supplierId": self.supplier_id, "amount": "100", "method": "cash"}, format="json")
        # A supplier you've bought from still can't be deleted on its own.
        self.assertEqual(self.client.delete(f"/api/suppliers/{self.supplier_id}/").status_code, 400)
        User.objects.create_superuser(email="root@x.com", password=PASSWORD, name="Root")
        self.client.credentials()
        self.login("root@x.com")
        self.assertEqual(self.client.delete(f"/api/platform/businesses/{self.biz.id}/").status_code, 204)
        self.assertFalse(Business.objects.filter(pk=self.biz.pk).exists())
        self.assertFalse(Purchase.objects.exists() or Supplier.objects.exists())
