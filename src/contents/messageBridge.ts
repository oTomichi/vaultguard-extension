import type { PlasmoCSConfig } from 'plasmo';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  run_at: 'document_start',
};

// Isolated-world content script.
// The MAIN-world ethereum interceptor is a separate file (vaultguard-main.js)
// registered via chrome.scripting.registerContentScripts in the background's
// onInstalled handler — no inline script injection needed here.

console.log('[VaultGuard] content script loaded on', window.location.hostname);

// ── Relay: MAIN-world postMessage → background and back ──────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data as { source?: string; requestId?: string; message?: unknown } | undefined;
  if (!d || d.source !== 'vaultguard-page' || !d.message) return;

  chrome.runtime.sendMessage(d.message, (response) => {
    window.postMessage({ source: 'vaultguard-ext', requestId: d.requestId, response }, '*');
  });
});

// ── Phishing banner (direct chrome.runtime call — isolated world) ─────────────

function showPhishingBanner(domain: string) {
  if (document.getElementById('vg-phish')) return;
  const b = document.createElement('div');
  b.id = 'vg-phish';
  b.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#dc2626;color:white;' +
    'padding:12px 24px;display:flex;align-items:center;justify-content:space-between;' +
    'font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;' +
    'box-shadow:0 4px 20px rgba(220,38,38,0.5);';
  const safe = domain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  b.innerHTML =
    `<span>🚨 VaultGuard: <strong>${safe}</strong> is a known phishing site. Do NOT connect your wallet.</span>` +
    `<button onclick="this.parentElement.remove()" style="background:none;border:1px solid rgba(255,255,255,0.5);color:white;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Dismiss</button>`;
  (document.body || document.documentElement).prepend(b);
}

async function checkDomain() {
  const domain = window.location.hostname.replace(/^www\./, '');
  if (!domain || domain.startsWith('chrome') || domain === 'newtab') return;
  console.log('[VaultGuard] checking domain:', domain);
  const response = await new Promise<unknown>((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CHECK_DOMAIN', payload: { domain }, requestId: 'init' },
      resolve,
    );
  });
  const r = response as { payload?: { isPhishing: boolean } } | null;
  if (r?.payload?.isPhishing) showPhishingBanner(domain);
}

checkDomain();
