const scopeUrl = new URL(self.registration.scope)
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
const cacheSuffix = scopePath.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'root'
const CACHE_PREFIX = `markword-shell-${cacheSuffix}`
const CACHE_NAME = `${CACHE_PREFIX}-v2`
const APP_SHELL = ['', 'index.html', 'manifest.webmanifest', 'markword-icon.svg']
  .map((path) => new URL(path, scopeUrl).toString())
const INDEX_URL = new URL('index.html', scopeUrl).toString()

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL)
  const indexResponse = await cache.match(INDEX_URL)
  if (!indexResponse) return
  const html = await indexResponse.text()
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)]
    .map((match) => new URL(match[1], scopeUrl).toString())
  await cache.addAll([...new Set(assets)])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (
            key.startsWith(`${CACHE_PREFIX}-`)
            || (scopePath === '/' && key === 'markword-shell-v1')
          ) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
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
      fetch(request)
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
