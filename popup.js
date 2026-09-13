// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.

// Where to send people once they've used their free listings. Point this at
// the actual Gumroad product page once it exists; until then it points at
// the Pro repo's README, which explains how to get a license key.
const UPGRADE_URL = 'https://github.com/51sec/kijiji-to-marketplace-pro';

async function loadListings() {
  const { listings } = await chrome.runtime.sendMessage({ type: 'GET_LISTINGS' });
  render(listings);
  await refreshQuota();
}

async function refreshQuota() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_LICENSE_STATUS' });
  const quota = document.getElementById('quota');
  const upgrade = document.getElementById('upgrade');

  if (status.isPro) {
    quota.textContent = '⭐ Pro — unlimited listings';
    quota.className = 'quota pro';
    upgrade.classList.remove('visible');
    return;
  }

  const remaining = Math.max(0, status.limit - status.pushedCount);
  quota.textContent = `${remaining} of ${status.limit} free listings remaining`;
  quota.className = remaining === 0 ? 'quota limit-reached' : 'quota';
  upgrade.classList.toggle('visible', remaining === 0);
}

function render(listings) {
  const list = document.getElementById('list');
  list.innerHTML = '';

  if (!listings.length) {
    list.innerHTML = '<div class="empty">No listings captured yet.</div>';
    return;
  }

  for (const listing of listings) {
    const row = document.createElement('div');
    row.className = 'listing';

    const img = document.createElement('img');
    if (listing.images?.[0]) img.src = listing.images[0].dataUrl;
    row.appendChild(img);

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = listing.title || '(untitled)';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${listing.priceRaw || 'no price'} · ${listing.images?.length || 0} photo(s)`;
    info.append(title, meta);

    if (listing.category || listing.condition) {
      const tags = document.createElement('div');
      tags.className = 'meta';
      const parts = [];
      if (listing.category) parts.push(`Category: ${listing.category}`);
      if (listing.condition) parts.push(`Condition: ${listing.condition}`);
      tags.textContent = parts.join(' · ');
      info.append(tags);
    }
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const pushBtn = document.createElement('button');
    pushBtn.className = 'push';
    pushBtn.textContent = 'Push to FB';
    pushBtn.addEventListener('click', async () => {
      pushBtn.disabled = true;
      pushBtn.textContent = 'Opening…';
      const res = await chrome.runtime.sendMessage({ type: 'PUSH_TO_FACEBOOK', id: listing.id });
      if (res?.limitReached) {
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push to FB';
        await refreshQuota();
        return;
      }
      window.close();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'DELETE_LISTING', id: listing.id });
      loadListings();
    });

    actions.append(pushBtn, deleteBtn);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

document.getElementById('upgrade-link').href = UPGRADE_URL;

document.getElementById('activate-license').addEventListener('click', async () => {
  const input = document.getElementById('license-key');
  const status = document.getElementById('license-status');
  const key = input.value.trim();
  if (!key) return;

  status.textContent = 'Checking…';
  status.style.color = '#65676b';
  const res = await chrome.runtime.sendMessage({ type: 'ACTIVATE_LICENSE', licenseKey: key });
  if (res.ok) {
    status.textContent = '✅ Pro activated — enjoy unlimited listings.';
    status.style.color = '#2e7d32';
    await refreshQuota();
  } else {
    status.textContent = `⚠️ ${res.error || 'Activation failed.'}`;
    status.style.color = '#a02622';
  }
});

loadListings();
