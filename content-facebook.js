// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.
//
// Runs on https://www.facebook.com/marketplace/create/item
// Fills the "create listing" form from a listing captured on Kijiji.
//
// Facebook's DOM has no stable public API, no test-ids, and (confirmed by
// inspecting the live form) no aria-label on Title/Price/Description/
// Category/Condition either. What it does have is a floating-label pattern:
// each field is `<label><span>Field name</span><input-or-control></label>`,
// with the field name as an exact-text leaf span. That's the hook this
// script keys off of instead. It fails soft field-by-field: if one field's
// label text can't be found, it's logged and left for the user.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(findFn, { timeout = 20000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = findFn();
    if (found) return found;
    await sleep(interval);
  }
  return null;
}

function findLabelSpan(text) {
  const nodes = document.querySelectorAll('span, div');
  for (const el of nodes) {
    if (el.children.length === 0 && el.innerText && el.innerText.trim() === text) return el;
  }
  return null;
}

// Returns the input/textarea for a plain text field, or the <label> itself
// for a custom picker like Category/Condition (whose <label> has
// role="combobox" and is what you click to open it).
function queryByLabels(labels) {
  for (const text of labels) {
    const span = findLabelSpan(text);
    if (!span) continue;
    const label = span.closest('label');
    if (!label) continue;
    const field = label.querySelector('input, textarea, [contenteditable="true"]');
    if (field) return field;
    if (label.getAttribute('role') === 'combobox') return label;
  }
  return null;
}

function setNativeValue(element, value) {
  const tag = element.tagName;
  const proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setContentEditable(element, value) {
  element.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function fillTextField(labels, value) {
  if (!value) return false;
  const el = queryByLabels(labels);
  if (!el) {
    console.warn(`[kijiji-fb-sync] could not find field for: ${labels.join(', ')}`);
    return false;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    setNativeValue(el, value);
  } else if (el.isContentEditable) {
    setContentEditable(el, value);
  } else {
    return false;
  }
  return true;
}

function dataUrlToFile(dataUrl, filename) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

// Facebook's Condition field (like Category) is a custom picker: clicking it
// opens a flat list of plain divs (no role/aria attributes) representing the
// options. Testing showed these rows ignore script-dispatched mouse events
// entirely (including full pointerdown/pointerup/click sequences) — Facebook
// appears to require a genuinely trusted click to commit a selection. A plain
// .click() DOES work to open the picker itself, just not to choose a row.
// So: open with .click(), then commit the choice via the background script's
// chrome.debugger-based trusted click (see background.js).
async function trustedClick(el) {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(200);
  const rect = el.getBoundingClientRect();
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  const res = await chrome.runtime.sendMessage({ type: 'CDP_CLICK', x, y });
  return !!res?.ok;
}

function normalizeOptionText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function findMatchingOption(term, timeout = 3000) {
  const target = normalizeOptionText(term);
  if (!target) return null;
  return waitFor(() => {
    const containers = document.querySelectorAll('div, span');
    for (const leaf of containers) {
      if (leaf.children.length !== 0) continue; // want the innermost text node's element
      const label = normalizeOptionText(leaf.innerText);
      if (!label) continue;
      if (label === target || label.includes(target) || target.includes(label)) {
        // walk up to the clickable row: the ancestor whose parent has several
        // siblings (one per option in the list). On Facebook's real DOM this
        // was measured at 10 ancestors up from the label's leaf text node;
        // the extra margin here is to tolerate minor depth differences
        // between the Category and Condition pickers.
        let node = leaf;
        for (let i = 0; i < 16 && node.parentElement; i++) {
          if (node.parentElement.children.length >= 3) return node;
          node = node.parentElement;
        }
      }
    }
    return null;
  }, { timeout, interval: 150 });
}

async function selectPickerOption(fieldLabels, candidateTerms) {
  const terms = candidateTerms.filter(Boolean);
  if (!terms.length) return false;

  const control = queryByLabels(fieldLabels);
  if (!control) {
    console.warn(`[kijiji-fb-sync] could not find the ${fieldLabels[0]} control`);
    return false;
  }
  control.click();
  await sleep(400);

  for (const term of terms) {
    const option = await findMatchingOption(term, 2000);
    if (option) {
      const ok = await trustedClick(option);
      if (ok) return true;
    }
  }
  console.warn(`[kijiji-fb-sync] no ${fieldLabels[0]} option matched: ${terms.join(', ')}`);
  document.body.click(); // close whatever menu we opened
  return false;
}

async function fillCondition(condition) {
  if (!condition) return false;
  return selectPickerOption(['Condition'], [condition]);
}

// Category is deliberately left for manual selection: Kijiji's breadcrumb
// categories don't map cleanly onto Facebook's flat ~30-category list, and
// matching it well enough to trust added complexity (and reviewer scrutiny,
// since it leans on the same chrome.debugger trusted-click mechanism as
// Condition) without a proportional benefit. The Kijiji category is still
// captured and shown in the popup and the on-page banner as a hint.

async function fillPhotos(images) {
  if (!images || images.length === 0) return false;
  const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"]'));
  if (!input) {
    console.warn('[kijiji-fb-sync] could not find the photo upload input');
    return false;
  }
  const files = images.map((img) => dataUrlToFile(img.dataUrl, img.name));
  const dataTransfer = new DataTransfer();
  files.forEach((f) => dataTransfer.items.add(f));
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function showBanner(message) {
  let banner = document.getElementById('kfb-sync-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'kfb-sync-banner';
    banner.style.cssText = [
      'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#1877f2', 'color:#fff',
      'padding:12px 20px', 'border-radius:8px', 'font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)', 'max-width:480px', 'text-align:center',
    ].join(';');
    document.body.appendChild(banner);
  }
  banner.textContent = message;
}

async function fillListing(listing) {
  showBanner('Filling in your Kijiji listing…');

  // Facebook renders the create-item form asynchronously after route match.
  await waitFor(() => queryByLabels(['Title']));

  const filled = {
    title: fillTextField(['Title'], listing.title),
    price: fillTextField(['Price'], listing.price),
    description: fillTextField(['Description'], listing.description),
  };
  const photosFilled = await fillPhotos(listing.images);

  let conditionFilled = false;
  try {
    conditionFilled = await fillCondition(listing.condition);
  } finally {
    // Detach the debugger session as soon as we're done with the trusted
    // click it was needed for, so the "being debugged" banner doesn't
    // linger longer than necessary.
    await chrome.runtime.sendMessage({ type: 'CDP_DETACH' });
  }

  const missing = [];
  if (!filled.title) missing.push('title');
  if (!filled.price) missing.push('price');
  if (!filled.description) missing.push('description');
  if (!photosFilled) missing.push('photos');
  if (!conditionFilled) missing.push(listing.condition ? `condition (was "${listing.condition}")` : 'condition');
  // Category is always manual — see the comment above, after fillCondition.
  missing.push(listing.category ? `category (Kijiji: "${listing.category}")` : 'category');

  showBanner(
    missing.length
      ? `Filled from Kijiji. Please double-check: ${missing.join(', ')}. Then review everything and click Next to publish.`
      : 'Filled from Kijiji. Review everything, then click Next to publish.'
  );

  await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_LISTING' });
}

(async () => {
  const { listing } = await chrome.runtime.sendMessage({ type: 'REQUEST_PENDING_LISTING' });
  if (listing) await fillListing(listing);
})();
