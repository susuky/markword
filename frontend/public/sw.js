const scopeUrl = new URL(self.registration.scope)
const serviceWorkerUrl = new URL(self.location.href)
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
const cacheSuffix = scopePath.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'root'
const CACHE_PREFIX = `markword-shell-${cacheSuffix}`
const FALLBACK_CACHE_REVISION = 'v3'
const cacheRevision = (serviceWorkerUrl.searchParams.get('build') || FALLBACK_CACHE_REVISION)
  .replace(/[^a-z0-9._-]+/gi, '-')
  .slice(0, 64) || FALLBACK_CACHE_REVISION
const CACHE_NAME = `${CACHE_PREFIX}-${cacheRevision}`
const APP_SHELL = ['', 'index.html', 'manifest.webmanifest', 'markword-icon.svg']
  .map((path) => new URL(path, scopeUrl).toString())
const INDEX_URL = new URL('index.html', scopeUrl).toString()

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))
  const indexResponse = await cache.match(INDEX_URL)
  if (!indexResponse) return
  const html = await indexResponse.text()
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)]
    .map((match) => new URL(match[1], scopeUrl).toString())
  await cache.addAll([...new Set(assets)].map((url) => new Request(url, { cache: 'reload' })))
}

async function deleteStaleCaches() {
  const keys = await caches.keys()
  const staleKeys = keys.filter((key) => (
    key.startsWith(`${CACHE_PREFIX}-`)
    || (scopePath === '/' && key === 'markword-shell-v1')
  ) && key !== CACHE_NAME)

  await Promise.all(staleKeys.map((key) => caches.delete(key)))
  return staleKeys
}

async function activateLatestCache() {
  await deleteStaleCaches()
  await self.clients.claim()
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    cacheAppShell(),
    self.skipWaiting(),
  ]))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(activateLatestCache())
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'MARKWORD_CLEAN_STALE_CACHES') return
  event.waitUntil(deleteStaleCaches())
})

function isStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false
  if (!url.pathname.startsWith(scopePath)) return false
  const relativePath = url.pathname.slice(scopePath.length)
  if (relativePath.startsWith('api/')) return false
  return relativePath.startsWith('assets/')
    || relativePath === 'manifest.webmanifest'
    || relativePath === 'markword-icon.svg'
    || ['script', 'style', 'font', 'image', 'manifest'].includes(request.destination)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  const relativePath = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : ''
  if (request.method !== 'GET' || relativePath.startsWith('api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy))
          }
          return response
        })
        .catch(() => caches.match(INDEX_URL).then((cached) => cached || Response.error())),
    )
    return
  }

  if (!isStaticAsset(request, url)) return
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      }).catch(() => cached || Response.error())
      return cached || network
    }),
  )
})
