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

| Role    | Email              | Password   | Can do |
|---------|--------------------|------------|--------|
| Admin   | admin@friday.app   | admin123   | Everything, all locations, all accounts |
| Manager | manager@friday.app | manager123 | Their outlets (Downtown, Uptown) + creating staff for them |
| Staff   | staff@friday.app   | staff123   | Quick Entry only (scan / add products and stock) |

## Features

- **Login only, no sign-up.** Admins create any account; managers create staff for their own shops.
- **Role-based access**: every route is checked in `src/proxy.ts`, again in each page (`requireRole`), and in every server action.
- **Products**: add, edit or delete products; SKU auto-generated; QR label printing; per-product stock by location.
- **Quick Entry**: scan with the camera (QR, EAN, UPC, Code 128…), type a code or use a USB scanner, or add by hand. Unknown codes open a pre-filled new-product form.
- **Stock levels**: product × location grid; click any number to add or remove stock with a reason.
- **Warehouses & shops**: what's at each location; managers only see their assigned ones.
- **Transfers** between locations (in transit → received / cancelled).
- **Order tracking**: pending → processing → in delivery → delivered, plus returned or cancelled (restocked), with a history timeline.
- **Rentals**: client, days, per day / week / month or fixed price, deposit; total worked out automatically; overdue alerts.
- **Clients**, **dashboard**, **activity log**, global search (Ctrl K) and dark mode.

## Where things live

| Path | What |
|------|------|
| `src/proxy.ts` | Route guard (runs before every page) |
| `src/lib/auth/` | Session cookie (signed JWT, httpOnly), password hashing, login, user management |
| `src/lib/auth/roles.ts` | Which role can open which route |
| `src/lib/store/` | All inventory data + mutations (Zustand, saved to localStorage) and demo seed data |
| `src/lib/types.ts` | Data shapes (to mirror in Django serializers) |
| `src/app/(app)/*` | One folder per page: `page.tsx` checks the role, `view.tsx` is the UI |

## Limits of this test version

- Inventory data lives in each browser's localStorage, so different browsers don't share it.
  Admins can use **Reset demo data** in the user menu.
- Accounts created in the app are kept in server memory and reset when the server restarts.
- Both are replaced by the Django REST backend in the next phase: swap `src/lib/store/index.ts`
  and `src/lib/auth/users.ts` for API calls.
