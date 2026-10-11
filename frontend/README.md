# Friday Inventory: frontend

Inventory management web app built with Next.js 16, TypeScript, Tailwind CSS and shadcn/ui.
This is the **frontend test version**: data is kept in the browser, and accounts are kept in
server memory until the Django REST backend is built.

## Run it

```bash
npm install
cp .env.example .env.local   # then put a long random string in SESSION_SECRET
npm run dev                  # http://localhost:3000
```

Demo accounts (also listed on the login page in development):

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
- Every business's data is kept separate. Accounts can never see or manage another business.

## SSLCommerz setup

1. Register a free sandbox store at https://developer.sslcommerz.com/registration/
2. Put the store ID and password in `.env.local` (see `.env.example`) and restart the server.
3. For IPN (SSLCommerz's server-to-server confirmation) the site must be reachable from the internet;
   set `APP_URL` to its public address. The return URLs work on localhost too.

Without keys, development uses a built-in **test gateway** (`/pay/test/...`) that behaves like SSLCommerz,
so the whole flow can be tried. It is switched off in production.

A payment is only marked paid after the server checks it with SSLCommerz's validation API (status, amount,
currency and transaction id must match), so a faked callback can't unlock a business.

## Features

- **Login only, no sign-up.** The super admin creates businesses; owners create their team; managers create staff if allowed.
- **Role-based access**: every route is checked in `src/proxy.ts`, again in each page (`requireAccess`, which also
  applies the owner's feature switches and permissions) and in every server action.
## Where things live

| Path | What |
|------|------|
| `src/proxy.ts` | Route guard (runs before every page) |
| `src/lib/auth/` | Session cookie (signed JWT, httpOnly), password hashing, login, user management |
| `src/lib/auth/roles.ts` | Which role can open which route, plus feature and permission rules |
| `src/lib/auth/tenants.ts` | Businesses (in memory for now) |
| `src/lib/business.ts` | Subscription price, features and permission definitions |
| `src/app/(platform)/` | Super admin console |
| `src/lib/billing/` | Payments store, SSLCommerz client, start-payment action |
| `src/app/api/payments/sslcommerz/` | SSLCommerz success / fail / cancel / IPN callbacks |
| `src/lib/store/` | All inventory data + mutations (Zustand, saved to localStorage) and demo seed data |
| `src/lib/types.ts` | Data shapes (to mirror in Django serializers) |
| `src/app/(app)/*` | One folder per page: `page.tsx` checks the role, `view.tsx` is the UI |

## Limits of this test version

- Inventory data lives in each browser's localStorage, so different browsers don't share it.
  Each business has its own saved data. Owners can use **Reset data** in the user menu.
- Businesses, accounts and payments are kept in server memory and reset when the server restarts.
- Both are replaced by the Django REST backend in the next phase: swap `src/lib/store/index.ts`
  `src/lib/auth/users.ts` and `src/lib/auth/tenants.ts` for API calls.
