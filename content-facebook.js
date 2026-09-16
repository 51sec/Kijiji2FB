// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.
//
// Runs on https://www.facebook.com/marketplace/create/item
// Fills the "create listing" form from a listing captured on Kijiji.
//
// Facebook's DOM has no stable public API, no test-ids, and (confirmed by
// inspecting the live form) no aria-label on Title/Price/Description either.
// What it does have is a floating-label pattern: each field is
// `<label><span>Field name</span><input></label>`, with the field name as an
// exact-text leaf span. That's the hook this script keys off of instead. It
// fails soft field-by-field: if one field's label text can't be found, it's
// logged and left for the user.
//
// Category and Condition are intentionally NOT auto-filled. Both are custom
// picker widgets that ignore script-dispatched clicks on their option rows —
// only a genuinely trusted (real, physical) click commits a selection there.
// The only reliable programmatic workaround found was chrome.debugger
// (Chrome DevTools Protocol), which this extension deliberately does not use:
// that permission is heavily scrutinized in Chrome Web Store review, and
// bypassing a site's own anti-automation guard is the kind of thing that
// gets extensions rejected or pulled. So both fields are left for you to
// pick — the Kijiji category/condition are still captured and shown as
// hints in the popup and the on-page banner below.

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

function normalizeFieldText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u00A0\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildSearchTerms(labels) {
  const searchTerms = new Set();
  for (const label of labels) {
    const stripped = normalizeFieldText(label);
    if (!stripped) continue;

    searchTerms.add(stripped);
    searchTerms.add(stripped.replace(/^item\s+/, ''));
    searchTerms.add(stripped.replace(/\s+field$/, ''));
  }
  return [...searchTerms];
}

function fieldMatchesLabel(field, labelText) {
  const candidateText = normalizeFieldText(labelText);
  if (!candidateText) return false;

  const attributes = [
    field.getAttribute('aria-label'),
    field.getAttribute('placeholder'),
    field.getAttribute('name'),
    field.getAttribute('data-testid'),
    field.id,
  ].filter(Boolean);

  const haystack = normalizeFieldText(
    [
      ...(field.closest('label') ? [field.closest('label').textContent || field.closest('label').innerText || ''] : []),
      ...attributes,
      field.textContent || field.innerText || '',
    ].join(' ')
  );

  return haystack.includes(candidateText)
    || attributes.some((value) => normalizeFieldText(value).includes(candidateText));
}

function queryByLabels(labels) {
  const searchTerms = buildSearchTerms(labels);

  const fieldNodes = document.querySelectorAll(
    'input, textarea, [role="textbox"], [contenteditable="true"]'
  );

  for (const field of fieldNodes) {
    const label = field.closest('label');
    const labelText = label ? label.textContent || label.innerText || '' : '';
    const attrText = [
      field.getAttribute('aria-label'),
      field.getAttribute('placeholder'),
      field.getAttribute('name'),
      field.getAttribute('data-testid'),
      field.id,
    ].filter(Boolean).join(' ');

    const haystack = normalizeFieldText(`${labelText} ${attrText}`);
    if (searchTerms.some((term) => haystack.includes(term))) {
      return field;
    }

    if (searchTerms.some((term) => fieldMatchesLabel(field, term))) {
      return field;
    }
  }

  for (const label of document.querySelectorAll('label')) {
    const labelText = label.textContent || label.innerText || '';
    const haystack = normalizeFieldText(labelText);
    if (searchTerms.some((term) => haystack.includes(term))) {
      const field = label.querySelector('input, textarea, [role="textbox"], [contenteditable="true"]');
      if (field) return field;
    }
  }

  return null;
}

function dispatchFieldEvents(element, value) {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  if ('value' in element && element.value !== value) {
    element.value = value;
  }
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
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
  dispatchFieldEvents(element, value);
}

function setContentEditable(element, value) {
  element.focus();
  const selection = window.getSelection();
  if (selection && selection.rangeCount) {
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  element.textContent = value;
  dispatchFieldEvents(element, value);
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

  const manualFields = [];
  manualFields.push(listing.category ? `category (Kijiji: "${listing.category}")` : 'category');
  manualFields.push(listing.condition ? `condition (Kijiji: "${listing.condition}")` : 'condition');

  const missing = [];
  if (!filled.title) missing.push('title');
  if (!filled.price) missing.push('price');
  if (!filled.description) missing.push('description');
  if (!photosFilled) missing.push('photos');

  const parts = [
    missing.length ? `Couldn't fill: ${missing.join(', ')}.` : null,
    `Please set manually: ${manualFields.join(', ')}.`,
    'Then review everything and click Next to publish.',
  ].filter(Boolean);

  showBanner(`Filled from Kijiji. ${parts.join(' ')}`);

  await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_LISTING' });
}

(async () => {
  const { listing } = await chrome.runtime.sendMessage({ type: 'REQUEST_PENDING_LISTING' });
  if (listing) await fillListing(listing);
})();
