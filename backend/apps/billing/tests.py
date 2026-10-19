from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Business, User

from .models import Payment, PaymentAccounts

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


class ManualPaymentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.biz = Business.objects.create(name="Locked Co", trial_ends_at=timezone.now() - timedelta(days=1))
        User.objects.create_user(email="owner@x.com", password=PASSWORD, name="Owner", role="owner", business=self.biz)
        User.objects.create_user(email="staff@x.com", password=PASSWORD, name="Staff", role="staff", business=self.biz)
        User.objects.create_superuser(email="admin@x.com", password=PASSWORD, name="Admin")
        PaymentAccounts.objects.create(pk=1, bkash="01711111111", bank_account_number="1234567")

    def login(self, email):
        res = self.client.post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")

    def send(self, **fields):
        self.login("owner@x.com")
        body = {"method": "bkash", "months": 1, "reference": "9AB3CD7EF1", "sentFrom": "01700000000", **fields}
        return self.client.post("/api/billing/manual/", body, format="json")

    def test_sent_payment_waits_then_approval_unlocks(self):
        res = self.send(months=3)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.json()["status"], res.json()["amount"], res.json()["method"]), ("awaiting", 3000, "bKash"))
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "unpaid")

        self.login("admin@x.com")
        res = self.client.post(f"/api/platform/payments/{res.json()['id']}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["status"], "paid")
        self.assertTrue(res.json()["invoiceNo"].startswith("INV-"))
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "active")
        self.assertGreater(self.biz.paid_until, timezone.now() + timedelta(days=88))

    def test_approve_only_once(self):
        payment_id = self.send().json()["id"]
        self.login("admin@x.com")
        self.client.post(f"/api/platform/payments/{payment_id}/approve/", {}, format="json")
        self.biz.refresh_from_db()
        paid_until = self.biz.paid_until
        self.assertEqual(self.client.post(f"/api/platform/payments/{payment_id}/approve/", {}, format="json").status_code, 400)
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.paid_until, paid_until)

    def test_reject_keeps_it_locked_and_frees_the_reference(self):
        payment_id = self.send().json()["id"]
        self.assertEqual(self.send().status_code, 400)  # same TrxID twice
        self.login("admin@x.com")
        res = self.client.post(f"/api/platform/payments/{payment_id}/reject/", {"note": "Not received"}, format="json")
        self.assertEqual((res.json()["status"], res.json()["note"]), ("rejected", "Not received"))
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "unpaid")
        self.assertEqual(self.send().status_code, 201)

    def test_only_owner_sends_and_only_super_admin_approves(self):
        self.login("staff@x.com")
        self.assertEqual(self.client.post("/api/billing/manual/", {"method": "bkash", "months": 1, "reference": "X1"}, format="json").status_code, 403)
        payment_id = self.send().json()["id"]
        self.assertEqual(self.client.post(f"/api/platform/payments/{payment_id}/approve/", {}, format="json").status_code, 403)

    def test_odd_months_refused(self):
        self.assertEqual(self.send(months=2).status_code, 400)

    def test_super_admin_gives_months(self):
        self.login("admin@x.com")
        res = self.client.post(
            f"/api/platform/businesses/{self.biz.id}/grant/",
            {"months": 2, "amount": 2000, "method": "bank", "reference": "DBBL-778", "note": "Called on WhatsApp"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.json()["status"], res.json()["method"], res.json()["payer"]["email"]), ("paid", "Bank transfer", "owner@x.com"))
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.status, "active")

    def test_free_months_cost_nothing(self):
        self.login("admin@x.com")
        res = self.client.post(f"/api/platform/businesses/{self.biz.id}/grant/", {"months": 1, "amount": 1000, "method": "free"}, format="json")
        self.assertEqual(res.json()["amount"], 0)

    @override_settings(SSLCOMMERZ_STORE_ID="", SSLCOMMERZ_STORE_PASSWORD="", DEBUG=False, PAYMENTS_TEST_GATEWAY=False)
    def test_owner_sees_only_what_is_on_and_filled_in(self):
        self.login("admin@x.com")
        res = self.client.put(
            "/api/platform/payment-accounts/",
            {"nagad": "01811111111", "nagadKind": "agent", "bankName": "DBBL", "bankEnabled": False, "contact": "01911111111"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["onlineStatus"], "missing")
        self.login("owner@x.com")
        self.assertFalse(self.client.get("/api/billing/config/").json()["online"])
        options = self.client.get("/api/billing/config/").json()["options"]
        self.assertEqual([(w["id"], w["kind"]) for w in options["wallets"]], [("bkash", "personal"), ("nagad", "agent")])
        self.assertIsNone(options["bank"])
        self.assertEqual(options["contact"], "01911111111")
        self.assertEqual(self.client.put("/api/platform/payment-accounts/", {"bkash": "0"}, format="json").status_code, 403)

    def test_switched_off_methods_are_refused(self):
        self.assertEqual(self.send(method="nagad").status_code, 400)  # no number set
        PaymentAccounts.objects.filter(pk=1).update(mobile_enabled=False)
        self.assertEqual(self.send(method="bkash").status_code, 400)
        self.assertEqual(self.send(method="bank", reference="BANK-1").status_code, 201)

    @override_settings(SSLCOMMERZ_STORE_ID="", SSLCOMMERZ_STORE_PASSWORD="", DEBUG=True)
    def test_online_switched_off(self):
        self.login("owner@x.com")
        self.assertTrue(self.client.get("/api/billing/config/").json()["online"])
        PaymentAccounts.objects.filter(pk=1).update(online_enabled=False)
        self.assertFalse(self.client.get("/api/billing/config/").json()["online"])
        self.assertEqual(self.client.post("/api/billing/checkout/", {}, format="json").status_code, 400)
