# Kijiji → Facebook Marketplace Sync

A Chrome extension that captures a Kijiji ad with one click and auto-fills
a new Facebook Marketplace listing from it (title, price, condition,
description, photos — category is left for you to pick, see below).
One-directional: Kijiji → Facebook only.

> The screenshots below are sanitized mockups (placeholder listing, generic
> account name) built to illustrate the flow without exposing anyone's real
> Kijiji/Facebook account.

**1. Capture on Kijiji** — a button is injected above the ad title:

![Kijiji capture button](screenshots/kijiji-capture.png)

**2. Review captured listings in the popup:**

![Extension popup](screenshots/extension-popup.png)

**3. Auto-filled on Facebook Marketplace, ready for you to review and publish:**

![Facebook auto-fill](screenshots/facebook-autofill.png)

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
   - Condition (best-effort — see below)
   - Description (Kijiji's description + any Kijiji attributes, appended)
   - Photos (re-uploaded from Kijiji's images)
   - **Category is intentionally left for you to pick** — Kijiji's
     breadcrumb categories don't map cleanly onto Facebook's flat
     ~30-category list, so this isn't automated. The Kijiji category is
     still shown as a hint in the popup and in the on-page banner.
5. **You still review and click Next/Publish yourself.** A banner on the
   page tells you exactly which fields (if any) it couldn't fill and need a
   manual look.

## Why Condition needed a different approach

Facebook's Condition field is a custom picker, and testing showed it
silently ignores script-dispatched mouse events — including a full
`pointerdown`/`pointerup`/`click` sequence with correct coordinates — while
a real, physical click selects the option instantly. This looks like a
deliberate anti-automation guard (probably checking `event.isTrusted`).

To work around that, the extension uses `chrome.debugger` (the same
Chrome DevTools Protocol that tools like Puppeteer use) to inject a
genuinely trusted click from the browser process itself, only for the one
click needed to select the matching Condition option. Chrome shows its own
**"[extension] started debugging this browser"** banner while it's
attached — this is expected, not a bug, and it detaches itself
automatically right after.

Title, Price, and Description don't have this problem — setting their
value via a native property setter + `input`/`change` events is accepted
by Facebook's React form normally, no trusted click needed. Category uses
the same picker widget as Condition, which is part of why it's left
manual: adding a second trusted-click target for a much harder matching
problem (Kijiji's category tree vs. Facebook's flat list) wasn't worth the
added complexity.

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
  listing, and holds the `chrome.debugger` logic used for the Condition
  trusted click.
- `content-facebook.js` — injected on
  `facebook.com/marketplace/create/*`. Facebook has no aria-labels or
  test-ids on any of these fields; instead each one is
  `<label><span>Field name</span><input-or-control></label>` (a floating
  label pattern), so fields are found by matching that exact visible label
  text. Title/Price/Description are filled directly; Condition is opened
  normally then its matching option is clicked via the background script's
  trusted-click message; photos are attached to the file input via
  `DataTransfer`. Category is left untouched for manual selection.
- `popup.html` / `popup.js` — lists captured listings so you can push or
  delete them.

## Known limitations

- **Facebook's DOM changes without notice.** If a field stops filling,
  open DevTools on the create-listing page, inspect the field, and check
  the exact visible label text — then update the label strings passed to
  `fillTextField(...)` / `fillCondition` in `content-facebook.js`. If the
  Condition click stops registering, the "climb to the clickable row"
  heuristic in `findMatchingOption` may need its ancestor-depth margin
  adjusted.
- **Category is always manual** — see "Why Condition needed a different
  approach" above for why it isn't automated.
- Only handles items where Kijiji shows a single numeric price ("Please
  Contact" / "Swap/Trade" listings get no price — you'll set it manually).
- Captures whatever photos are visible in the Kijiji gallery thumbnails;
  very large galleries may take a moment to re-upload.
- No icons are configured, so Chrome shows a generic puzzle-piece icon —
  cosmetic only, doesn't affect function. Add `icons/` + an `icons` entry
  in `manifest.json` if you want a custom one.

## License

**Copyright © 2026 Jon Netsec / 51Sec Inc. All rights not expressly granted
below are reserved.**

This project is licensed under the [MIT License](LICENSE). In plain terms,
that means:

- ✅ **Use** — you may run and use this code, privately or commercially, at
  no cost.
- ✅ **Modify** — you may change, extend, or build on top of it.
- ✅ **Redistribute** — you may share it, bundle it, package it as a
  browser extension, or publish a fork of it, including for commercial
  purposes.
- ⚠️ **On one condition, with no exceptions:** every copy or substantial
  portion of this software that you use, modify, or redistribute — as
  source code, a packaged/compiled extension, or a fork — **must retain
  the original copyright notice above and the full MIT license text.**
  This is not a courtesy request; it is Section 2 of the license text you
  are bound by the moment you use this code, and it is legally
  enforceable.

**What this means concretely:**
- Do **not** delete, edit, or paraphrase the copyright notice.
- Do **not** re-license a fork or derivative under your own name/company
  without keeping this notice.
- Do **not** present this work, in whole or substantial part, as your own
  original creation.
- Forks, mirrors, and redistributed packages must carry this same notice
  and a copy of the [LICENSE](LICENSE) file.

Doing any of the above is a license violation, not a gray area, and the
copyright holder (**Jon Netsec / 51Sec Inc.**) reserves the right to
enforce it.

This software is also provided **"as is," with no warranty of any kind**
(see [LICENSE](LICENSE) for the full disclaimer) — you use it entirely at
your own risk, including with respect to any third-party platform's (e.g.
Facebook's) terms of service.
