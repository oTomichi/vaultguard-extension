# VaultGuard — browser extension (public source)

This is the source of the VaultGuard Chrome extension, published so you can read what runs in your
browser instead of trusting a store listing. It mirrors `apps/extension` in our private monorepo; each
store release is tagged here with the same version number.

- **Store listing:** https://chromewebstore.google.com/detail/imadlfaempmcofkekgjinkcbhddkpnmg
- **Dashboard, docs, privacy policy:** https://vaultguard-web.vercel.app

## What it does

Before your wallet asks you to sign, VaultGuard intercepts the request, sends the transaction (or the
EIP-712 typed data) plus the page's origin to our API, and shows a 0–100 risk score with the specific
reasons: unlimited approvals, Permit / Permit2 signatures and who they hand allowance to, addresses on
drainer / scam / sanctions lists, known phishing domains, brand-new contracts, failed simulations, and
assets leaving your wallet with nothing coming back. You then click Block or Proceed.

Plain-message signatures (`personal_sign`, `eth_sign`) cannot be scored; the extension shows you the
message and says so. Sign-in messages for the site you are on pass silently; sign-in messages that name
a *different* site are flagged.

## What it cannot do — by construction

- It holds no keys. It cannot sign, cannot send, and never sees a seed phrase.
- It never rewrites a request. The wallet provider is wrapped in a `Proxy` whose only override is
  `request`; arguments are forwarded untouched, and your wallet still shows you the final request.
- It never blocks on its own. Every "Block" is a click you made.
- It does not catch everything. A drainer that is not on any list yet can score higher than it should.

## Where to look

| File | Role |
|---|---|
| `scripts/vaultguard-main.js` | **Start here.** The MAIN-world interceptor: provider proxy, EIP-6963 re-announce, and the overlay. Plain JavaScript, no build step, copied verbatim into the bundle. |
| `src/contents/messageBridge.ts` | Isolated-world relay between the page and the service worker, plus the page-load phishing banner. |
| `src/background/index.ts` | Service worker: API calls, result cache, usage counter, review-prompt policy. |
| `src/popup.tsx` | The toolbar popup. |
| `src/types/shared.ts` | Type definitions shared with the API (vendored copy of `@vaultguard/shared`). |

## Permissions, and why

| Permission | Why |
|---|---|
| `host_permissions: <all_urls>` and a content script on every site | Wallet requests happen on any site, including ones that do not exist yet. To see the request before the wallet prompt, the interceptor has to be present on every page. This is the same permission a malicious wallet-interception extension would ask for — which is exactly why this source is public. |
| `scripting` | Registers the MAIN-world interceptor (`chrome.scripting.registerContentScripts`) and drives the Panic Button banner. |
| `storage` | Your dashboard session token (if you signed in), the usage counter, and the review-prompt state. |
| `activeTab` | Reads the current tab's hostname for the popup. |

## What leaves your browser

- On a transaction or typed-data signature: the request itself (chain, from, to, value, calldata or
  typed data) and the page origin, sent to the VaultGuard API.
- On page load: the hostname of the page, for the phishing check.
- Nothing else. No page contents, no form inputs, no browsing history beyond those hostnames, and never
  keys. The API does not request-log. Full text: the privacy policy linked above.

## Verify the store build yourself

The interceptor is copied into the bundle byte-for-byte, so you can diff it against what Chrome runs:

1. Find the installed extension folder: `chrome://version` → Profile Path →
   `Extensions/imadlfaempmcofkekgjinkcbhddkpnmg/<version>/`.
2. Diff that folder's `vaultguard-main.js` against `scripts/vaultguard-main.js` at the tag matching
   the version. Expect no output.

Or build it: `npm install`, copy `.env.example` to `.env`, `npm run build` → `build/chrome-mv3-prod/`.
Plasmo bundles the TypeScript, so compare behaviour and the interceptor rather than expecting identical
file hashes.

## Reporting problems

See `SECURITY.md`. Missed threats and wrong scores are the reports we want most.

## License

MIT. The scoring API and the dashboard are separate, private services; this repository is the
extension only.
