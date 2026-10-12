"""SSLCommerz payment gateway (https://developer.sslcommerz.com).

Flow: init_payment() opens a session and returns the gateway URL the owner is
sent to. After paying, SSLCommerz posts the owner's browser back to the
frontend's /api/payments/sslcommerz/<result> route, which forwards the fields
here. Those posted fields are never trusted on their own: validate() asks
SSLCommerz directly whether the val_id is genuine and matches the payment.

With no store credentials set, development uses the frontend's built-in test
gateway at /pay/test so the flow can be tried without an account.
"""

import json
import logging
from decimal import Decimal
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from django.conf import settings

log = logging.getLogger(__name__)

TEST_VAL_PREFIX = "TEST-"


def _host():
    return "https://sandbox.sslcommerz.com" if settings.SSLCOMMERZ_SANDBOX else "https://securepay.sslcommerz.com"


def _credentials():
    if settings.SSLCOMMERZ_STORE_ID and settings.SSLCOMMERZ_STORE_PASSWORD:
        return settings.SSLCOMMERZ_STORE_ID, settings.SSLCOMMERZ_STORE_PASSWORD
    return None


def is_test_gateway():
    """True when payments go through the built-in test gateway instead of SSLCommerz."""
    return not _credentials() and (settings.DEBUG or settings.PAYMENTS_TEST_GATEWAY)


def init_payment(payment):
    """Returns (url, None) on success or (None, error message)."""
    frontend = settings.FRONTEND_URL.rstrip("/")
    creds = _credentials()
    if not creds:
        if not is_test_gateway():
            return None, "Online payment isn't configured yet. Please contact support."
        return f"{frontend}/pay/test/{payment.tran_id}", None

    store_id, store_password = creds
    callback = lambda result: f"{frontend}/api/payments/sslcommerz/{result}"  # noqa: E731
    body = urlencode(
        {
            "store_id": store_id,
            "store_passwd": store_password,
            "total_amount": f"{payment.amount:.2f}",
            "currency": payment.currency,
            "tran_id": payment.tran_id,
            "success_url": callback("success"),
            "fail_url": callback("fail"),
            "cancel_url": callback("cancel"),
            "ipn_url": callback("ipn"),
            "cus_name": payment.payer_name,
            "cus_email": payment.payer_email,
            # Required by SSLCommerz; the payer gives their number on its own page.
            "cus_phone": payment.payer_phone or "N/A",
            "cus_add1": payment.business.name,
            "cus_city": "Dhaka",
            "cus_country": "Bangladesh",
            "shipping_method": "NO",
            "num_of_item": "1",
            "product_name": "Friday Inventory monthly subscription",
            "product_category": "Software subscription",
            "product_profile": "non-physical-goods",
            "value_a": str(payment.business_id),
        }
    ).encode()
    try:
        with urlopen(f"{_host()}/gwprocess/v4/api.php", data=body, timeout=20) as res:
            data = json.load(res)
    except (URLError, ValueError) as err:
        log.error("SSLCommerz init error: %s", err)
        return None, "Couldn't reach the payment gateway. Check your connection and try again."
    if data.get("status") == "SUCCESS" and data.get("GatewayPageURL"):
        return data["GatewayPageURL"], None
    log.error("SSLCommerz init failed: %s", data.get("failedreason") or data.get("status"))
    return None, "The payment gateway couldn't start the payment. Please try again in a moment."


def validate(val_id, payment):
    """Ask SSLCommerz whether this val_id is a real, completed payment for this
    transaction. Returns (ok, method, bank_tran_id)."""
    creds = _credentials()
    if not creds:
        # Test gateway: accept only its own val_ids ("TEST-<method>-<random>"), never on a live site.
        ok = is_test_gateway() and val_id.startswith(TEST_VAL_PREFIX)
        if not ok:
            return False, "", ""
        method = val_id.split("-")[1] if val_id.count("-") >= 2 else "Test"
        return True, f"{method} (test)", f"TESTBANK{payment.pk}"

    store_id, store_password = creds
    query = urlencode({"val_id": val_id, "store_id": store_id, "store_passwd": store_password, "v": "1", "format": "json"})
    try:
        with urlopen(f"{_host()}/validator/api/validationserverAPI.php?{query}", timeout=20) as res:
            data = json.load(res)
    except (URLError, ValueError) as err:
        log.error("SSLCommerz validation error: %s", err)
        return False, "", ""
    try:
        amount_ok = Decimal(str(data.get("amount"))) == payment.amount
    except ArithmeticError:
        amount_ok = False
    ok = (
        data.get("status") in ("VALID", "VALIDATED")
        and data.get("tran_id") == payment.tran_id
        and amount_ok
        and data.get("currency_type") == payment.currency
    )
    if not ok:
        log.error("SSLCommerz validation rejected: %s %s %s", data.get("status"), data.get("tran_id"), data.get("amount"))
    card_type, issuer = data.get("card_type", ""), data.get("card_issuer", "")
    method = f"{card_type} · {issuer}" if issuer else card_type
    return ok, method or "SSLCommerz", data.get("bank_tran_id", "")
