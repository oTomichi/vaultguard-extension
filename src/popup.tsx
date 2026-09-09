import React, { useEffect, useState } from 'react';

interface Usage {
  tier: string;
  used: number;
  limit: number | null;
  resetsAt?: string;
  at?: number;
}

interface Status {
  isAuthenticated: boolean;
  apiUrl: string;
  dashboardUrl?: string;
  usage?: Usage | null;
}

const DASHBOARD_URL = process.env.PLASMO_PUBLIC_DASHBOARD_URL ?? 'https://app.vaultguard.xyz';

function resetLabel(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return '';
  }
}

export default function Popup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [domain, setDomain] = useState('unknown');

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url) {
        try {
          setDomain(new URL(tab.url).hostname.replace(/^www\./, ''));
        } catch { /* ignore */ }
      }
    });

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response: { payload: Status }) => {
      if (response?.payload) setStatus(response.payload);
    });
  }, []);

  const dashboardUrl = status?.dashboardUrl ?? DASHBOARD_URL;
  const openDashboard = (path = '') => {
    chrome.tabs.create({ url: `${dashboardUrl}${path}` });
  };

  const panicMode = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const banner = document.createElement('div');
          banner.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#dc2626;color:white;padding:14px;text-align:center;font-weight:600;font-family:sans-serif;font-size:14px;';
          banner.textContent =
            '🚨 VaultGuard Panic Mode: stop. Disconnect your wallet from this site, then review your approvals in the dashboard.';
          document.body.prepend(banner);
        },
      });
    });
  };

  const s = {
    root: {
      width: 320,
      minHeight: 460,
      background: '#0f0f14',
      color: '#f4f4f5',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    } as React.CSSProperties,
    header: {
      background: '#1a1a2e',
      padding: '16px 20px',
      borderBottom: '1px solid #27272a',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    } as React.CSSProperties,
    card: {
      background: '#18181b',
      borderRadius: 10,
      padding: 14,
      marginBottom: 14,
      border: '1px solid #27272a',
    } as React.CSSProperties,
    label: { margin: '0 0 8px', fontSize: 11, color: '#71717a', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
    btn: (primary: boolean) => ({
      width: '100%',
      padding: '11px 16px',
      background: primary ? '#6366f1' : 'rgba(239,68,68,0.1)',
      color: primary ? 'white' : '#ef4444',
      border: primary ? 'none' : '1px solid rgba(239,68,68,0.4)',
      borderRadius: 8,
      fontWeight: 600,
      fontSize: 13,
      cursor: 'pointer',
      marginBottom: 8,
    } as React.CSSProperties),
    link: {
      background: 'none',
      border: 'none',
      color: '#a5b4fc',
      fontSize: 12,
      cursor: 'pointer',
      padding: 0,
      marginTop: 6,
    } as React.CSSProperties,
  };

  const usage = status?.usage ?? null;
  const isFree = !usage || usage.tier === 'FREE';

  return (
    <div style={s.root}>
      <div style={s.header}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" fill="#6366f1" opacity="0.3" />
          <path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>VaultGuard</p>
          <p style={{ margin: 0, fontSize: 11, color: '#71717a' }}>Crypto Transaction Shield</p>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <div style={s.card}>
          <p style={s.label}>Current Site</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 13, color: '#d1d5db' }}>{domain}</p>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
              background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)',
            }}>✓ Monitoring</span>
          </div>
        </div>

        <div style={s.card}>
          <p style={s.label}>Plan &amp; usage</p>
          {usage && usage.limit ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>
                {usage.used} of {usage.limit} free scans used this month
              </p>
              {usage.resetsAt && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#71717a' }}>Resets {resetLabel(usage.resetsAt)}</p>
              )}
              <button style={s.link} onClick={() => openDashboard('/dashboard/settings')}>
                Upgrade for unlimited scans →
              </button>
            </>
          ) : usage && !isFree ? (
            <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{usage.tier} plan — unlimited scans</p>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: '#a1a1aa' }}>
              Free plan: 5 transaction scans per month. Your count appears here after the first scan.
            </p>
          )}
        </div>

        <div style={s.card}>
          <p style={s.label}>Protection Status</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
            <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>Transaction interceptor active</p>
          </div>
          {!status?.isAuthenticated && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#f59e0b' }}>
              ⚠ Sign in on the dashboard to link your plan
            </p>
          )}
        </div>

        <button onClick={() => openDashboard('/dashboard')} style={s.btn(true)}>Open Security Dashboard →</button>
        <button onClick={panicMode} style={s.btn(false)}>🚨 Panic Button — Stop &amp; Disconnect</button>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid #27272a', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#52525b' }}>VaultGuard holds no keys and cannot sign or send</p>
      </div>
    </div>
  );
}
