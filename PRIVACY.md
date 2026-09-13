# Privacy Policy — Kijiji to Marketplace

_Last updated: 2026._

This extension is a personal productivity tool. It does not have a
server, does not run analytics, and does not sell, share, or transmit
your data to the developer or any third party.

Not affiliated with, endorsed by, or sponsored by Kijiji, eBay Canada,
Meta Platforms, Inc., or Facebook.

## What data the extension handles

When you click **"Send to Facebook Marketplace"** on a Kijiji ad page you
are viewing, the extension reads that page's own visible content: the
ad's title, price, description, condition/attributes, category
breadcrumb, and photos. Nothing is captured unless you click that button.

## Where that data goes

- **Stored locally only**, in your browser's `chrome.storage.local`, on
  your own device. It is never sent to any server operated by the
  developer (Jon Netsec / 51Sec Inc.) or anyone else.
- **Kijiji's own image files** are fetched directly from Kijiji's media
  servers (`media.kijiji.ca`) so they can be re-uploaded to your Facebook
  Marketplace listing — this is a direct request from your browser to
  Kijiji's CDN, the same as your browser already does to display the ad.
- **Facebook** only ever receives what you would have typed into the
  create-listing form yourself; the extension fills that form in your
  own already-logged-in Facebook tab. It does not log in on your behalf,
  does not read your Facebook account data, and does not submit/publish
  anything — you review and click Next/Publish yourself.
- Captured listings stay on your device until you delete them from the
  extension's popup, or uninstall the extension (which clears its
  storage).

## What the extension does NOT do

- No analytics, telemetry, or crash reporting.
- No ads, no ad networks, no tracking pixels.
- No account credentials are ever read, stored, or transmitted — you stay
  logged in via your browser's normal session; the extension never sees
  passwords or auth tokens.
- No data is sold or shared with third parties, because none is
  collected off your device in the first place.

## Permissions this extension requests, and why

- `storage` / `unlimitedStorage` — to save captured listings (including
  photos) locally so you can review them before pushing to Facebook.
- `tabs` / `activeTab` — to open/reuse the Facebook "create listing" tab
  when you click "Push to FB".
- Host access to `kijiji.ca` / `media.kijiji.ca` — to read the ad page
  you're capturing and fetch its photos.
- Host access (via content script) to
  `facebook.com/marketplace/create/*` — to fill the new-listing form on
  that one specific page.

No broader host access is requested.

## Contact

Questions about this policy can be directed to the repository's issue
tracker: https://github.com/51sec/Kijiji2FB/issues
