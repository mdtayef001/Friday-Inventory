from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import Business, User

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
