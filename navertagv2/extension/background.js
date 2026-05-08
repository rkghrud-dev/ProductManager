const LOCAL_API = 'http://127.0.0.1:8787';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    navertagv2Settings: {
      productDelayMinSec: 20,
      productDelayMaxSec: 60,
      verifyDelayMinSec: 3,
      verifyDelayMaxSec: 10,
      stopOnErrorCount: 3
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PING_LOCAL') {
    fetch(`${LOCAL_API}/api/keys/status`)
      .then(response => response.json())
      .then(json => sendResponse({ ok: true, json }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SAVE_TAG_CACHE') {
    fetch(`${LOCAL_API}/api/tag-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cache: message.cache || {} })
    })
      .then(response => response.json())
      .then(json => sendResponse({ ok: true, json }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
