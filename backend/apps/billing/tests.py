from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User

from .models import Payment

PASSWORD = "a-long-test-password-1"


@override_settings(SSLCOMMERZ_STORE_ID="", SSLCOMMERZ_STORE_PASSWORD="", DEBUG=True)
class TestGatewayPaymentTests(APITestCase):
    def setUp(self):
        cache.clear()
        # Trial over, never paid: locked.
        self.biz = Business.objects.create(name="Locked Co", trial_ends_at=timezone.now() - timedelta(days=1))
        User.objects.create_user(email="owner@x.com", password=PASSWORD, name="Owner", role="owner", business=self.biz)
        res = self.client.post("/api/auth/login/", {"email": "owner@x.com", "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")

    def checkout(self):
        res = self.client.post("/api/billing/checkout/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()["url"].rsplit("/", 1)[1]

    def gateway(self, result, **fields):
        return self.client.post(f"/api/billing/sslcommerz/{result}/", fields, format="json").json()["status"]

    def test_locked_owner_can_pay_and_unlocks(self):
        self.assertEqual(self.client.get("/api/products/").status_code, 403)
        tran = self.checkout()
        self.assertEqual(self.gateway("success", tranId=tran, valId="TEST-bKash-1"), "success")
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "active")
        payment = Payment.objects.get(tran_id=tran)
        self.assertEqual((payment.status, payment.method), ("paid", "bKash (test)"))
        self.assertTrue(payment.invoice_no.startswith("INV-"))
        self.assertEqual(self.client.get("/api/products/").status_code, 200)

    def test_forged_val_id_is_rejected(self):
        tran = self.checkout()
        self.assertEqual(self.gateway("success", tranId=tran, valId="FAKE"), "failed")
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "unpaid")

    def test_success_and_ipn_only_count_once(self):
        tran = self.checkout()
        self.gateway("success", tranId=tran, valId="TEST-bKash-1")
        self.biz.refresh_from_db()
        paid_until = self.biz.paid_until
        self.assertEqual(self.gateway("ipn", tranId=tran, valId="TEST-bKash-1"), "success")
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.paid_until, paid_until)

    def test_early_renewal_keeps_remaining_days(self):
        self.biz.paid_until = timezone.now() + timedelta(days=10)
        self.biz.save()
        tran = self.checkout()
        self.gateway("success", tranId=tran, valId="TEST-Nagad-1")
        self.biz.refresh_from_db()
        self.assertGreater(self.biz.paid_until, timezone.now() + timedelta(days=38))

    def test_cancel_marks_cancelled(self):
        tran = self.checkout()
        self.assertEqual(self.gateway("cancel", tranId=tran), "cancelled")
        self.assertEqual(Payment.objects.get(tran_id=tran).status, "cancelled")

    def test_invoice_hidden_from_other_businesses(self):
        tran = self.checkout()
        self.gateway("success", tranId=tran, valId="TEST-bKash-1")
        payment_id = Payment.objects.get(tran_id=tran).id
        other = Business.objects.create(name="Other")
        User.objects.create_user(email="o2@x.com", password=PASSWORD, name="O2", role="owner", business=other)
        res = self.client.post("/api/auth/login/", {"email": "o2@x.com", "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")
        self.assertEqual(self.client.get(f"/api/billing/payments/{payment_id}/").status_code, 404)


@override_settings(SSLCOMMERZ_STORE_ID="", SSLCOMMERZ_STORE_PASSWORD="", DEBUG=False, PAYMENTS_TEST_GATEWAY=False)
class LiveWithoutKeysTests(APITestCase):
    def test_test_gateway_is_off_in_production(self):
        biz = Business.objects.create(name="B")
        payment = Payment.objects.create(tran_id="T1", business=biz, amount=1000, payer_name="a", payer_email="a@x.com", payer_phone="0")
        res = self.client.post("/api/billing/sslcommerz/success/", {"tranId": payment.tran_id, "valId": "TEST-bKash-1"}, format="json")
        self.assertEqual(res.json()["status"], "failed")
        self.assertEqual(self.client.get("/api/billing/test-gateway/T1/").status_code, 404)
