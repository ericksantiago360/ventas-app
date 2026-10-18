// Service worker de la app instalable.
// Nunca guarda en caché la API, el login ni los PDFs: los datos siempre vienen del servidor.
const VERSION = 'v1'
const CACHE = `gestion-${VERSION}`
const SHELL = ['/', '/manifest.webmanifest', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (/^\/(api|auth|storage)\//.test(url.pathname)) return

  // Páginas: primero la red para recibir versiones nuevas; sin conexión, la última guardada
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(resp => {
          const copia = resp.clone()
          caches.open(CACHE).then(c => c.put('/', copia))
          return resp
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Los archivos de /assets/ llevan hash en el nombre, así que no cambian nunca
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(request).then(guardado => guardado || fetch(request).then(resp => {
        const copia = resp.clone()
        caches.open(CACHE).then(c => c.put(request, copia))
        return resp
      }))
    )
    return
  }

  // Íconos y manifest: se sirven de caché y se refrescan en segundo plano
  e.respondWith(
    caches.match(request).then(guardado => {
      const red = fetch(request).then(resp => {
        const copia = resp.clone()
        caches.open(CACHE).then(c => c.put(request, copia))
        return resp
      }).catch(() => guardado)
      return guardado || red
    })
  )
})
