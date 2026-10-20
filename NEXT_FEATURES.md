# Next features

Ideas planned for later. Move an item out of this list when it's built.

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

## Offline selling

Let shops keep selling (and adding stock) when the internet drops, and send
everything when it comes back. Planned for after launch, once the first shops
show how often their connection really fails.

- **Only selling and adding stock work offline.** Purchases, transfers, settings and
  accounts wait for the internet. Keeping it small is what keeps it reliable.
- **Storage:** IndexedDB on the device, not localStorage (about 5 MB, and writes can be
  lost if the browser closes at the wrong moment).
- **Opens without internet:** make the app a PWA with a service worker, and keep a copy
  of the product list and prices on the device, refreshed whenever it's online.
- **No double sales:** every offline sale gets an ID made on the device. The server
  ignores an ID it has already saved, so a send that fails halfway can be retried.
- **Stock conflicts:** two phones may both sell the last item while offline. Both sales
  really happened, so the server accepts them, lets stock go below 0, and flags it for
  the owner ("sold while offline"). It never rejects a sale the customer has paid for.
- **Receipts:** offline sales get a temporary number like `OFF-1-0001` and their real
  receipt number when sent. The WhatsApp receipt link and the bKash/Nagad duplicate
  check only work after that.
- **Login:** the access token may expire while offline; sending must renew it first.
- **Show what's waiting:** a clear "3 sales waiting to send" badge, and a warning before
  logging out or clearing browser data, so unsent sales aren't lost.
- **Sending:** on the browser's `online` event, and when the app opens (Background Sync
  isn't in every browser).
- **Size:** a few days of careful work, with tests for retries, conflicts and expired logins.
