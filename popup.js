// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.

function setStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message || '';
  status.className = `status${type ? ` ${type}` : ''}`;
}

async function loadListings() {
  try {
    setStatus('');
    const { listings } = await chrome.runtime.sendMessage({ type: 'GET_LISTINGS' });
    render(listings || []);
  } catch (err) {
    console.error('[kijiji-fb-sync] failed to load listings', err);
    setStatus('Could not load saved listings.', 'error');
    render([]);
  }
}

function render(listings) {
  const list = document.getElementById('list');
  list.innerHTML = '';

  if (!listings.length) {
    list.innerHTML = '<div class="empty">No listings captured yet.</div>';
    document.getElementById('clear-all').disabled = true;
    return;
  }

  document.getElementById('clear-all').disabled = false;

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
      const response = await chrome.runtime.sendMessage({ type: 'PUSH_TO_FACEBOOK', id: listing.id });
      if (!response?.ok) {
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push to FB';
        setStatus(response?.error || 'Could not open Facebook.', 'error');
        return;
      }
      setStatus('Opening Facebook Marketplace…', 'success');
      window.close();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'DELETE_LISTING', id: listing.id });
        if (response?.ok) {
          await loadListings();
          return;
        }
        setStatus('Could not delete this listing.', 'error');
      } finally {
        deleteBtn.disabled = false;
      }
    });

    actions.append(pushBtn, deleteBtn);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

document.getElementById('clear-all').addEventListener('click', async () => {
  const confirmed = window.confirm('Remove all captured listings?');
  if (!confirmed) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_LISTINGS' });
    if (response?.ok) {
      setStatus('All captured listings removed.', 'success');
      loadListings();
      return;
    }
    setStatus('Could not clear all listings.', 'error');
  } catch (err) {
    console.error('[kijiji-fb-sync] failed to clear listings', err);
    setStatus('Could not clear all listings.', 'error');
  }
});

loadListings();
