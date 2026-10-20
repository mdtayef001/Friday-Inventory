from datetime import timedelta
from io import StringIO

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.inventory.models import Location

from .models import Business, DeletedBusiness, User

PASSWORD = "a-long-test-password-1"


class AccountTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.biz = Business.objects.create(name="Shop")
        self.owner = User.objects.create_user(email="owner@x.com", password=PASSWORD, name="Owner", role="owner", business=self.biz)
        self.root = User.objects.create_superuser(email="root@x.com", password=PASSWORD, name="Root")

    def login(self, email):
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")

    def test_me_returns_user_and_business(self):
        self.login("owner@x.com")
        data = self.client.get("/api/auth/me/").json()
        self.assertEqual(data["user"]["id"], str(self.owner.id))
        self.assertEqual(data["business"]["status"], "trial")

    def test_disabled_user_is_logged_out_immediately(self):
        self.login("owner@x.com")
        self.owner.is_active = False
        self.owner.save()
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_login_limited_per_email(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"email": "owner@x.com", "password": "wrong"}, format="json")
        res = self.client.post("/api/auth/login/", {"email": "owner@x.com", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 429)
        # Other accounts are unaffected.
        self.assertEqual(self.client.post("/api/auth/login/", {"email": "root@x.com", "password": PASSWORD}, format="json").status_code, 200)

    def test_settings_shape_is_enforced(self):
        self.login("owner@x.com")
        res = self.client.patch("/api/business/", {"settings": {"currency": "XYZ"}}, format="json")
        self.assertEqual(res.status_code, 400)
        settings = {**self.biz.settings, "currency": "BDT"}
        res = self.client.patch("/api/business/", {"name": "Renamed", "settings": settings}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["settings"]["permissions"]["managerUsers"], True)

    def test_owner_cannot_change_own_account(self):
        self.login("owner@x.com")
        res = self.client.patch(f"/api/users/{self.owner.id}/", {"active": False}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_super_admin_creates_business_with_owner_and_first_shop(self):
        self.login("root@x.com")
        res = self.client.post(
            "/api/platform/businesses/",
            {"name": "New Co", "industry": "", "ownerName": "Nia", "ownerEmail": "nia@x.com", "ownerPassword": PASSWORD},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["owner"]["email"], "nia@x.com")
        detail = self.client.get(f"/api/platform/businesses/{res.json()['id']}/").json()
        self.assertEqual(len(detail["users"]), 1)

    def test_new_business_gets_the_trial_set_by_the_super_admin_or_none(self):
        from apps.billing.models import PaymentAccounts

        accounts = PaymentAccounts.load()
        accounts.trial_days = 14
        accounts.save()
        self.login("root@x.com")
        body = {"name": "New Co", "ownerName": "Nia", "ownerPassword": PASSWORD}
        trial = self.client.post("/api/platform/businesses/", {**body, "ownerEmail": "nia@x.com"}, format="json").json()
        self.assertEqual(trial["status"], "trial")
        self.assertEqual(Business.objects.get(pk=trial["id"]).access_ends_at.date(), (timezone.now() + timedelta(days=14)).date())
        none = self.client.post("/api/platform/businesses/", {**body, "ownerEmail": "tia@x.com", "freeTrial": False}, format="json").json()
        self.assertEqual(none["status"], "unpaid")

    def test_super_admin_resets_password_and_deletes_business(self):
        self.login("root@x.com")
        res = self.client.post(f"/api/platform/users/{self.owner.id}/password/", {"password": "another-long-pass-9"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(self.client.delete(f"/api/platform/businesses/{self.biz.id}/").status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.owner.pk).exists())

    def test_tenant_users_cannot_use_platform(self):
        self.login("owner@x.com")
        self.assertEqual(self.client.get("/api/platform/businesses/").status_code, 403)
        self.assertEqual(self.client.get("/api/platform/payments/").status_code, 404)


@override_settings(CRON_SECRET="a-cron-secret")
class CronCleanupTests(APITestCase):
    def test_needs_the_secret(self):
        self.assertEqual(self.client.get("/api/cron/cleanup/").status_code, 404)
        self.assertEqual(self.client.get("/api/cron/cleanup/", HTTP_AUTHORIZATION="Bearer wrong").status_code, 404)

    @override_settings(CRON_SECRET="")
    def test_off_without_a_secret(self):
        self.assertEqual(self.client.get("/api/cron/cleanup/", HTTP_AUTHORIZATION="Bearer ").status_code, 404)

    def test_deletes_expired_tokens(self):
        user = User.objects.create_user(email="old@x.com", password=PASSWORD, name="Old", role="superadmin")
        now = timezone.now()
        OutstandingToken.objects.create(user=user, jti="old", token="t1", created_at=now - timedelta(days=2), expires_at=now - timedelta(days=1))
        OutstandingToken.objects.create(user=user, jti="new", token="t2", created_at=now, expires_at=now + timedelta(hours=1))
        res = self.client.get("/api/cron/cleanup/", HTTP_AUTHORIZATION="Bearer a-cron-secret")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(list(OutstandingToken.objects.values_list("jti", flat=True)), ["new"])


class EditAccountTests(APITestCase):
    """Changing someone's role, locations, name or email without recreating the account."""

    def setUp(self):
        cache.clear()
        self.biz = Business.objects.create(name="Shop")
        self.owner = User.objects.create_user(email="owner@x.com", password=PASSWORD, name="Owner", role="owner", business=self.biz)
        self.shop_a = Location.objects.create(business=self.biz, name="A", type="outlet")
        self.shop_b = Location.objects.create(business=self.biz, name="B", type="outlet")
        self.manager = User.objects.create_user(email="m@x.com", password=PASSWORD, name="Manager", role="manager", business=self.biz)
        self.manager.locations.set([self.shop_a])
        self.staff = User.objects.create_user(email="s@x.com", password=PASSWORD, name="Staff", role="staff", business=self.biz)
        self.staff.locations.set([self.shop_a, self.shop_b])

    def login(self, email):
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")

    def edit(self, user, **body):
        return self.client.patch(f"/api/users/{user.id}/", body, format="json")

    def test_owner_promotes_staff_and_moves_them(self):
        self.login("owner@x.com")
        res = self.edit(self.staff, name="Sam Staff", email="SAM@x.com", role="manager", locationIds=[str(self.shop_b.id)])
        self.assertEqual(res.status_code, 200, res.content)
        self.staff.refresh_from_db()
        self.assertEqual((self.staff.name, self.staff.email, self.staff.role), ("Sam Staff", "sam@x.com", "manager"))
        self.assertEqual(list(self.staff.locations.all()), [self.shop_b])

    def test_owner_promotes_to_owner_and_locations_are_dropped(self):
        self.login("owner@x.com")
        self.assertEqual(self.edit(self.manager, role="owner").status_code, 200)
        self.assertFalse(self.manager.locations.exists())

    def test_everyone_but_owners_needs_a_location(self):
        self.login("owner@x.com")
        self.assertEqual(self.edit(self.staff, locationIds=[]).status_code, 400)
        owner2 = User.objects.create_user(email="o2@x.com", password=PASSWORD, name="O2", role="owner", business=self.biz)
        self.assertEqual(self.edit(owner2, role="staff").status_code, 400)  # a demoted owner needs somewhere to work
        self.assertEqual(self.edit(owner2, role="staff", locationIds=[str(self.shop_a.id)]).status_code, 200)

    def test_email_must_stay_unique(self):
        self.login("owner@x.com")
        self.assertEqual(self.edit(self.staff, email="m@x.com").status_code, 400)

    def test_manager_edits_staff_but_cannot_promote_or_hand_out_other_shops(self):
        self.biz.settings["permissions"]["managerUsers"] = True
        self.biz.save()
        self.login("m@x.com")
        self.assertEqual(self.edit(self.staff, role="manager").status_code, 400)
        # Keeping shop B, which the staff member already works at, is fine; adding it to someone new isn't.
        self.assertEqual(self.edit(self.staff, name="Renamed", locationIds=[str(self.shop_a.id), str(self.shop_b.id)]).status_code, 200)
        other = User.objects.create_user(email="s2@x.com", password=PASSWORD, name="S2", role="staff", business=self.biz)
        other.locations.set([self.shop_a])
        self.assertEqual(self.edit(other, locationIds=[str(self.shop_a.id), str(self.shop_b.id)]).status_code, 400)
        self.assertEqual(self.edit(self.owner, name="Hacked").status_code, 404)  # managers only see their staff

    def test_only_the_owner_manages_admins(self):
        admin = User.objects.create_user(email="a@x.com", password=PASSWORD, name="Admin", role="owner", business=self.biz)
        admin2 = User.objects.create_user(email="a2@x.com", password=PASSWORD, name="Admin 2", role="owner", business=self.biz)
        self.assertTrue(self.owner.is_main_owner)
        self.assertFalse(admin.is_main_owner)

        self.login("a@x.com")
        me = self.client.get("/api/auth/me/").json()["user"]
        self.assertFalse(me["isMainOwner"])
        # An admin runs managers and staff...
        self.assertEqual(self.edit(self.staff, name="Fine").status_code, 200)
        # ...but can't touch the owner or other admins, or make new admins.
        self.assertEqual(self.edit(self.owner, name="Hacked").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/users/{self.owner.id}/").status_code, 403)
        self.assertEqual(self.edit(admin2, role="staff", locationIds=[str(self.shop_a.id)]).status_code, 403)
        self.assertEqual(self.edit(self.staff, role="owner").status_code, 400)
        new = {"name": "New", "email": "n@x.com", "password": PASSWORD, "role": "owner"}
        self.assertEqual(self.client.post("/api/users/", new, format="json").status_code, 400)

        self.login("owner@x.com")
        self.assertEqual(self.edit(admin2, role="manager", locationIds=[str(self.shop_a.id)]).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/users/{admin.id}/").status_code, 204)


class SeedDemoTests(APITestCase):
    """The demo data loads, logs in, and can be loaded again."""

    def test_seed_and_reset(self):
        from django.core.management import call_command

        from apps.inventory.models import Purchase, Supplier, SupplierPayment

        call_command("seed_demo", stdout=StringIO())
        demo = Business.objects.get(name="Friday Demo Store")
        self.assertEqual(Supplier.objects.filter(business=demo).count(), 3)
        bills = {p.code: p for p in Purchase.objects.filter(business=demo)}
        self.assertEqual({c: p.payment_status for c, p in bills.items()},
                         {"P-000001": "paid", "P-000002": "partly_paid", "P-000003": "paid", "P-000004": "unpaid"})
        self.assertLess(bills["P-000004"].due_date, timezone.localdate())  # overdue on purpose
        for p in bills.values():
            self.assertEqual(p.total, sum(i.amount for i in p.items.all()))
            self.assertEqual(p.paid_amount, sum(a.amount for a in p.allocations.all()))
        self.assertEqual(SupplierPayment.objects.filter(business=demo).count(), 3)
        res = self.client.post("/api/auth/login/", {"email": "owner@friday.app", "password": "owner123"}, format="json")
        self.assertEqual(res.status_code, 200)

        call_command("seed_demo", stdout=StringIO())  # already there: left alone
        self.assertEqual(Business.objects.filter(name="Friday Demo Store").count(), 1)
        call_command("seed_demo", "--reset", stdout=StringIO())
        self.assertEqual(Business.objects.filter(name="Friday Demo Store").count(), 1)
        self.assertEqual(Purchase.objects.filter(business__name="Friday Demo Store").count(), 4)


@override_settings(CRON_SECRET="a-cron-secret")
class LeavingTests(APITestCase):
    """Owners can cancel the subscription, take their data, and ask for the business to be deleted."""

    def setUp(self):
        cache.clear()
        self.biz = Business.objects.create(name="Shop")
        self.owner = User.objects.create_user(email="owner@x.com", password=PASSWORD, name="Owner", role="owner", business=self.biz)
        User.objects.create_user(email="admin@x.com", password=PASSWORD, name="Admin", role="owner", business=self.biz)
        User.objects.create_user(email="staff@x.com", password=PASSWORD, name="Staff", role="staff", business=self.biz)
        User.objects.create_superuser(email="root@x.com", password=PASSWORD, name="Root")

    def login(self, email):
        self.client.credentials()
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")

    def test_cancel_and_resume_the_subscription(self):
        self.login("owner@x.com")
        res = self.client.post("/api/business/subscription/", {"cancelled": True}, format="json")
        self.assertIsNotNone(res.json()["cancelledAt"])
        self.assertEqual(res.json()["status"], "trial")  # keeps what's left
        self.assertEqual(self.client.post("/api/business/subscription/", {"cancelled": "yes"}, format="json").status_code, 400)
        self.assertIsNone(self.client.post("/api/business/subscription/", {"cancelled": False}, format="json").json()["cancelledAt"])
        self.login("staff@x.com")
        self.assertEqual(self.client.post("/api/business/subscription/", {"cancelled": True}, format="json").status_code, 403)

    def test_paying_again_undoes_a_cancel(self):
        self.biz.cancelled_at = timezone.now()
        self.biz.save()
        self.login("root@x.com")
        res = self.client.post(f"/api/platform/businesses/{self.biz.id}/grant/", {"months": 1, "amount": "0", "method": "free"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.biz.refresh_from_db()
        self.assertIsNone(self.biz.cancelled_at)

    def test_data_download_once_every_ten_minutes(self):
        self.login("owner@x.com")
        self.assertEqual(self.client.get("/api/business/export/").status_code, 200)
        res = self.client.get("/api/business/export/")
        self.assertEqual(res.status_code, 429)
        self.assertIn("10 minutes", res.json()["detail"])

    def test_deletion_asked_approved_and_done_after_30_days(self):
        self.login("admin@x.com")
        self.assertEqual(self.client.post("/api/business/deletion/", {"name": "Shop"}, format="json").status_code, 403)  # only the Owner
        self.login("owner@x.com")
        self.assertEqual(self.client.post("/api/business/deletion/", {"name": "Shops"}, format="json").status_code, 400)
        res = self.client.post("/api/business/deletion/", {"name": " shop "}, format="json")
        self.assertEqual((res.json()["deletionRequestedBy"], res.json()["status"]), ("Owner", "trial"))  # nothing locks until approved

        self.login("root@x.com")
        res = self.client.post(f"/api/platform/businesses/{self.biz.id}/approve-deletion/", format="json")
        self.assertEqual(res.json()["status"], "closing")
        # Locked for the team, but the owner can still take the data and change their mind.
        self.login("staff@x.com")
        self.assertEqual(self.client.get("/api/products/").status_code, 403)
        self.login("owner@x.com")
        self.assertEqual(self.client.get("/api/business/export/").status_code, 200)
        self.assertEqual(self.client.post("/api/billing/manual/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.delete("/api/business/deletion/").json()["status"], "trial")

        # Asked and approved again; the daily job deletes it once the 30 days are up.
        self.client.post("/api/business/deletion/", {"name": "Shop"}, format="json")
        self.login("root@x.com")
        self.client.post(f"/api/platform/businesses/{self.biz.id}/approve-deletion/", format="json")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer a-cron-secret")  # as Vercel Cron calls it
        cron = lambda: self.client.get("/api/cron/cleanup/")  # noqa: E731
        cron()
        self.assertTrue(Business.objects.filter(pk=self.biz.pk).exists())
        Business.objects.filter(pk=self.biz.pk).update(deletion_approved_at=timezone.now() - timedelta(days=30, minutes=1))
        self.assertEqual(cron().status_code, 204)
        self.assertFalse(Business.objects.filter(pk=self.biz.pk).exists())
        self.assertFalse(User.objects.filter(email="owner@x.com").exists())
        record = DeletedBusiness.objects.get()
        self.assertEqual((record.name, record.owner_email, record.requested_by), ("Shop", "owner@x.com", "owner@x.com"))

    def test_super_admin_turns_down_a_request(self):
        self.login("owner@x.com")
        self.client.post("/api/business/deletion/", {"name": "Shop"}, format="json")
        self.login("root@x.com")
        res = self.client.post(f"/api/platform/businesses/{self.biz.id}/stop-deletion/", format="json")
        self.assertIsNone(res.json()["deletionRequestedAt"])
        self.assertEqual(self.client.post(f"/api/platform/businesses/{self.biz.id}/approve-deletion/", format="json").status_code, 400)

