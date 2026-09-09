// VaultGuard ethereum interceptor — injected into MAIN world at document_start
// Self-contained IIFE: no imports, no external references.
(function () {
  if (window.__vg) return;
  window.__vg = true;
  window.__vgVersion = 'v6-honest';
  try { console.log('%c[VaultGuard] interceptor ' + window.__vgVersion + ' loaded', 'color:#6366f1;font-weight:bold'); } catch (e) {}

  var _counter = 0;
  var _pending = {};
  var _origin = window.location.origin;
  var _host = window.location.host;

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.source !== 'vaultguard-ext' || !d.requestId) return;
    var cb = _pending[d.requestId];
    if (cb) { delete _pending[d.requestId]; cb(d.response); }
  });

  function send(msg) {
    return new Promise(function (resolve) {
      var id = 'vg-' + (++_counter) + '-' + Date.now();
      _pending[id] = resolve;
      window.postMessage({ source: 'vaultguard-page', requestId: id, message: msg }, '*');
      setTimeout(function () {
        if (_pending[id]) { delete _pending[id]; resolve(null); }
      }, 15000);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function shortAddr(a) {
    a = String(a || '');
    return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
  }

  function riskColor(score) {
    return score >= 80 ? '#22c55e' : score >= 60 ? '#84cc16' : score >= 40 ? '#f59e0b' : '#ef4444';
  }

  function riskLabel(lvl) {
    return { SAFE: '✓ Looks Safe', LOW: '→ Low Risk', MEDIUM: '⚠ Caution', HIGH: '✗ High Risk', CRITICAL: '🚨 CRITICAL' }[lvl] || lvl;
  }

  // ── Decoding helpers for plain-message signatures ──────────────────────────
  function hexToUtf8(hex) {
    try {
      if (typeof hex !== 'string') return null;
      if (!/^0x[0-9a-fA-F]*$/.test(hex)) return hex; // already plain text
      var bytes = new Uint8Array((hex.length - 2) / 2);
      for (var i = 2, j = 0; i < hex.length; i += 2, j++) bytes[j] = parseInt(hex.substr(i, 2), 16);
      var text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return null; // binary, not text
      return text;
    } catch (e) { return null; }
  }

  // EIP-4361 Sign-In with Ethereum: "<domain> wants you to sign in with your Ethereum account:"
  function siweDomain(text) {
    if (!text) return null;
    var m = /^([^\s]+) wants you to sign in with your Ethereum account:/m.exec(text.trim());
    return m ? m[1] : null;
  }

  // ── Overlay ────────────────────────────────────────────────────────────────
  // opts: { mode: 'score' | 'notscanned' | 'unverifiable', score, level, headline,
  //         warnings, summaryHtml, meta: { usage, dashboardUrl, reviewPrompt },
  //         proceedLabel, blockLabel }
  function showOverlay(opts) {
    return new Promise(function (resolve) {
      var existing = document.getElementById('vaultguard-host');
      if (existing) existing.remove();

      var resolved = false;
      var host = document.createElement('div');
      host.id = 'vaultguard-host';
      host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;';
      var shadow = host.attachShadow({ mode: 'open' });

      function dismiss(ok) {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('popstate', onPop);
        host.remove();
        resolve(ok);
      }
      function onKey(e) { if (e.key === 'Escape') dismiss(false); }
      function onPop() { dismiss(false); }
      window.addEventListener('keydown', onKey);
      window.addEventListener('popstate', onPop);

      var warns = Array.isArray(opts.warnings) ? opts.warnings : [];
      var warnHtml = warns.map(function (w) {
        var crit = w.severity === 'CRITICAL' || w.severity === 'HIGH';
        var col = crit ? '239,68,68' : (w.severity === 'MEDIUM' ? '245,158,11' : '161,161,170');
        return '<div class="warn" style="background:rgba(' + col + ',0.1);border-color:rgba(' + col + ',0.35);">' +
          '<p class="wt" style="color:rgb(' + col + ');">' + esc(w.title) + '</p>' +
          '<p class="wd">' + esc(w.description) + '</p>' +
          (w.recommendation ? '<p class="wr"><b>Tip:</b> ' + esc(w.recommendation) + '</p>' : '') + '</div>';
      }).join('');

      var scoreBlock;
      if (opts.mode === 'score') {
        var c = riskColor(opts.score);
        scoreBlock = '<div class="scorebox"><p class="big" style="color:' + c + ';">' + opts.score + '</p>' +
          '<p class="sub">Risk Score / 100</p><p class="lbl" style="color:' + c + ';">' + riskLabel(opts.level) + '</p></div>';
      } else if (opts.mode === 'notscanned') {
        scoreBlock = '<div class="scorebox"><p class="big" style="color:#a1a1aa;">—</p>' +
          '<p class="sub">Not scanned</p><p class="lbl" style="color:#f59e0b;">' + esc(opts.headline || 'Free scan limit reached') + '</p></div>';
      } else {
        scoreBlock = '<div class="scorebox"><p class="big" style="color:#a1a1aa;">?</p>' +
          '<p class="sub">No score</p><p class="lbl" style="color:#f59e0b;">' + esc(opts.headline || "Can't be verified") + '</p></div>';
      }

      var meta = opts.meta || {};
      var usageHtml = '';
      if (meta.usage && meta.usage.limit) {
        var resets = '';
        try { resets = meta.usage.resetsAt ? new Date(meta.usage.resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; } catch (e) {}
        usageHtml = '<p class="usage">' + esc(meta.usage.used) + ' of ' + esc(meta.usage.limit) + ' free scans used this month' +
          (resets ? ' · resets ' + esc(resets) : '') +
          (meta.dashboardUrl ? ' · <a href="' + esc(meta.dashboardUrl) + '/dashboard/settings" target="_blank" rel="noopener">Upgrade</a>' : '') + '</p>';
      }

      var reviewHtml = meta.reviewPrompt
        ? '<div class="review" id="review"><p>Glad that scan helped. If VaultGuard earns a minute of your time, an honest review on the Chrome Web Store helps other people find protection before they need it. Good or bad — we read every one.</p>' +
          '<div class="rbtns"><button id="rv-leave">Leave a review</button><button id="rv-later">Maybe later</button><button id="rv-never">Don\'t ask again</button></div></div>'
        : '';

      shadow.innerHTML =
        '<style>*{box-sizing:border-box;}' +
        '#backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:all;}' +
        '#card{background:#0f0f14;border:1px solid #27272a;border-radius:16px;width:460px;max-width:96vw;max-height:86vh;overflow-y:auto;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,0.8);color:#f4f4f5;}' +
        'button{cursor:pointer;font-family:inherit;}' +
        '.hdr{display:flex;align-items:center;gap:10px;margin-bottom:18px;}' +
        '.hdr p{margin:0;}.hdr .t{font-weight:700;font-size:16px;}.hdr .o{font-size:11px;color:#71717a;word-break:break-all;}' +
        '.scorebox{text-align:center;margin-bottom:18px;padding:18px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid #27272a;}' +
        '.scorebox p{margin:0;}.big{font-size:48px;font-weight:700;line-height:1;}.sub{font-size:12px;color:#71717a;margin-top:4px!important;}.lbl{font-size:14px;font-weight:600;margin-top:8px!important;}' +
        '.warn{border:1px solid;border-radius:8px;padding:12px;margin-bottom:8px;}.warn p{margin:0;}.wt{font-weight:600;font-size:13px;margin-bottom:4px!important;}.wd{font-size:12px;color:#a1a1aa;margin-bottom:4px!important;}.wr{font-size:12px;color:#d1d5db;}' +
        '.ok{color:#22c55e;font-size:13px;margin:0 0 18px;text-align:center;}' +
        '.sec{margin:0 0 14px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid #27272a;}.sec p{margin:0;}.sech{font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px!important;}.row{font-size:12px;margin:3px 0!important;}' +
        '.msg{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#d1d5db;max-height:180px;overflow:auto;}' +
        '.usage{font-size:11px;color:#a1a1aa;text-align:center;margin:0 0 12px;}.usage a{color:#a5b4fc;}' +
        '.review{margin:0 0 14px;padding:12px;border-radius:8px;border:1px solid rgba(99,102,241,0.4);background:rgba(99,102,241,0.08);}.review p{margin:0 0 8px;font-size:12px;color:#d1d5db;}' +
        '.rbtns{display:flex;gap:6px;flex-wrap:wrap;}.rbtns button{padding:6px 10px;border-radius:6px;font-size:12px;border:1px solid #3f3f46;background:transparent;color:#d1d5db;}.rbtns #rv-leave{background:#6366f1;border-color:#6366f1;color:#fff;}' +
        '#btns{display:flex;gap:10px;margin-top:6px;}#btns button{flex:1;padding:12px;border-radius:8px;font-weight:600;font-size:14px;}' +
        '.fine{font-size:10px;color:#52525b;text-align:center;margin:12px 0 0;}' +
        '</style>' +
        '<div id="backdrop"><div id="card">' +
        '<div class="hdr"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" fill="#6366f1" opacity="0.2"/><path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" stroke="#6366f1" stroke-width="2" stroke-linejoin="round"/></svg>' +
        '<div><p class="t">VaultGuard Security Check</p><p class="o">' + esc(_origin) + '</p></div></div>' +
        scoreBlock +
        (warnHtml ? '<div>' + warnHtml + '</div>' : (opts.mode === 'score' ? '<p class="ok">✓ No threats detected</p>' : '')) +
        (opts.summaryHtml || '') +
        usageHtml + reviewHtml +
        '<div id="btns"></div>' +
        '<p class="fine">VaultGuard holds no keys and cannot sign or send. Your wallet shows the final request — read it.</p>' +
        '</div></div>';

      var backdrop = shadow.getElementById('backdrop');
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) dismiss(false); });

      var btnBlock = document.createElement('button');
      btnBlock.textContent = opts.blockLabel || 'Block';
      btnBlock.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.4);color:#ef4444;';
      btnBlock.addEventListener('click', function () { dismiss(false); });

      var btnProceed = document.createElement('button');
      var safeish = opts.mode === 'score' && opts.score >= 60;
      btnProceed.textContent = opts.proceedLabel ||
        (opts.mode === 'score'
          ? (opts.score >= 80 ? 'Looks Safe — Proceed' : opts.score >= 50 ? 'Proceed with Caution' : '⚠ Proceed Anyway')
          : opts.mode === 'notscanned' ? 'Proceed unchecked' : 'Proceed anyway');
      btnProceed.style.cssText = 'background:' + (safeish ? '#6366f1' : 'rgba(239,68,68,0.2)') + ';border:1px solid ' + (safeish ? '#6366f1' : 'rgba(239,68,68,0.4)') + ';color:#fff;';
      btnProceed.addEventListener('click', function () { dismiss(true); });

      shadow.getElementById('btns').appendChild(btnBlock);
      shadow.getElementById('btns').appendChild(btnProceed);

      if (meta.reviewPrompt) {
        var review = shadow.getElementById('review');
        function act(action) { send({ type: 'REVIEW_ACTION', payload: { action: action } }); if (review) review.remove(); }
        shadow.getElementById('rv-leave').addEventListener('click', function () { act('leave'); });
        shadow.getElementById('rv-later').addEventListener('click', function () { act('later'); });
        shadow.getElementById('rv-never').addEventListener('click', function () { act('never'); });
      }

      (document.body || document.documentElement).appendChild(host);
    });
  }

  // ── Result → overlay ───────────────────────────────────────────────────────
  function txSummary(r) {
    if (!r) return '';
    var html = '';
    var transfers = Array.isArray(r.transfers) ? r.transfers : [];
    var approvals = Array.isArray(r.approvals) ? r.approvals : [];
    if (transfers.length) {
      html += '<div class="sec"><p class="sech">Asset changes (simulated)</p>' + transfers.map(function (t) {
        var out = t.direction === 'OUT';
        return '<p class="row" style="color:' + (out ? '#ef4444' : '#22c55e') + ';">' + (out ? '↗ Send ' : '↙ Receive ') + esc(t.amountFormatted) + '</p>';
      }).join('') + '</div>';
    }
    if (approvals.length) {
      html += '<div class="sec"><p class="sech">Approvals granted</p>' + approvals.map(function (a) {
        return '<p class="row" style="color:#f59e0b;">' + esc(a.amountFormatted) + ' ' + esc(a.tokenSymbol) + ' → ' + esc(a.spenderLabel || shortAddr(a.spender)) + '</p>';
      }).join('') + '</div>';
    }
    return html;
  }

  function sigSummary(r) {
    return r && r.humanReadable
      ? '<div class="sec"><p class="sech">What you are signing</p><p class="row" style="color:#d1d5db;">' + esc(r.humanReadable) + '</p></div>'
      : '';
  }

  var UNREACHABLE = {
    severity: 'HIGH',
    title: 'Analysis unavailable',
    description: 'VaultGuard could not reach its API, so this request was NOT checked. Nothing about it has been verified.',
    recommendation: 'Wait a moment and retry, or proceed only if you fully trust this site.',
  };

  function overlayForTx(r) {
    var meta = r ? r.meta : null;
    var result = r ? r.payload : null;
    if (!result) {
      return showOverlay({ mode: 'unverifiable', headline: 'Analysis unavailable', warnings: [UNREACHABLE], meta: meta, proceedLabel: 'Proceed unchecked' });
    }
    if (result.error === 'FREE_LIMIT_REACHED') {
      return showOverlay({ mode: 'notscanned', headline: 'Free scan limit reached', warnings: result.warnings, meta: meta, proceedLabel: 'Proceed unchecked' });
    }
    return showOverlay({ mode: 'score', score: result.riskScore, level: result.riskLevel, warnings: result.warnings, summaryHtml: txSummary(result), meta: meta });
  }

  function overlayForSig(r) {
    var meta = r ? r.meta : null;
    var result = r ? r.payload : null;
    if (!result) {
      return showOverlay({ mode: 'unverifiable', headline: 'Analysis unavailable', warnings: [UNREACHABLE], meta: meta, proceedLabel: 'Sign anyway', blockLabel: 'Reject' });
    }
    return showOverlay({ mode: 'score', score: result.riskScore, level: result.riskLevel, warnings: result.warnings, summaryHtml: sigSummary(result), meta: meta, blockLabel: 'Reject', proceedLabel: result.riskScore >= 80 ? 'Looks Safe — Sign' : result.riskScore >= 50 ? 'Sign with Caution' : '⚠ Sign Anyway' });
  }

  // ── Plain-message signatures (personal_sign / eth_sign / typed v1) ────────
  // These carry no structure VaultGuard can score. Sign-in messages for THIS
  // site pass silently; everything else is shown undecoded with an honest "no score".
  function handlePersonalSign(orig, args, params) {
    var p0 = params[0], p1 = params[1];
    var raw = (typeof p0 === 'string' && /^0x[0-9a-fA-F]{40}$/.test(p0)) ? p1 : p0;
    var text = hexToUtf8(raw);
    var siwe = siweDomain(text);
    if (siwe && siwe.toLowerCase() === _host.toLowerCase()) return orig(args);

    var warnings = [];
    var headline;
    if (siwe) {
      headline = 'Sign-in domain mismatch';
      warnings.push({
        severity: 'CRITICAL',
        title: 'Sign-in request for a different site',
        description: 'This message asks you to sign in to "' + siwe + '", but you are on "' + _host + '". Phishing pages relay real sign-in requests to hijack your session somewhere else.',
        recommendation: 'Reject. Sign in to ' + siwe + ' only when you are on ' + siwe + '.',
      });
    } else {
      headline = 'Plain-message signature';
      warnings.push({
        severity: 'HIGH',
        title: "VaultGuard can't verify plain-message signatures",
        description: 'This is a raw message signature (personal_sign). Most are harmless sign-in or verification requests, but VaultGuard cannot tell a safe one from a malicious one, so it will not give it a score.',
        recommendation: 'Read the message below. If it is not clearly a sign-in you started, reject.',
      });
    }
    var summary = text
      ? '<div class="sec"><p class="sech">Message you are asked to sign</p><pre class="msg">' + esc(text.slice(0, 800)) + (text.length > 800 ? '…' : '') + '</pre></div>'
      : '<div class="sec"><p class="row">The message is not readable text (' + esc(String(raw).slice(0, 24)) + '…). Treat that as a red flag.</p></div>';
    return showOverlay({ mode: 'unverifiable', headline: headline, warnings: warnings, summaryHtml: summary, blockLabel: 'Reject', proceedLabel: siwe ? '⚠ Sign anyway' : 'Sign' })
      .then(function (ok) { if (!ok) throw new Error('VaultGuard blocked this signature'); return orig(args); });
  }

  function handleRawSign(orig, args, kind, params) {
    var warnings, summary = '';
    if (kind === 'eth_sign') {
      warnings = [{
        severity: 'CRITICAL',
        title: 'eth_sign requested',
        description: 'eth_sign signs arbitrary bytes with no readable message — including, potentially, a transaction that drains your wallet. Almost no legitimate site needs it.',
        recommendation: 'Reject unless you know exactly why this site needs eth_sign.',
      }];
    } else {
      warnings = [{
        severity: 'HIGH',
        title: 'Legacy typed-data signature (v1)',
        description: 'This uses the old eth_signTypedData format, which VaultGuard cannot decode into a score.',
        recommendation: 'Review the raw values below. If you did not start this, reject.',
      }];
      try { summary = '<div class="sec"><p class="sech">Raw values</p><pre class="msg">' + esc(JSON.stringify(params[0], null, 1).slice(0, 800)) + '</pre></div>'; } catch (e) {}
    }
    return showOverlay({ mode: 'unverifiable', headline: kind === 'eth_sign' ? 'Raw eth_sign' : 'Legacy typed data', warnings: warnings, summaryHtml: summary, blockLabel: 'Reject', proceedLabel: '⚠ Sign anyway' })
      .then(function (ok) { if (!ok) throw new Error('VaultGuard blocked this signature'); return orig(args); });
  }

  // ── Interception via a transparent Proxy ────────────────────────────────────
  // We hand the page a Proxy of the wallet provider that overrides ONLY `request`.
  // The real provider object is never mutated (reassigning its `request` is what
  // wedges modern MetaMask), and every other member is bound to the real target so
  // the provider's private class fields keep working. Arguments are forwarded
  // untouched — VaultGuard never rewrites a request.
  function wrapRequest(target) {
    var orig = target.request.bind(target);
    return function (args) {
      var method = args && args.method;
      var params = args && args.params;

      if (method === 'eth_sendTransaction' && params && params[0]) {
        var _tx = params[0];
        // A raw eth_sendTransaction has no chainId (the wallet implies it), but the
        // API requires one — so resolve the connected chain first, then simulate.
        var _getChain = orig({ method: 'eth_chainId' }).then(
          function (cid) { var n = parseInt(cid, 16); return n > 0 ? n : 1; },
          function () { return 1; }
        );
        return _getChain.then(function (chainId) {
          return send({ type: 'SIMULATE_TRANSACTION', payload: {
            transaction: { chainId: chainId, from: _tx.from, to: _tx.to, value: _tx.value, data: _tx.data },
            origin: _origin,
          } });
        }).then(function (r) {
          return overlayForTx(r).then(function (ok) {
            if (!ok) throw new Error('VaultGuard blocked this transaction');
            return orig(args);
          });
        });
      }

      if ((method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') && params && params[1]) {
        var td;
        try { td = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]; } catch (e) { return orig(args); }
        return send({ type: 'SIGNATURE_DETECTED', payload: { typedData: td, origin: _origin } }).then(function (r) {
          return overlayForSig(r).then(function (ok) {
            if (!ok) throw new Error('VaultGuard blocked this signature');
            return orig(args);
          });
        });
      }

      if (method === 'personal_sign' && params && params.length) {
        return handlePersonalSign(orig, args, params);
      }
      if (method === 'eth_sign' && params && params.length) {
        return handleRawSign(orig, args, 'eth_sign', params);
      }
      if (method === 'eth_signTypedData' && params && params.length) {
        return handleRawSign(orig, args, 'typed-v1', params);
      }

      return orig(args);
    };
  }

  var _wrapCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function wrapProvider(provider) {
    if (!provider || typeof provider.request !== 'function') return provider;
    if (provider.__vgProxy) return provider; // already one of ours
    if (_wrapCache && _wrapCache.has(provider)) return _wrapCache.get(provider);
    var wrapped;
    try { wrapped = wrapRequest(provider); } catch (e) { return provider; }
    var proxy;
    try {
      proxy = new Proxy(provider, {
        get: function (target, prop) {
          if (prop === 'request') return wrapped;
          if (prop === '__vgProxy') return true;
          var v = target[prop];
          return (typeof v === 'function') ? v.bind(target) : v;
        },
        set: function (target, prop, value) { target[prop] = value; return true; },
      });
    } catch (e) {
      return provider; // Proxy unsupported — no interception, but never break the wallet
    }
    if (_wrapCache) { try { _wrapCache.set(provider, proxy); } catch (e) {} }
    return proxy;
  }

  var _real = window.ethereum || null;
  var _proxy = _real ? wrapProvider(_real) : null;

  // Own window.ethereum so the page always receives the wrapped provider, no matter
  // when MetaMask injects. The setter ONLY stores the provider and builds the Proxy —
  // it never mutates the provider, so it cannot wedge MetaMask's startup.
  try {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get: function () { return _proxy || _real; },
      set: function (val) { _real = val; _proxy = wrapProvider(val); },
    });
  } catch (e) {
    // window.ethereum already present and locked — nothing more we can safely do.
  }

  // ── EIP-6963 interception ───────────────────────────────────────────────────
  // Modern dApps (Uniswap, etc.) discover wallets via `eip6963:announceProvider`
  // events and use the RAW provider from the event detail, bypassing window.ethereum.
  // We intercept the wallet's announcement and re-announce our wrapped provider, so
  // those dApps route transactions through us too. (detail is frozen, so we can't
  // mutate it — we dispatch a replacement event with the same info.)
  try {
    var _origDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = function (event) {
      try {
        if (event && event.type === 'eip6963:announceProvider' &&
            event.detail && event.detail.provider && !event.detail.provider.__vgProxy) {
          var wrapped = wrapProvider(event.detail.provider);
          if (wrapped !== event.detail.provider) {
            return _origDispatch(new CustomEvent('eip6963:announceProvider', {
              detail: Object.freeze({ info: event.detail.info, provider: wrapped }),
            }));
          }
        }
      } catch (e) { /* fall through to the original dispatch */ }
      return _origDispatch(event);
    };
  } catch (e) { /* couldn't hook dispatchEvent — window.ethereum path still covers legacy dApps */ }
})();
