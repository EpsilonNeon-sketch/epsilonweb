(function () {
  'use strict';

  // ─── Site name guard ───────────────────────────────────────
  if (!window.sn || typeof window.sn !== 'string') {
    console.warn('[Epsilon Ext] No window.sn set — extension loader disabled.');
    return;
  }

  // ─── Config (overridable via window.EPSILON_EXT_URL) ──────
  var EXT_JSON_URL = window.EPSILON_EXT_URL || 'https://e-psilon.vercel.app/ext.json';

  var injectedButtons = [];
  var initStarted = false;

  // ─── Helpers ───────────────────────────────────────────────
  // Wait for the host page to create window.supabaseClient.
  // Each Epsilon site creates its own client with a site-specific
  // storageKey (e.g. 'epsports', 'epeditz', 'ephub'); the loader
  // reuses that exact client so sessions stay scoped per site.
  function waitForSupabaseClient(timeout) {
    timeout = timeout || 15000;
    return new Promise(function (resolve, reject) {
      if (window.supabaseClient) return resolve(window.supabaseClient);
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (window.supabaseClient) { clearInterval(iv); resolve(window.supabaseClient); }
        else if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          reject(new Error('Timed out waiting for window.supabaseClient. Make sure your site creates it before/at DOMContentLoaded.'));
        }
      }, 80);
    });
  }

  function fetchProfileExtensions(supabase) {
    return supabase.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session || !session.user) return [];
      return supabase
        .from('profiles')
        .select('extensions')
        .eq('id', session.user.id)
        .single()
        .then(function (res) {
          if (res.error) {
            // Likely the column doesn't exist yet — fail gracefully
            console.warn('[Epsilon Ext] Could not read extensions:', res.error.message);
            return [];
          }
          var exts = res.data && res.data.extensions;
          return Array.isArray(exts) ? exts : [];
        });
    });
  }

  function fetchExtJson() {
    // Cache-bust so developers see new extensions immediately
    return fetch(EXT_JSON_URL + '?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return Array.isArray(data) ? data : [];
      });
  }

  // ─── UI: nav-button bar (bottom-left, stacked) ─────────────
  function getButtonContainer() {
    var bar = document.getElementById('epsilon-ext-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'epsilon-ext-bar';
    bar.style.cssText = [
      'position:fixed',
      'bottom:1.5rem',
      'left:1.5rem',
      'z-index:9998',
      'display:flex',
      'flex-direction:column',
      'gap:.5rem',
      'pointer-events:none', // children re-enable themselves
      'max-width:240px'
    ].join(';');
    document.body.appendChild(bar);
    return bar;
  }

  function injectNavButton(ext) {
    // Avoid double-injecting the same extension
    for (var i = 0; i < injectedButtons.length; i++) {
      if (injectedButtons[i].dataset.extName === ext.name &&
          injectedButtons[i].dataset.extSite === ext.site) return;
    }

    var bar = getButtonContainer();
    var btn = document.createElement('button');
    btn.className = 'epsilon-ext-nav-btn';
    btn.dataset.extName = ext.name;
    btn.dataset.extSite = ext.site;

    var label = ext.nav_btn || ext.nav_bar || ext.name || 'Extension';

    var iconHtml = ext.icon
      ? '<img src="' + ext.icon + '" alt="" style="width:18px;height:18px;border-radius:4px;object-fit:cover" onerror="this.style.display=\'none\'">'
      : '';
    btn.innerHTML = iconHtml + '<span>' + escapeHtml(label) + '</span>';

    btn.style.cssText = [
      'pointer-events:auto',
      'display:inline-flex',
      'align-items:center',
      'gap:.45rem',
      'padding:.55rem .9rem',
      'border-radius:.6rem',
      'background:rgba(20,20,30,.92)',
      'backdrop-filter:blur(12px)',
      '-webkit-backdrop-filter:blur(12px)',
      'border:1px solid rgba(139,92,246,.3)',
      'color:#e4e4e7',
      'font-size:.82rem',
      'font-weight:600',
      'font-family:Inter,system-ui,-apple-system,sans-serif',
      'cursor:pointer',
      'transition:transform .18s ease, background .18s ease, box-shadow .18s ease',
      'box-shadow:0 4px 16px rgba(0,0,0,.35)',
      'max-width:240px',
      'overflow:hidden'
    ].join(';');

    btn.addEventListener('mouseenter', function () {
      btn.style.background = 'rgba(139,92,246,.22)';
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 6px 22px rgba(139,92,246,.4)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = 'rgba(20,20,30,.92)';
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 4px 16px rgba(0,0,0,.35)';
    });
    btn.addEventListener('click', function () { openExtensionModal(ext); });

    bar.appendChild(btn);
    injectedButtons.push(btn);
  }

  // ─── UI: near-fullscreen modal ────────────────────────────
  function openExtensionModal(ext) {
    // Remove any stale modal first
    var existing = document.getElementById('epsilon-ext-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'epsilon-ext-modal';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:100000',
      'background:rgba(0,0,0,.72)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:1.5rem',
      'opacity:0',
      'transition:opacity .25s ease'
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#ffffff',
      'border-radius:1rem',
      'width:92vw',
      'max-width:1400px',
      'height:88vh',
      'max-height:900px',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column',
      'box-shadow:0 24px 80px rgba(0,0,0,.55)',
      'transform:scale(.96)',
      'transition:transform .25s cubic-bezier(.22,1,.36,1)'
    ].join(';');

    // Header
    var header = document.createElement('div');
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:.85rem 1.1rem',
      'background:#f8f8f8',
      'border-bottom:1px solid #e5e5e5',
      'flex-shrink:0'
    ].join(';');

    var headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:.65rem;min-width:0;flex:1';
    var iconHtml = ext.icon
      ? '<img src="' + ext.icon + '" alt="" style="width:26px;height:26px;border-radius:5px;object-fit:cover" onerror="this.style.display=\'none\'">'
      : '';
    headerLeft.innerHTML = iconHtml +
      '<div style="min-width:0">' +
        '<div style="font-size:.92rem;font-weight:700;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(ext.name || 'Extension') + '</div>' +
        '<div style="font-size:.7rem;color:#666">by ' + escapeHtml(ext.author || 'Unknown') + ' · ' + escapeHtml(ext.site || '') + '</div>' +
      '</div>';

    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="display:block"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    closeBtn.style.cssText = [
      'width:34px',
      'height:34px',
      'border-radius:50%',
      'border:none',
      'background:#eee',
      'color:#333',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'flex-shrink:0',
      'transition:background .15s'
    ].join(';');
    closeBtn.addEventListener('mouseenter', function () { closeBtn.style.background = '#ddd'; });
    closeBtn.addEventListener('mouseleave', function () { closeBtn.style.background = '#eee'; });

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);

    // Iframe wrapper
    var iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#fff';

    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block';
    iframe.setAttribute('title', ext.name || 'Extension');
    // Sandbox: allow scripts & forms, but isolate from host
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin');

    var html = ext.html;
    if (typeof html !== 'string' || html.trim() === '') {
      html = '<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;padding:2rem;color:#666"><p>No content provided for this extension.</p></body></html>';
    }
    // If the extension HTML doesn't start with a full document, wrap it
    if (!/<html[\s>]/i.test(html)) {
      html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,-apple-system,sans-serif;margin:0;padding:1.25rem;color:#111;background:#fff}</style></head><body>' + html + '</body></html>';
    }
    iframe.srcdoc = html;

    iframeWrap.appendChild(iframe);

    box.appendChild(header);
    box.appendChild(iframeWrap);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
      box.style.transform = 'scale(1)';
    });

    // Close handlers
    function close() {
      overlay.style.opacity = '0';
      box.style.transform = 'scale(.96)';
      setTimeout(function () { overlay.remove(); }, 250);
    }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    var escHandler = function (e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  // ─── Tiny HTML escaper ────────────────────────────────────
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Main init ────────────────────────────────────────────
  function init() {
    if (initStarted) return;
    initStarted = true;

    waitForSupabaseClient()
      .then(fetchProfileExtensions)
      .then(function (enabledExts) {
        if (!enabledExts || enabledExts.length === 0) return [];

        // Keep only extensions for THIS site
        var siteExts = enabledExts.filter(function (e) {
          return e && e.site === window.sn && e.name;
        });
        if (siteExts.length === 0) return [];

        // Fetch full data from ext.json
        return fetchExtJson().then(function (allExts) {
          var matched = [];
          for (var i = 0; i < siteExts.length; i++) {
            var enabled = siteExts[i];
            var full = null;
            for (var j = 0; j < allExts.length; j++) {
              if (allExts[j].name === enabled.name && allExts[j].site === enabled.site) {
                full = allExts[j];
                break;
              }
            }
            if (full) {
              matched.push(full);
            } else {
              console.warn('[Epsilon Ext] Extension "' + enabled.name + '" not found in ext.json (site=' + enabled.site + '). It may have been removed.');
            }
          }
          return matched;
        });
      })
      .then(function (matched) {
        if (!matched || matched.length === 0) return;
        for (var i = 0; i < matched.length; i++) {
          injectNavButton(matched[i]);
        }
      })
      .catch(function (err) {
        console.error('[Epsilon Ext] Loader error:', err && err.message ? err.message : err);
      });
  }

  // ─── Boot ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Defer slightly so any inline supabaseClient creation finishes first
    setTimeout(init, 0);
  }

  // ─── Re-check when auth state changes (sign in / sign out) ─
  // Wait for the host page's supabaseClient, then attach the listener.
  waitForSupabaseClient().then(function (sb) {
    if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
      sb.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_IN') {
          // Wipe stale buttons and re-init
          injectedButtons.forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
          injectedButtons = [];
          initStarted = false;
          init();
        } else if (event === 'SIGNED_OUT') {
          injectedButtons.forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
          injectedButtons = [];
        }
      });
    }
  }).catch(function (err) {
    console.warn('[Epsilon Ext]', err && err.message ? err.message : err);
  });

})();
