const CACHE_NAME = 'epsilonapp';

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json'
];

// Strictly versioned immutable CDN endpoints
const CDN_CACHE = [
  'https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
];

// Install: pre-cache the shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('Precache skipped core resource:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass non-GET operations (Supabase mutations, metrics tracking, etc)
  if (event.request.method !== 'GET') {
    return;
  }

  // 1. Supabase API calls: network-first
  if (url.hostname === 'gfsqzkyviivhvyqadpeg.supabase.co') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 2. PeerJS signaling: network-only
  if (url.hostname.includes('peerjs.com') || url.pathname.includes('/peerjs')) {
    return;
  }

  // 3. Immutable Versioned CDN scripts: cache-first with long TTL
  if (CDN_CACHE.some((cdn) => event.request.url === cdn)) {
    event.respondWith(cacheFirst(event.request, 7 * 24 * 60 * 60)); // 7 days
    return;
  }

  // 4. Mutable CDNs (Unversioned/Dynamic): Stale-While-Revalidate to ensure quick updates
  if (
    url.hostname === 'cdn.tailwindcss.com' ||
    url.href.includes('@supabase/supabase-js') ||
    url.href.includes('lucide@latest')
  ) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 5. Images: cache-first, short TTL
  if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request, 24 * 60 * 60)); // 1 day
    return;
  }

  // 6. Google Fonts: cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, 30 * 24 * 60 * 60)); // 30 days
    return;
  }

  // 7. Navigation / HTML: stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 8. Everything else: network-first
  event.respondWith(networkFirst(event.request));
});

/**
 * Cache-first fallback strategy with TTL checks
 */
async function cacheFirst(request, maxAgeSeconds) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    const dateHeader = cachedResponse.headers.get('sw-cache-time');
    if (dateHeader) {
      const age = (Date.now() - parseInt(dateHeader, 10)) / 1000;
      if (age < maxAgeSeconds) {
        return cachedResponse;
      }
      // Outdated entry: refresh in the background, return old data for speed
      fetchAndCache(request, cache).catch(() => null);
      return cachedResponse;
    }
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseToCache = await cloneWithTimestamp(networkResponse);
      await cache.put(request, responseToCache);
    }
    return networkResponse;
  } catch (err) {
    if (request.mode === 'navigate') {
      return new Response(offlinePage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }
}

/**
 * Network-first strategy with cache backup
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseToCache = await cloneWithTimestamp(networkResponse);
      await cache.put(request, responseToCache);
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    if (request.mode === 'navigate') {
      return new Response(offlinePage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }
}

/**
 * Stale-while-revalidate implementation
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetchAndCache(request, cache);

  if (cachedResponse) return cachedResponse;
  return fetchPromise;
}

/**
 * Isolated logic to update cache entries cleanly
 */
async function fetchAndCache(request, cache) {
  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    const responseToCache = await cloneWithTimestamp(networkResponse);
    await cache.put(request, responseToCache);
  }
  return networkResponse;
}

/**
 * Safely clones a Response object and appends an execution timestamp via blob re-wrapping
 */
async function cloneWithTimestamp(response) {
  const cloned = response.clone();
  const headers = new Headers(cloned.headers);
  headers.set('sw-cache-time', Date.now().toString());
  
  // Reading body as blob completely sidesteps raw lock exceptions inside custom wrappers
  const blob = await cloned.blob();
  return new Response(blob, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers
  });
}

function offlinePage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Epsilon Hub — Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.box{max-width:380px}.icon{width:72px;height:72px;border-radius:1rem;background:linear-gradient(135deg,#7c3aed,#8b5cf6);margin:0 auto 1.5rem;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:900;color:#fff}h1{font-size:1.4rem;font-weight:800;margin-bottom:.5rem}p{color:#71717a;font-size:.88rem;line-height:1.6;margin-bottom:1.5rem}button{padding:.7rem 1.5rem;border-radius:.65rem;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:#fff;font-weight:600;border:none;cursor:pointer;font-size:.86rem}button:hover{opacity:.9}</style></head><body><div class="box"><div class="icon">ε</div><h1>You're Offline</h1><p>Epsilon Hub can't reach the server right now. Check your connection and try again.</p><button onclick="location.reload()">Retry</button></div></body></html>`;
}
