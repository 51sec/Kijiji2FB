// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.
//
// Background service worker: storage of captured listings, image fetching
// (bypasses page-level CORS since this runs in the extension's privileged
// context with host_permissions), and orchestration of the Facebook tab.

const FB_CREATE_URL = 'https://www.facebook.com/marketplace/create/item';
const MAX_LISTINGS = 50;
const PENDING_LISTING_TTL_MS = 10 * 60 * 1000;

function normalizeListings(listings) {
  if (!Array.isArray(listings)) return [];
  return listings
    .filter(Boolean)
    .sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0))
    .slice(0, MAX_LISTINGS);
}

async function getListings() {
  const { listings = [] } = await chrome.storage.local.get('listings');
  return normalizeListings(listings);
}

async function saveListings(listings) {
  await chrome.storage.local.set({ listings: normalizeListings(listings) });
}

async function clearPendingListing() {
  await chrome.storage.local.remove(['pendingListing', 'pendingListingId']);
}

async function getPendingListingMeta() {
  const { pendingListing } = await chrome.storage.local.get('pendingListing');
  if (!pendingListing) {
    const { pendingListingId } = await chrome.storage.local.get('pendingListingId');
    if (!pendingListingId) return null;
    await clearPendingListing();
    return null;
  }

  if (Date.now() > (pendingListing.expiresAt || 0)) {
    await clearPendingListing();
    return null;
  }

  return pendingListing;
}

async function setPendingListing(listingId, tabId) {
  const pendingListing = {
    id: listingId,
    tabId: tabId || null,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_LISTING_TTL_MS,
  };

  await chrome.storage.local.set({
    pendingListing,
    pendingListingId: listingId,
  });
}

async function clearPendingListingIfTabClosed(tabId) {
  const pendingListing = await getPendingListingMeta();
  if (pendingListing && pendingListing.tabId === tabId) {
    await clearPendingListing();
  }
}

async function fetchImageAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[kijiji-fb-sync] image request failed', url, res.status);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/')) {
      console.warn('[kijiji-fb-sync] non-image response', url, contentType);
      return null;
    }

    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[kijiji-fb-sync] failed to fetch image', url, err);
    return null;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    await clearPendingListingIfTabClosed(tabId);
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'CAPTURE_LISTING': {
        const listing = message.listing;
        listing.images = (
          await Promise.all((listing.imageUrls || []).map(fetchImageAsDataUrl))
        )
          .filter(Boolean)
          .map((dataUrl, i) => ({ dataUrl, name: `photo-${i + 1}.jpg` }));
        delete listing.imageUrls;
        listing.capturedAt = Date.now();

        const listings = await getListings();
        const idx = listings.findIndex((l) => l.id === listing.id);
        if (idx >= 0) listings[idx] = listing;
        else listings.unshift(listing);
        await saveListings(listings);
        sendResponse({ ok: true, imageCount: listing.images.length });
        break;
      }

      case 'GET_LISTINGS': {
        const listings = await getListings();
        sendResponse({ listings });
        break;
      }

      case 'DELETE_LISTING': {
        const listings = (await getListings()).filter((l) => l.id !== message.id);
        await saveListings(listings);
        sendResponse({ ok: true });
        break;
      }

      case 'CLEAR_ALL_LISTINGS': {
        await saveListings([]);
        await clearPendingListing();
        sendResponse({ ok: true });
        break;
      }

      case 'PUSH_TO_FACEBOOK': {
        const listings = await getListings();
        const listing = listings.find((l) => l.id === message.id);
        if (!listing) {
          sendResponse({ ok: false, error: 'Listing not found' });
          break;
        }

        const tabs = await chrome.tabs.query({ url: FB_CREATE_URL + '*' });
        let tab = tabs[0];
        if (tab) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.tabs.reload(tab.id);
        } else {
          tab = await chrome.tabs.create({ url: FB_CREATE_URL });
        }

        await setPendingListing(listing.id, tab?.id || null);
        sendResponse({ ok: true });
        break;
      }

      // The Facebook content script asks for its pending listing once the
      // create-item form has finished rendering. This pull model avoids
      // races with push-based messaging on a heavy client-rendered SPA.
      case 'REQUEST_PENDING_LISTING': {
        const pendingListing = await getPendingListingMeta();
        if (!pendingListing) {
          sendResponse({ listing: null });
          break;
        }

        const listings = await getListings();
        const listing = listings.find((l) => l.id === pendingListing.id) || null;
        if (!listing) {
          await clearPendingListing();
          sendResponse({ listing: null });
          break;
        }

        sendResponse({ listing });
        break;
      }

      case 'CLEAR_PENDING_LISTING': {
        await clearPendingListing();
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep the message channel open for the async response
});
