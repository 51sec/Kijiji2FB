# Kijiji → Facebook Marketplace Sync

A Chrome extension that captures a Kijiji ad with one click and auto-fills
a new Facebook Marketplace listing from it (title, price, category,
condition, description, photos). One-directional: Kijiji → Facebook only.

## Install (unpacked, for local use)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder (`D:\Dev\5-kijiji+Marketplace`)

## Use

1. Open your ad on Kijiji (a `kijiji.ca/v-...` page — e.g. from **My Ads**).
2. Click the blue **📤 Send to Facebook Marketplace** button injected above the title.
3. Click the extension icon in the toolbar to open the popup — your captured listing appears there.
4. Click **Push to FB** — it opens (or reuses) a Facebook Marketplace "create listing" tab and auto-fills:
   - Title
   - Price
   - Category (best-effort — see below)
   - Condition (best-effort — see below)
   - Description (Kijiji's description + any Kijiji attributes, appended)
   - Photos (re-uploaded from Kijiji's images)
5. **You still review and click Next/Publish yourself.** A banner on the
   page tells you exactly which fields (if any) it couldn't fill and need a
   manual look.

## Why Category/Condition needed a different approach

Facebook's Category and Condition fields are custom pickers, and testing
showed they silently ignore script-dispatched mouse events — including a
full `pointerdown`/`pointerup`/`click` sequence with correct coordinates —
while a real, physical click selects the option instantly. This looks like
a deliberate anti-automation guard (probably checking `event.isTrusted`).

To work around that, the extension uses `chrome.debugger` (the same
Chrome DevTools Protocol that tools like Puppeteer use) to inject a
genuinely trusted click from the browser process itself, only for the two
clicks needed to open+select in these pickers. Chrome shows its own
**"[extension] started debugging this browser"** banner while it's
attached — this is expected, not a bug, and it detaches itself
automatically right after the Category/Condition selection is attempted.

Title, Price, and Description don't have this problem — setting their
value via a native property setter + `input`/`change` events is accepted
by Facebook's React form normally, no trusted click needed.

## Why the final Publish click is still manual

The extension deliberately does **not** click Next/Publish for you:
- Facebook's form can add extra required fields depending on category
  (e.g. brand, size), so a "smart" auto-submit would fail unpredictably.
- Automating the final publish step on someone else's platform risks
  tripping spam/bot detection and getting your account flagged — a quick
  manual review + click avoids that risk entirely, and only costs one or
  two clicks per listing.

## How it works

- `content-kijiji.js` — injected on Kijiji ad pages. Scrapes the DOM
  (title, price, description, attribute pairs like Condition, a cleaned
  category path from the breadcrumbs, photo URLs) and sends it to the
  background service worker.
- `background.js` — stores captured listings in `chrome.storage.local`,
  fetches photo bytes (from the background context so it isn't blocked by
  page-level CORS), opens/refreshes the Facebook tab when you push a
  listing, and holds the `chrome.debugger` logic used for trusted clicks.
- `content-facebook.js` — injected on
  `facebook.com/marketplace/create/*`. Facebook has no aria-labels or
  test-ids on any of these fields; instead each one is
  `<label><span>Field name</span><input-or-control></label>` (a floating
  label pattern), so fields are found by matching that exact visible label
  text. Title/Price/Description are filled directly; Category/Condition are
  opened normally then their matching option is clicked via the background
  script's trusted-click message; photos are attached to the file input via
  `DataTransfer`.
- `popup.html` / `popup.js` — lists captured listings so you can push or
  delete them.

## Known limitations

- **Facebook's DOM changes without notice.** If a field stops filling,
  open DevTools on the create-listing page, inspect the field, and check
  the exact visible label text — then update the label strings passed to
  `fillTextField(...)` / `fillCondition` / `fillCategory` in
  `content-facebook.js`. If a Category/Condition click stops registering,
  the "climb to the clickable row" heuristic in `findMatchingOption` may
  need its ancestor-depth margin adjusted.
- Facebook's Category list is one flat level (~30 broad categories, no
  subcategories) — it matches Kijiji's most specific breadcrumb term first,
  falling back to broader ones. It can't always land on the ideal Facebook
  category; check the banner's "please double-check" note.
- Only handles items where Kijiji shows a single numeric price ("Please
  Contact" / "Swap/Trade" listings get no price — you'll set it manually).
- Captures whatever photos are visible in the Kijiji gallery thumbnails;
  very large galleries may take a moment to re-upload.
- No icons are configured, so Chrome shows a generic puzzle-piece icon —
  cosmetic only, doesn't affect function. Add `icons/` + an `icons` entry
  in `manifest.json` if you want a custom one.

## License

MIT © 2026 Jon Netsec / 51Sec Inc. See [LICENSE](LICENSE).
