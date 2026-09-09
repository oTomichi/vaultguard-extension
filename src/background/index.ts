import type {
  ExtensionMessage,
  SimulationResult,
  SignatureAnalysis,
  RawTransaction,
  TypedDataMessage,
} from '@vaultguard/shared';

const API_URL = process.env.PLASMO_PUBLIC_API_URL ?? 'https://api.vaultguard.xyz';
const DASHBOARD_URL = process.env.PLASMO_PUBLIC_DASHBOARD_URL ?? 'https://app.vaultguard.xyz';
const STORE_REVIEW_URL = 'https://chromewebstore.google.com/detail/imadlfaempmcofkekgjinkcbhddkpnmg/reviews';
const CACHE_TTL = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

interface UsageInfo {
  tier: string;
  used: number;
  limit: number | null;
  resetsAt?: string;
}

interface ReviewState {
  prompts: number;
  lastAt: number;
  never: boolean;
  snoozeUntil: number;
}

const domainCache = new Map<string, { isPhishing: boolean; ts: number }>();
const simCache = new Map<string, { result: SimulationResult; usage?: UsageInfo; ts: number }>();

// Register the MAIN-world ethereum interceptor on install/update.
// Must be inside onInstalled (not top-level) so it never throws during SW activation.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['vg-main'] });
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([{
        id: 'vg-main',
        js: ['vaultguard-main.js'],
      }]);
    } else {
      await chrome.scripting.registerContentScripts([{
        id: 'vg-main',
        js: ['vaultguard-main.js'],
        matches: ['<all_urls>'],
        world: 'MAIN',
        runAt: 'document_start',
      }]);
    }
    console.log('[VaultGuard BG] main-world script registered');
  } catch (err) {
    console.error('[VaultGuard BG] registerContentScripts failed:', err);
  }
});

function getLocal<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r as T)));
}

function setLocal(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}

async function getAuthToken(): Promise<string | null> {
  const r = await getLocal<{ vaultguard_token?: string }>(['vaultguard_token']);
  return r.vaultguard_token ?? null;
}

