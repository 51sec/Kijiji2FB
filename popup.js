async function loadListings() {
  const { listings } = await chrome.runtime.sendMessage({ type: 'GET_LISTINGS' });
  render(listings);
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
      await chrome.runtime.sendMessage({ type: 'PUSH_TO_FACEBOOK', id: listing.id });
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

loadListings();
