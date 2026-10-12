"""Encrypts secrets kept in the database (a business's SSLCommerz password).

The key comes from FIELD_ENCRYPTION_KEY, or is derived from DJANGO_SECRET_KEY when
that isn't set. Changing the key makes stored secrets unreadable, and the owner
has to enter them again.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet():
    key = settings.FIELD_ENCRYPTION_KEY or base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""