async function checkDomain(domain: string): Promise<{ isPhishing: boolean; riskScore: number }> {
  const now = Date.now();
  const cached = domainCache.get(domain);
  if (cached && now - cached.ts < CACHE_TTL) return { isPhishing: cached.isPhishing, riskScore: cached.isPhishing ? 0 : 90 };
  try {
    const resp = await fetch(`${API_URL}/api/check-domain?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await resp.json()) as { isPhishing: boolean; riskScore: number };
    domainCache.set(domain, { isPhishing: data.isPhishing, ts: now });
    return data;
  } catch {
    return { isPhishing: false, riskScore: 90 };
  }
}

async function simulateTransaction(
  tx: RawTransaction,
  origin?: string,
): Promise<{ result: SimulationResult | null; usage?: UsageInfo }> {
  // Key on the FULL calldata. A prefix key let approve(x, 1) mask a later approve(x, MAX).
  const key = [tx.chainId, tx.from, tx.to, tx.value ?? '0x0', tx.data ?? '0x', origin ?? '']
    .join('|')
    .toLowerCase();
  const now = Date.now();
  const cached = simCache.get(key);
  if (cached && now - cached.ts < CACHE_TTL) return { result: cached.result, usage: cached.usage };

  const token = await getAuthToken();
  try {
    const resp = await fetch(`${API_URL}/api/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        chainId: tx.chainId,
        from: tx.from,
        to: tx.to,
        value: tx.value ?? '0x0',
        data: tx.data ?? '0x',
        ...(origin ? { origin } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await resp.json()) as { success: boolean; data?: SimulationResult; usage?: UsageInfo };
    if (json.success && json.data) {
      if (json.usage) await setLocal({ vg_usage: { ...json.usage, at: now } });
      // Never cache the limit-reached placeholder — the user may upgrade mid-session.
      if (!json.data.error) simCache.set(key, { result: json.data, usage: json.usage, ts: now });
      return { result: json.data, usage: json.usage };
    }
  } catch (err) {
    console.error('[VaultGuard] Simulation failed:', err);
  }
  return { result: null };
}

async function analyzeSignature(typedData: TypedDataMessage): Promise<SignatureAnalysis | null> {
  try {
    const resp = await fetch(`${API_URL}/api/analyze-signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typedData),
      signal: AbortSignal.timeout(6000),
    });
    const json = (await resp.json()) as { success: boolean; data?: SignatureAnalysis };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Review prompt policy: only after the user's 3rd SAFE scan, at most twice ever,
 * the second at least 14 days later, never within 72h of a HIGH/CRITICAL flag,
 * never on install, never at the paywall, never with an incentive.
 */
async function noteResultAndMaybePrompt(result: SimulationResult | SignatureAnalysis | null): Promise<boolean> {
  if (!result) return false;
  const now = Date.now();
  const s = await getLocal<{ vg_safe_scans?: number; vg_review?: ReviewState; vg_last_critical?: number }>([
    'vg_safe_scans', 'vg_review', 'vg_last_critical',
  ]);
  const review: ReviewState = s.vg_review ?? { prompts: 0, lastAt: 0, never: false, snoozeUntil: 0 };

  if (result.riskLevel === 'CRITICAL' || result.riskLevel === 'HIGH') {
    await setLocal({ vg_last_critical: now });
    return false;
  }
  if (result.riskLevel !== 'SAFE' || ('error' in result && result.error)) return false;

  const safe = (s.vg_safe_scans ?? 0) + 1;
  await setLocal({ vg_safe_scans: safe });

  if (review.never || review.prompts >= 2) return false;
  if (safe < 3) return false;
  if (now < review.snoozeUntil) return false;
  if (review.prompts === 1 && now - review.lastAt < 14 * DAY_MS) return false;
  if (now - (s.vg_last_critical ?? 0) < 3 * DAY_MS) return false;

  await setLocal({ vg_review: { ...review, prompts: review.prompts + 1, lastAt: now } });
  return true;
}

async function handleReviewAction(action: string): Promise<void> {
  const s = await getLocal<{ vg_review?: ReviewState }>(['vg_review']);
  const review: ReviewState = s.vg_review ?? { prompts: 1, lastAt: Date.now(), never: false, snoozeUntil: 0 };
  if (action === 'leave') {
    chrome.tabs.create({ url: STORE_REVIEW_URL });
    await setLocal({ vg_review: { ...review, never: true } });
  } else if (action === 'later') {
    await setLocal({ vg_review: { ...review, snoozeUntil: Date.now() + 30 * DAY_MS } });
  } else if (action === 'never') {
    await setLocal({ vg_review: { ...review, never: true } });
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    const handle = async () => {
      switch (message.type) {
        case 'CHECK_DOMAIN': {
          const domain = (message.payload as { domain: string }).domain;
          const result = await checkDomain(domain);
          return { type: 'DOMAIN_RESULT', payload: result, requestId: message.requestId };
        }
        case 'SIMULATE_TRANSACTION': {
          const { transaction, origin } = message.payload as { transaction: RawTransaction; origin?: string };
          const { result, usage } = await simulateTransaction(transaction, origin);
          const reviewPrompt = await noteResultAndMaybePrompt(result);
          return {
            type: 'SIMULATION_RESULT',
            payload: result,
            meta: { usage: usage ?? null, dashboardUrl: DASHBOARD_URL, reviewPrompt },
            requestId: message.requestId,
          };
        }
        case 'SIGNATURE_DETECTED': {
          const td = (message.payload as { typedData: TypedDataMessage }).typedData;
          const result = await analyzeSignature(td);
          const reviewPrompt = await noteResultAndMaybePrompt(result);
          return {
            type: 'SIMULATION_RESULT',
            payload: result,
            meta: { usage: null, dashboardUrl: DASHBOARD_URL, reviewPrompt },
            requestId: message.requestId,
          };
        }
        case 'REVIEW_ACTION': {
          await handleReviewAction((message.payload as { action: string }).action);
          return { type: 'STATUS_RESPONSE', payload: { ok: true }, requestId: message.requestId };
        }
        case 'GET_STATUS': {
          const token = await getAuthToken();
          const s = await getLocal<{ vg_usage?: UsageInfo & { at: number } }>(['vg_usage']);
          return {
            type: 'STATUS_RESPONSE',
            payload: { isAuthenticated: !!token, apiUrl: API_URL, dashboardUrl: DASHBOARD_URL, usage: s.vg_usage ?? null },
          };
        }
        default:
          return null;
      }
    };

    handle().then(sendResponse).catch((err) => {
      console.error('[VaultGuard BG]', err);
      sendResponse(null);
    });
    return true;
  },
);
