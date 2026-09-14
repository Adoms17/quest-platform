// Старый установленный PWA worker может отдавать release HTML вместо Vite dev.
// Только dev: снимаем регистрацию/перехват, не очищая CacheStorage и IndexedDB.
export function localDevWorker() {
  return {
    name: 'quest-local-dev-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sw.js') return next()
        response.setHeader('Content-Type', 'application/javascript')
        response.setHeader('Cache-Control', 'no-store')
        response.end(`
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.registration.unregister().then(() => self.clients.matchAll({ type: 'window' }))
    .then(clients => Promise.all(clients.map(client => client.navigate(client.url)))));
});
`)
      })
    },
  }
}
