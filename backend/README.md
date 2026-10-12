# Friday Inventory — backend

Django + Django REST Framework API for the Next.js app in `../frontend`.
Login uses JWT (SimpleJWT). There is no sign-up: the super admin creates
businesses and their owners, and owners and managers create the other users.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # set DJANGO_SECRET_KEY and JWT_SIGNING_KEY
python manage.py migrate
python manage.py seed_demo        # demo businesses and logins (or: createsuperuser)
python manage.py runserver        # http://localhost:8000
```

`JWT_SIGNING_KEY` must be the same in `backend/.env` and `frontend/.env.local`: the Next.js
proxy uses it to check login tokens. `python manage.py seed_demo --reset` puts the demo data
back to how it started.

Run the tests with `python manage.py test apps`.

## Layout

| Path | What it is |
| --- | --- |
| `config/` | Settings and root URLs |
| `apps/accounts/` | `Business` (tenant), `User` (role + locations), JWT login, role permissions |
| `apps/inventory/` | Locations, products, stock, clients, shipments, rentals, transfers, activity log |
| `apps/inventory/services.py` | Every stock-changing action, atomic and logged |
| `apps/billing/` | Subscription payments: checkout, SSLCommerz validation, invoices |
| `apps/api.py` | Shared serializer fields (ids go out as strings, like the frontend's types) |

JSON is camelCase on the wire, matching `frontend/src/lib/types.ts`.

## Roles

`superadmin` runs the platform (`/api/platform/…`) and has no tenant data access.
`owner` sees everything in their business. `manager` and `staff` are limited
to their assigned locations, and the owner's switches in business settings
(`modules`, `permissions`) turn features on and off for them, the same rules as
`frontend/src/lib/auth/roles.ts`. A business whose trial or paid month has run
out, or that is suspended, gets 403 on every tenant endpoint.

## Endpoints (all under `/api/`)

| Endpoint | Who |
| --- | --- |
| `POST auth/login/` · `auth/refresh/` · `auth/logout/` · `GET auth/me/` | everyone |
| `GET/PATCH business/` | owner |
| `users/` | owner; managers manage staff when allowed |
| `locations/`, `products/` (`?code=` for scanner lookup), `stock/`, `POST stock/adjust/` | owner, manager, staff |
| `clients/`, `activity/` | owner, manager |
| `shipments/` + `POST {id}/status/` | owner, manager (tracking module) |
| `rentals/` + `POST {id}/return/` | owner, manager (rentals module) |
| `transfers/` + `POST {id}/receive/` · `{id}/cancel/` | owner, manager (transfers module) |
| `GET billing/payments/` · `POST billing/checkout/` | owner (even while locked) |
| `GET billing/payments/{id}/` | that business's owner, super admin (invoices) |
| `POST billing/sslcommerz/{result}/` | public; the frontend forwards SSLCommerz's callbacks, Django validates them |
| `platform/businesses/` + `POST {id}/suspend/`, `DELETE`, `platform/payments/`, `POST platform/users/{id}/password/` | super admin |
