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
cp .env.example .env              # then set DJANGO_SECRET_KEY
python manage.py migrate
python manage.py createsuperuser  # the platform super admin
python manage.py runserver        # http://localhost:8000
```

Run the tests with `python manage.py test apps`.

## Layout

| Path | What it is |
| --- | --- |
| `config/` | Settings and root URLs |
| `apps/accounts/` | `Business` (tenant), `User` (role + locations), JWT login, role permissions |
| `apps/inventory/` | Locations, products, stock, clients, shipments, rentals, transfers, activity log |
| `apps/inventory/services.py` | Every stock-changing action, atomic and logged |
| `apps/billing/` | `Payment` model for SSLCommerz (endpoints not built yet) |

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
| `platform/businesses/` + `POST {id}/suspend/` | super admin |
