// Copyright (c) 2026 Jon Netsec / 51Sec Inc. Licensed under the MIT License.
// See LICENSE in the project root. Retain this notice in copies/redistributions.
//
// Background service worker: storage of captured listings, image fetching
// (bypasses page-level CORS since this runs in the extension's privileged
// context with host_permissions), and orchestration of the Facebook tab.

const FB_CREATE_URL = 'https://www.facebook.com/marketplace/create/item';

// Free tier: a lifetime cap on how many distinct Kijiji listings can be
// pushed to Facebook. Re-pushing the same listing again doesn't consume
// another slot -- only the count of *distinct* listing ids that have ever
// been pushed matters. Entering a valid Gumroad license key removes the cap.
const FREE_LISTING_LIMIT = 3;

// Fill this in once the Gumroad product exists (Product > Settings > the
// permalink at the end of the product's short URL, e.g. gumroad.com/l/XXXX
// -> permalink is "XXXX"). Left blank, license activation always fails.
const GUMROAD_PRODUCT_PERMALINK = '';

async function getPushedListingIds() {
  const { pushedListingIds = [] } = await chrome.storage.local.get('pushedListingIds');
  return pushedListingIds;
}

async function getLicense() {
  const { license = null } = await chrome.storage.local.get('license');
  return license; // { key, activatedAt } or null
}

async function isPro() {
  return !!(await getLicense());
}

async function verifyGumroadLicense(licenseKey) {
  if (!GUMROAD_PRODUCT_PERMALINK) {
    return { ok: false, error: 'License verification isn\'t configured yet.' };
  }
  try {
    const body = new URLSearchParams({
      product_permalink: GUMROAD_PRODUCT_PERMALINK,
      license_key: licenseKey,
    });
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    if (!data.success) {
      return { ok: false, error: 'That license key isn\'t valid.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not reach the license server. Try again later.' };
  }
}

async function getListings() {
  const { listings = [] } = await chrome.storage.local.get('listings');
  return listings;
}

async function saveListings(listings) {
  await chrome.storage.local.set({ listings });
}

async function fetchImageAsDataUrl(url) {
  try {
    const res = await fetch(url);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'CAPTURE_LISTING': {
        const listing = message.listing;
        listing.images = (
          await Promise.all(listing.imageUrls.map(fetchImageAsDataUrl))
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
        sendResponse({ listings: await getListings() });
        break;
      }

      case 'DELETE_LISTING': {
        const listings = (await getListings()).filter((l) => l.id !== message.id);
        await saveListings(listings);
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

        const pushedIds = await getPushedListingIds();
        const alreadyCounted = pushedIds.includes(listing.id);
        if (!alreadyCounted && pushedIds.length >= FREE_LISTING_LIMIT && !(await isPro())) {
          sendResponse({ ok: false, limitReached: true, limit: FREE_LISTING_LIMIT });
          break;
        }

        await chrome.storage.local.set({ pendingListingId: listing.id });

        const tabs = await chrome.tabs.query({ url: FB_CREATE_URL + '*' });
        let tab = tabs[0];
        if (tab) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.tabs.reload(tab.id);
        } else {
          tab = await chrome.tabs.create({ url: FB_CREATE_URL });
        }

        if (!alreadyCounted) {
          await chrome.storage.local.set({ pushedListingIds: [...pushedIds, listing.id] });
        }
        sendResponse({ ok: true });
        break;
      }

      // The Facebook content script asks for its pending listing once the
      // create-item form has finished rendering. This pull model avoids
      // races with push-based messaging on a heavy client-rendered SPA.
      case 'REQUEST_PENDING_LISTING': {
        const { pendingListingId } = await chrome.storage.local.get('pendingListingId');
        if (!pendingListingId) {
          sendResponse({ listing: null });
          break;
        }
        const listings = await getListings();
        const listing = listings.find((l) => l.id === pendingListingId) || null;
        sendResponse({ listing });
        break;
      }

      case 'CLEAR_PENDING_LISTING': {
        await chrome.storage.local.remove('pendingListingId');
        sendResponse({ ok: true });
        break;
      }

      case 'GET_LICENSE_STATUS': {
        const pushedIds = await getPushedListingIds();
        sendResponse({
          isPro: await isPro(),
          pushedCount: pushedIds.length,
          limit: FREE_LISTING_LIMIT,
        });
        break;
      }

      case 'ACTIVATE_LICENSE': {
        const result = await verifyGumroadLicense(message.licenseKey);
        if (result.ok) {
          await chrome.storage.local.set({
            license: { key: message.licenseKey, activatedAt: Date.now() },
          });
        }
        sendResponse(result);
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep the message channel open for the async response
});
