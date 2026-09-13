// Background service worker: storage of captured listings, image fetching
// (bypasses page-level CORS since this runs in the extension's privileged
// context with host_permissions), and orchestration of the Facebook tab.

const FB_CREATE_URL = 'https://www.facebook.com/marketplace/create/item';

// Facebook's Category/Condition pickers ignore script-dispatched mouse events
// (confirmed by testing: plain and full pointer-event sequences on the
// option rows have no effect, while a real click works). chrome.debugger's
// Input.dispatchMouseEvent injects clicks at the browser-process level, so
// the page sees them as genuinely trusted input — this is the only reliable
// way to select those options. It's attached only while filling a listing
// and detached immediately after; Chrome shows its own "extension is
// debugging this tab" banner the whole time it's attached, by design.
const debuggedTabs = new Set();

async function ensureDebuggerAttached(tabId) {
  if (debuggedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggedTabs.add(tabId);
}

async function detachDebugger(tabId) {
  if (!debuggedTabs.has(tabId)) return;
  debuggedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (err) {
    // already detached (e.g. user closed the tab) — fine to ignore
  }
}

chrome.debugger.onDetach.addListener((source) => {
  debuggedTabs.delete(source.tabId);
});

async function cdpClick(tabId, x, y) {
  await ensureDebuggerAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    buttons: 0,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
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
        await chrome.storage.local.set({ pendingListingId: listing.id });

        const tabs = await chrome.tabs.query({ url: FB_CREATE_URL + '*' });
        let tab = tabs[0];
        if (tab) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.tabs.reload(tab.id);
        } else {
          tab = await chrome.tabs.create({ url: FB_CREATE_URL });
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

      case 'CDP_CLICK': {
        try {
          await cdpClick(sender.tab.id, message.x, message.y);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }

      case 'CDP_DETACH': {
        if (sender.tab) await detachDebugger(sender.tab.id);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep the message channel open for the async response
});
