"""SSLCommerz payment gateway (https://developer.sslcommerz.com).

Two kinds of account use it:
- the platform's own account (settings / .env), which collects subscriptions;
- each business's own account (MerchantAccount), for customers paying at the counter.

Flow: open_session() returns the gateway URL the payer is sent to. After paying,
SSLCommerz posts the browser back to the frontend, which forwards the fields to
Django. Those posted fields are never trusted on their own: check() asks
SSLCommerz directly whether the val_id is genuine and matches the payment.

With no platform credentials set, development uses the frontend's built-in test
gateway at /pay/test so the subscription flow can be tried without an account.
"""

import json
import logging
from dataclasses import dataclass
from decimal import Decimal
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from django.conf import settings

log = logging.getLogger(__name__)

TEST_VAL_PREFIX = "TEST-"


@dataclass
class Account:
    store_id: str
    password: str
    sandbox: bool

    @property
    def host(self):
        return "https://sandbox.sslcommerz.com" if self.sandbox else "https://securepay.sslcommerz.com"


def platform_account():
    if settings.SSLCOMMERZ_STORE_ID and settings.SSLCOMMERZ_STORE_PASSWORD:
        return Account(settings.SSLCOMMERZ_STORE_ID, settings.SSLCOMMERZ_STORE_PASSWORD, settings.SSLCOMMERZ_SANDBOX)
    return None


def merchant_account(business):
    """The business's own account, or None when it hasn't set one up."""
    merchant = getattr(business, "merchant", None)
    if not merchant:
        return None
    password = merchant.password
    return Account(merchant.store_id, password, merchant.sandbox) if password else None


def is_test_gateway():
    """True when subscriptions go through the built-in test gateway instead of SSLCommerz."""
    return not platform_account() and (settings.DEBUG or settings.PAYMENTS_TEST_GATEWAY)


def open_session(
    account, *, tran_id, amount, currency, callback_base, customer, product_name, product_category,
    product_profile="general", value_a="",
):
    """Starts a checkout. Returns (gateway url, None) or (None, error message)."""
    callback = lambda result: f"{callback_base}/{result}"  # noqa: E731
    body = urlencode(
        {
            "store_id": account.store_id,
            "store_passwd": account.password,
            "total_amount": f"{amount:.2f}",
            "currency": currency,
            "tran_id": tran_id,
            "success_url": callback("success"),
            "fail_url": callback("fail"),
            "cancel_url": callback("cancel"),
            "ipn_url": callback("ipn"),
            "cus_name": customer.get("name") or "Customer",
            "cus_email": customer.get("email") or "customer@example.com",
            # Required by SSLCommerz; the payer gives their number on its own page.
            "cus_phone": customer.get("phone") or "N/A",
            "cus_add1": customer.get("address") or "Dhaka",
            "cus_city": "Dhaka",
            "cus_country": "Bangladesh",
            "shipping_method": "NO",
            "num_of_item": "1",
            "product_name": product_name[:250],
            "product_category": product_category,
            "product_profile": product_profile,
            "value_a": value_a,
        }
    ).encode()
    try:
        with urlopen(f"{account.host}/gwprocess/v4/api.php", data=body, timeout=20) as res:
            data = json.load(res)
    except (URLError, ValueError) as err:
        log.error("SSLCommerz init error: %s", err)
        return None, "Couldn't reach the payment gateway. Check your connection and try again."
    if data.get("status") == "SUCCESS" and data.get("GatewayPageURL"):
        return data["GatewayPageURL"], None
    log.error("SSLCommerz init failed: %s", data.get("failedreason") or data.get("status"))
    reason = data.get("failedreason") or ""
    if "store" in reason.lower() or "credential" in reason.lower():
        return None, "SSLCommerz rejected the store ID or password. Check them in Business Settings."
    return None, "The payment gateway couldn't start the payment. Please try again in a moment."


def _query(account, **params):
    """One call to SSLCommerz's merchant API (transaction lookup and refunds share it). None if unreachable."""
    query = urlencode({**params, "store_id": account.store_id, "store_passwd": account.password, "v": "1", "format": "json"})
    try:
        with urlopen(f"{account.host}/validator/api/merchantTransIDvalidationAPI.php?{query}", timeout=20) as res:
            return json.load(res)
    except (URLError, ValueError) as err:
        log.error("SSLCommerz merchant API error: %s", err)
        return None


