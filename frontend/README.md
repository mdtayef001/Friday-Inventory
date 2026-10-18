# Friday Inventory: frontend

Inventory management web app built with Next.js 16, TypeScript, Tailwind CSS and shadcn/ui.
All data, accounts and payments live in the Django REST backend in `../backend`.

## Run it

Start the backend first (see `../backend/README.md`), including `python manage.py seed_demo`
for the demo accounts below. Then:

```bash
npm install
cp .env.example .env.local   # set JWT_SIGNING_KEY to the same value as in backend/.env
npm run dev                  # http://localhost:3000
```

Demo accounts (created by `seed_demo`, also listed on the login page in development):

| Role        | Email              | Password   | Can do |
|-------------|--------------------|------------|--------|
| Super admin | super@friday.app   | super123   | Runs the platform: creates businesses and their owners, suspends and restores |
| Owner       | owner@friday.app   | owner123   | Everything inside Friday Demo Store, including Business Settings |
| Manager     | manager@friday.app | manager123 | Their outlets (Downtown, Uptown); extra rights set by the owner |
| Staff       | staff@friday.app   | staff123   | Quick Entry only (scan / add stock, new products if the owner allows) |
| Owner       | cafe@friday.app    | cafe1234   | Green Leaf Café: free trial ends in 2 days, so a reminder shows |
| Owner       | urban@friday.app   | urban123   | Urban Party Rentals: didn't pay, so it's locked and only the Subscribe page opens |

## How the SaaS works

- **Super admin** (`/platform`): sees every business, revenue by plan, adds a business together with its
  owner's login, suspends or restores access, resets the owner's password, deletes.
- **Subscription**: one plan, ৳1,000 per month, everything included. A new business gets a 7-day free trial.
  When the trial or a paid month runs out, the business locks itself: the owner can log in only to the
  **Subscribe** page and pay; managers and staff are told to ask the owner. Paying unlocks it at once.
  Paying early adds a month after the current end date, so no days are lost.
- **Payments** go through **SSLCommerz** (bKash, Nagad, Rocket, cards, net banking). Every paid payment gets an
  invoice number and a printable invoice (`/invoice/<id>`, print or save as PDF). Owners see their history on
  **Billing**; the super admin sees everyone's on **Payments** and on each business page.
- **Suspend / Restore access** by the super admin is separate: a suspended business can't log in at all,
  even if it pays, until it's restored.
- **Owner** (`/settings`): business name and currency, turns features on or off (rentals, order tracking,
  transfers) and decides what managers and staff may do. Creates owners, managers and staff.
- **Manager / staff**: work only at the locations they're assigned to, with what the owner allows.
- **Sales**: every sale freezes its selling price and cost at that moment, so price changes never rewrite
  past profit. Walk-in sales use **Sell** (product page, Quick Entry); a delivered order becomes a sale at the
  price agreed when it was placed (a return refunds it); a returned rental records its income. The **Sales**
  page (owners and managers) shows revenue, profit, margin and units sold for any period, shop, product, sale type
  or seller, a revenue and profit chart, top products, and **Export CSV** (opens in Excel). Only the owner sees
  cost and profit, unless they switch on "See cost and profit" for managers; managers see their own shops.
- **My Sales**: everyone (staff included) sees their own sales today and this month, with prices but never cost.
- **Per-person rights**: each staff account has **Can sell** and **Can add stock** switches on the Users page.
- **Rentals by scanning**: **Scan out** needs no day count (expected days are optional, for the due date only);
  **Scan in** counts the real days out, takes off holidays typed by staff (per-day plan only), and shows what to
  collect after the deposit. Staff can rent at their own shops if they may sell.
- **Stock requests**: a manager asks for stock (Transfers or the dashboard's low-stock list); the owner or a manager of
  the sending location approves and picks where it ships from, which creates the transfer.
- **Payment methods**: each business chooses in Business Settings: cash (always), mobile banking (staff enter the
  bKash / Nagad transaction ID) and card machine. Every sale records how it was paid. SSLCommerz is only used for the
  subscription the business pays to the platform.
- **Client tracking links**: every order has a public page, `/track/<token>`, that shows the client its status
  timeline and nothing internal (no prices, stock, notes or staff names). Staff share it from the order panel
  (Copy link, WhatsApp, Email). The owner can switch it off in Business Settings; links stop working 30 days after
  the order is finished, or while the business is locked.
- Every business's data is kept separate. Accounts can never see or manage another business.

## SSLCommerz setup

1. Register a free sandbox store at https://developer.sslcommerz.com/registration/
2. Put the store ID and password in `backend/.env` (see its `.env.example`) and restart Django.
3. For IPN (SSLCommerz's server-to-server confirmation) the site must be reachable from the internet;
   set `FRONTEND_URL` in `backend/.env` to its public address. The return URLs work on localhost too.

Without keys, development uses a built-in **test gateway** (`/pay/test/...`) that behaves like SSLCommerz,
so the whole flow can be tried. It is switched off in production.

SSLCommerz posts back to `/api/payments/sslcommerz/...` here, which passes the fields to Django. Django only
marks a payment paid after checking it with SSLCommerz's validation API (status, amount, currency and
transaction id must match), so a faked callback can't unlock a business.

## Features

- **Login only, no sign-up.** The super admin creates businesses; owners create their team; managers create staff if allowed.
- **Role-based access**: every route is checked in `src/proxy.ts`, again in each page (`requireAccess`, which also
  applies the owner's feature switches and permissions) and in every server action, and Django checks every API call.

## How it talks to the backend

- **Login**: the login action posts to Django, which returns JWT tokens. They're stored in httpOnly cookies
  (`friday_access`, 15 minutes; `friday_refresh`, 12 hours), so browser JavaScript never sees them.
- **`src/proxy.ts`** verifies the access token (shared `JWT_SIGNING_KEY`) for fast redirects, and swaps in a new
  one from the refresh token when it runs out.
- **Pages and server actions** call Django from the Next.js server (`src/lib/api/server.ts`). The DAL asks
  `/api/auth/me/` on every request, so disabling a user or suspending a business takes effect at once.
- **The browser** calls Django through `/api/backend/...` (`src/app/api/backend/`), which adds the token from the
  cookie, with a 15 second limit on the wait for Django.
- **Data in the browser** (`src/lib/data/`) uses TanStack Query. Lists come a page at a time (`?page=`), and the
  server does the searching, filtering and totals, so a business with thousands of products loads as fast as one
  with ten. After a change, `actions.ts` refreshes only the lists that change touched: lists on screen refetch now,
  others when they're next shown.

## Where things live

| Path | What |
|------|------|
| `src/proxy.ts` | Route guard (runs before every page) |
| `src/lib/api/` | Django API clients: `server.ts` (server side), `client.ts` (browser, via `/api/backend`) |
| `src/lib/auth/` | Token cookies, login, the DAL, user, settings and platform actions |
| `src/lib/auth/roles.ts` | Which role can open which route, plus feature and permission rules |
| `src/lib/business.ts` | Subscription price, features and permission definitions |
| `src/app/(platform)/` | Super admin console |
| `src/lib/billing/` | Start-payment action and payment queries |
| `src/app/api/payments/sslcommerz/` | SSLCommerz success / fail / cancel / IPN callbacks, forwarded to Django |
| `src/lib/data/` | Inventory reads (`queries.ts`, TanStack Query) and every change (`actions.ts`) |
| `src/lib/types.ts` | Data shapes; the Django serializers return exactly these |
| `src/app/(app)/*` | One folder per page: `page.tsx` checks the role, `view.tsx` is the UI |
