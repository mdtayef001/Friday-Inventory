# Next features

Ideas planned for later. Move an item out of this list when it's built.
Items 1–5 are in the order we plan to build them.

## 1. "My sales" for staff

A page where each staff member sees their own selling.

- Today and this month: number of sales, units sold, money taken.
- Their own list of sales, with prices only. Never cost or profit.
- Built on the existing Sales API (`sales/`, `sales/summary/`), filtered to the logged-in seller.

## 2. Per-person rights: who can sell, who can add stock

- Two switches on each staff account: **Can sell** and **Can add stock**.
- Set by the owner, or by a manager for staff at their own shops (when they may manage staff).
- Quick Entry and the product page only show the buttons that person may use; Django enforces it too.

## 3. Rentals by scanning out and in

Replace "type the number of days up front" with the real dates.

- **Scan out:** scan the item, pick the client, the plan (per day / week / month) and the deposit. It leaves stock
  and the clock starts at that moment.
- **Scan in:** scan the same item. The app finds its rental, counts the days it was out, works out the price,
  shows the amount due (minus the deposit) and puts it back in stock.
- **Price = the actual days out.** No early-return minimum and no late fee.
- **Holidays (per-day plan only):** at scan-in staff can enter a number of holiday days, typed by hand because
  holidays differ. They're taken off before pricing. Example: out 7 days, 1 holiday, per-day rate → charged for 6 days.
  Weekly and monthly plans ignore holidays and charge every started week or month, as today.
- The returned rental is recorded as rental income on the Sales page, as it already is.

## 4. Stock requests from shops to the main warehouse

- A manager presses **Request stock** (product, quantity, for which shop). The low-stock list offers it in one click.
- The owner, or whoever runs the warehouse, sees the open requests and **approves** or **declines** each one.
- Approving creates the transfer automatically; the shop presses **Receive** when it arrives, as transfers work today.
- Requests keep a history: who asked, who approved, when it arrived.

## 5. Payment methods for sales (each business chooses)

Every business decides how its customers can pay. **Cash only is fine**; everything else is optional.

- **Settings → Payment methods**, switched on per business:
  - **Cash** (always available).
  - **bKash / Nagad to our number** (staff confirm they received it).
  - **Card machine** (staff confirm).
  - **Online via SSLCommerz** using the business's **own** SSLCommerz account (their Store ID and password in
    Settings). Never the platform's account, which only collects subscriptions.
- Every sale records how it was paid. The Sales page can then show "cash in the drawer today" and totals per method.
- **Online payment at the counter:** staff press **Take payment**, the screen shows a QR code / link, the customer pays
  on their phone (bKash, Nagad, card). The sale is confirmed automatically only after SSLCommerz confirms the payment;
  until then it's pending and the stock is held. SSLCommerz charges its fee (about 1.5–2.5%) to the business.
- Store each business's SSLCommerz password encrypted, and only let the owner see or change it.

## Later: Checkout with several items

Scan several products into one cart, one discount on the whole bill, one payment, a printed receipt. Each item is
still its own sale (so profit keeps working), grouped under one receipt number. Fits well after item 5.

## Automatic SMS for order tracking

Send the client an SMS with their tracking link at the key moments of an order,
instead of staff sharing it by hand.

- **When:** order created, out for delivery, delivered (only these, to keep cost down).
- **Message:** short, with the order number and the `/track/<token>` link that already exists.
- **Provider:** a Bangladeshi SMS gateway such as SSL Wireless or BulkSMSBD (roughly ৳0.25–0.50 per SMS).
  Needs an account and API key in `backend/.env`.
- **Owner setting:** a switch in Business Settings, next to "Client tracking links", so each business decides.
- **Needs:** a valid client phone number; skip clients without one.
- **Built on:** Step 1 (tracking links, Copy / WhatsApp / Email buttons) is done.