def lookup(account, tran_id):
    """What SSLCommerz has on record for our tran_id: the completed attempt if
    there is one, else the latest. None if unreachable, {} if it has nothing."""
    data = _query(account, tran_id=tran_id)
    if data is None:
        return None
    attempts = data.get("element") or []
    if not isinstance(attempts, list) or not attempts:
        return {}
    done = [a for a in attempts if a.get("status") in ("VALID", "VALIDATED")]
    return (done or attempts)[0]


def refund(account, *, bank_tran_id, amount, remarks, refe_id):
    """Asks SSLCommerz to send the money back. Returns (refund_ref_id, None) or (None, error)."""
    data = _query(account, bank_tran_id=bank_tran_id, refund_amount=f"{amount:.2f}", refund_remarks=remarks[:200], refe_id=refe_id)
    if data is None:
        return None, "Couldn't reach SSLCommerz. Check your connection and try again."
    if data.get("status") in ("success", "processing") and data.get("refund_ref_id"):
        return data["refund_ref_id"], None
    log.error("SSLCommerz refund refused: %s", data)
    return None, data.get("errorReason") or "SSLCommerz didn't accept the refund."


def refund_status(account, refund_ref_id):
    """"refunded", "processing" or "cancelled" for a refund we started, or None if unknown."""
    data = _query(account, refund_ref_id=refund_ref_id)
    status = (data or {}).get("status")
    return status if status in ("refunded", "processing", "cancelled") else None


def check(account, val_id, *, tran_id, amount, currency):
    """Asks SSLCommerz whether this val_id is a real, completed payment for this
    transaction. Returns (ok, method, bank_tran_id)."""
    query = urlencode({"val_id": val_id, "store_id": account.store_id, "store_passwd": account.password, "v": "1", "format": "json"})
    try:
        with urlopen(f"{account.host}/validator/api/validationserverAPI.php?{query}", timeout=20) as res:
            data = json.load(res)
    except (URLError, ValueError) as err:
        log.error("SSLCommerz validation error: %s", err)
        return False, "", ""
    try:
        amount_ok = Decimal(str(data.get("amount"))) == Decimal(amount)
    except ArithmeticError:
        amount_ok = False
    ok = data.get("status") in ("VALID", "VALIDATED") and data.get("tran_id") == tran_id and amount_ok and data.get("currency_type") == currency
    if not ok:
        log.error("SSLCommerz validation rejected: %s %s %s", data.get("status"), data.get("tran_id"), data.get("amount"))
    card_type, issuer = data.get("card_type", ""), data.get("card_issuer", "")
    method = f"{card_type} · {issuer}" if issuer else card_type
    return ok, method or "SSLCommerz", data.get("bank_tran_id", "")


# ---------- Subscriptions (the platform's account) ----------


def init_payment(payment):
    """Returns (url, None) on success or (None, error message)."""
    frontend = settings.FRONTEND_URL.rstrip("/")
    account = platform_account()
    if not account:
        if not is_test_gateway():
            return None, "Online payment isn't configured yet. Please contact support."
        return f"{frontend}/pay/test/{payment.tran_id}", None
    return open_session(
        account,
        tran_id=payment.tran_id,
        amount=payment.amount,
        currency=payment.currency,
        callback_base=f"{frontend}/api/payments/sslcommerz",
        customer={"name": payment.payer_name, "email": payment.payer_email, "phone": payment.payer_phone, "address": payment.business.name},
        product_name="Friday Inventory monthly subscription",
        product_category="Software subscription",
        product_profile="non-physical-goods",
        value_a=str(payment.business_id),
    )


def validate(val_id, payment):
    """Subscription payment check. Returns (ok, method, bank_tran_id)."""
    account = platform_account()
    if not account:
        # Test gateway: accept only its own val_ids ("TEST-<method>-<random>"), never on a live site.
        ok = is_test_gateway() and val_id.startswith(TEST_VAL_PREFIX)
        if not ok:
            return False, "", ""
        method = val_id.split("-")[1] if val_id.count("-") >= 2 else "Test"
        return True, f"{method} (test)", f"TESTBANK{payment.pk}"
    return check(account, val_id, tran_id=payment.tran_id, amount=payment.amount, currency=payment.currency)
