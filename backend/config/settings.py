"""Django settings for the Friday inventory backend.

Values that differ between machines come from environment variables, loaded
from backend/.env in development (see .env.example).
"""

import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes")


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off.")
    SECRET_KEY = "dev-only-insecure-key"

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "apps.accounts",
    "apps.inventory",
    "apps.billing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# PostgreSQL (Supabase) when DATABASE_URL is set, otherwise SQLite for local development.
DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        # Keep connections open only under a production server: runserver starts a thread per
        # request, and each would hold its own connection until Supabase's pool runs out.
        conn_max_age=int(os.environ.get("DATABASE_CONN_MAX_AGE", "0")),
        conn_health_checks=True,
    )
}
if DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql":
    # Supabase's transaction pooler (port 6543, used on Vercel) hands each transaction to a
    # different server connection, which breaks prepared statements and server-side cursors.
    DATABASES["default"].setdefault("OPTIONS", {})["prepare_threshold"] = None
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True

# The login rate limit lives in the cache. On Vercel each function instance has its own memory,
# so with PostgreSQL keep it in a database table every instance shares (made by createcachetable).
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "django_cache"}
        if DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql"
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    )
}

# ---------- Email ----------
# Only for error reports to ADMINS. Any SMTP account (Gmail with an app password, Zoho,
# a provider like Brevo). Without EMAIL_HOST, emails are printed to the console instead.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_BACKEND = (
    "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_TIMEOUT = 15
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", EMAIL_HOST_USER or "Friday Inventory <noreply@localhost>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
# Who gets an email with the full error whenever something breaks on the live server.
ADMINS = [("Admin", e) for e in env_list("ADMIN_EMAILS", "")]

# Send warnings and errors (with tracebacks) to stdout, where Vercel's logs pick them up.
# Django's default only prints them while DEBUG is on. Server errors are also emailed to
# ADMINS when email is set up and DEBUG is off.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"live": {"()": "django.utils.log.RequireDebugFalse"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
        "mail_admins": {"class": "django.utils.log.AdminEmailHandler", "level": "ERROR", "filters": ["live"]},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "django.request": {"handlers": ["console", *(["mail_admins"] if EMAIL_HOST and ADMINS else [])], "level": "WARNING", "propagate": False},
    },
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Dhaka"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- API ----------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    # Every endpoint needs a logged-in user unless a view opts out.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # camelCase on the wire to match frontend/src/lib/types.ts, snake_case in Python.
    "DEFAULT_RENDERER_CLASSES": [
        "djangorestframework_camel_case.render.CamelCaseJSONRenderer",
        "djangorestframework_camel_case.render.CamelCaseBrowsableAPIRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "djangorestframework_camel_case.parser.CamelCaseJSONParser",
        "djangorestframework_camel_case.parser.CamelCaseFormParser",
        "djangorestframework_camel_case.parser.CamelCaseMultiPartParser",
    ],
    "JSON_UNDERSCOREIZE": {
        # Business settings keys are already camelCase; leave them alone.
        "ignore_fields": ("settings",),
    },
    # Lists come in pages when the caller asks with ?page= (see apps.api.Pagination).
    "DEFAULT_PAGINATION_CLASS": "apps.api.Pagination",
    # Money as JSON numbers, like the frontend's types.
    "COERCE_DECIMAL_TO_STRING": False,
    "DEFAULT_THROTTLE_RATES": {
        "login": "5/min",
    },
}

# Shared with the Next.js frontend (JWT_SIGNING_KEY in both .env files) so its
# proxy can verify access tokens without a round trip.
JWT_SIGNING_KEY = os.environ.get("JWT_SIGNING_KEY", "")
if len(JWT_SIGNING_KEY) < 32:
    raise RuntimeError("JWT_SIGNING_KEY must be set to at least 32 characters (see .env.example).")

SIMPLE_JWT = {
    "SIGNING_KEY": JWT_SIGNING_KEY,
    "ALGORITHM": "HS256",
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    # How long a login lasts. Not rotated: parallel requests refreshing at the
    # same moment would otherwise log each other out. Logout blacklists it.
    "REFRESH_TOKEN_LIFETIME": timedelta(hours=12),
    "ROTATE_REFRESH_TOKENS": False,
    "UPDATE_LAST_LOGIN": True,
}

# The Next.js app calls the API from its server, but allow the browser too.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_CONTENT_TYPE_NOSNIFF = True

# ---------- Billing ----------

# The monthly price and the free trial's length are set by the super admin on Payment options.
SUBSCRIPTION_CURRENCY = "BDT"

# Public address of the Next.js app; SSLCommerz sends owners back there.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
# Production only: allow the test gateway when no SSLCommerz keys are set. Never on a live site.
PAYMENTS_TEST_GATEWAY = env_bool("PAYMENTS_TEST_GATEWAY", False)

SSLCOMMERZ_STORE_ID = os.environ.get("SSLCOMMERZ_STORE_ID", "")
SSLCOMMERZ_STORE_PASSWORD = os.environ.get("SSLCOMMERZ_STORE_PASSWORD", "")
# Sandbox by default only while developing, so a live site never takes sandbox (unpaid) payments.
SSLCOMMERZ_SANDBOX = env_bool("SSLCOMMERZ_SANDBOX", DEBUG)

# Vercel Cron sends this as a Bearer token when calling /api/cron/cleanup/.
CRON_SECRET = os.environ.get("CRON_SECRET", "")
