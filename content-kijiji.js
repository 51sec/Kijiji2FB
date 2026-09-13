// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.
//
// Runs on Kijiji ad view pages (https://www.kijiji.ca/v-.../<adId>).
// Scrapes the listing and injects a "Send to Facebook Marketplace" button.

function extractAdId() {
  const match = location.pathname.match(/(\d{6,})\/?$/);
  return match ? match[1] : location.pathname;
}

function text(selector) {
  const el = document.querySelector(selector);
  return el ? el.innerText.trim() : '';
}

function parsePrice(raw) {
  if (!raw) return '';
  if (/free/i.test(raw)) return '0';
  const digits = raw.replace(/[^\d.]/g, '');
  return digits || '';
}

function extractBreadcrumbs() {
  return Array.from(document.querySelectorAll('[data-testid^="breadcrumb-link-"]'))
    .map((el) => el.innerText.trim())
    .filter(Boolean);
}

// Breadcrumbs look like ["Home","Buy & Sell","Furniture","Other for City of Toronto"]
// or ["Real Estate","For Rent","Room Rentals and Roommates for City of Toronto"].
// Strip the generic nav crumbs and the "... for <location>" suffix Kijiji tacks
// onto the last one, so what's left reads as a clean category path.
function extractCategory() {
  const GENERIC = new Set(['Home', 'Buy & Sell']);
  const cleanCrumb = (c) => c.replace(/\s+for\s+.+$/i, '').trim();
  return extractBreadcrumbs()
    .filter((c) => !GENERIC.has(c))
    .map(cleanCrumb)
    .filter(Boolean)
    .join(' > ');
}

// Each Kijiji "attribute" (Condition, Pet Friendly, etc.) renders as a label
// <p> followed by a value <p> inside a vip-attributes-generic[2] container.
function extractAttributePairs() {
  const containers = document.querySelectorAll(
    '[data-testid="vip-attributes-generic"] > div, [data-testid="vip-attributes-generic2"] > div'
  );
  const pairs = [];
  containers.forEach((c) => {
    const ps = c.querySelectorAll('p');
    if (ps.length >= 2) {
      pairs.push([ps[0].innerText.trim(), ps[1].innerText.trim()]);
    }
  });
  return pairs;
}

function extractImageUrls() {
  const urls = new Set();
  document.querySelectorAll('img[data-testid="gallery-thumbnail"]').forEach((img) => {
    if (img.src) urls.add(upscale(img.src));
  });
  const main = document.querySelector('[data-testid="gallery-main-image"] img, [data-testid="listing-gallery-main"] img');
  if (main && main.src) urls.add(upscale(main.src));
  return Array.from(urls);
}

function upscale(src) {
  // Kijiji media URLs carry a ?rule=kijijica-640-webp sizing hint; ask for a
  // larger rendition so the re-uploaded photo on Facebook isn't blurry.
  return src.replace(/rule=kijijica-\d+-webp/, 'rule=kijijica-1600-webp');
}

function scrapeListing() {
  const title = text('h1');
  const priceRaw = text('[data-testid="vip-price"]');
  const description = text('[data-testid="vip-description-wrapper"]');
  const attributePairs = extractAttributePairs();
  const category = extractCategory();

  const conditionPair = attributePairs.find(([label]) => /^condition$/i.test(label));
  const condition = conditionPair ? conditionPair[1] : '';

  let fullDescription = description;
  if (attributePairs.length) {
    const attributesText = attributePairs.map(([k, v]) => `${k}: ${v}`).join('\n');
    fullDescription += `\n\n${attributesText}`;
  }

  return {
    id: extractAdId(),
    sourceUrl: location.href,
    title,
    price: parsePrice(priceRaw),
    priceRaw,
    description: fullDescription,
    category,
    condition,
    imageUrls: extractImageUrls(),
  };
}

function injectButton() {
  if (document.getElementById('kfb-sync-button')) return;

  const container = document.querySelector('h1')?.parentElement;
  if (!container) return;

  const btn = document.createElement('button');
  btn.id = 'kfb-sync-button';
  btn.type = 'button';
  btn.className = 'kfb-sync-button';
  btn.textContent = '\u{1F4E4} Send to Facebook Marketplace';

  const status = document.createElement('span');
  status.className = 'kfb-sync-status';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Capturing…';
    status.textContent = '';
    try {
      const listing = scrapeListing();
      if (!listing.title) throw new Error('Could not find a title on this page');

      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_LISTING', listing });
      if (!response?.ok) throw new Error(response?.error || 'Capture failed');

      btn.textContent = '✅ Captured — open the extension popup';
      status.textContent = `${response.imageCount} photo(s) saved. Click the extension icon to push it to Facebook.`;
    } catch (err) {
      btn.textContent = '⚠️ Send to Facebook Marketplace';
      status.textContent = `Error: ${err.message}`;
      console.error('[kijiji-fb-sync]', err);
    } finally {
      btn.disabled = false;
    }
  });

  container.prepend(status);
  container.prepend(btn);
}

injectButton();
// The VIP header sometimes mounts slightly after document_idle; retry briefly.
const retryTimer = setInterval(() => {
  injectButton();
}, 1000);
setTimeout(() => clearInterval(retryTimer), 10000);
