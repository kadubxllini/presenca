const CACHE_NAME = 'presenca-v4';

// Arquivos principais do App Shell para armazenar em cache
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png'
];

// Instalação do Service Worker e pré-carregamento do App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pré-carregando App Shell no cache');
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepção de requisições
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Chamadas de API (servidor) ou métodos de modificação -> Sempre direto pela Rede
  if (requestUrl.pathname.startsWith('/api') || event.request.method !== 'GET') {
    event.respondWith(
      fetch(event.request).catch((err) => {
        console.warn('[SW] Falha ao conectar à API na rede:', err);
        return new Response(JSON.stringify({ error: 'Você está offline ou a API não respondeu.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2. Recursos estáticos -> Estratégia Stale-While-Revalidate (Rede com fallback do Cache)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Atualiza o cache em segundo plano se a requisição for válida
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Se a rede falhar, retorna o que tiver no cache
        return cachedResponse;
      });

      // Retorna a resposta do cache imediatamente se existir, ou espera pela rede
      return cachedResponse || fetchPromise;
    })
  );
});
