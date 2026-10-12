# Next features

Ideas planned for later. Move an item out of this list when it's built.

## Checkout with several items

Scan several products into one cart, one discount on the whole bill, one payment, a printed receipt. Each item is
still its own sale (so profit keeps working), grouped under one receipt number. Builds on the payment methods
(cash, mobile banking, card, online) that every sale already records.

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
