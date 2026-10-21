/* Service Worker da Pokédex Web: guarda o site e as imagens no aparelho.
   - páginas, código e dados: mostra logo o que está guardado e atualiza por trás (stale-while-revalidate)
   - imagens (sprites, artes, ícones, cartas): guardadas na primeira vez e servidas do aparelho depois
   Ao publicar código novo, mude VERSAO para os aparelhos trocarem a cache do site. */
var VERSAO = 'pkdx-2026-10-21l';
var CACHE_SITE = 'site-' + VERSAO;
var CACHE_IMG = 'imagens-v1';
var LIMITE_IMG = 1500;
var SITE_BASE = ['./', 'index.html', 'arena.html', 'tipos.html', 'quiz.html', 'safari.html',
  'css/comum.css', 'css/web.css', 'js/comum.js', 'js/web.js', 'dados/arena.js', 'manifest.webmanifest'];
var HOSTS_IMG = ['cdn.jsdelivr.net', 'raw.githubusercontent.com', 'images.pokemontcg.io', 'images.scrydex.com'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE_SITE).then(function (c) { return c.addAll(SITE_BASE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n.indexOf('site-') === 0 && n !== CACHE_SITE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

function ehImagem(req, url) {
  return HOSTS_IMG.indexOf(url.hostname) >= 0 && (req.destination === 'image' || /\.(png|gif|svg|jpe?g|webp)$/i.test(url.pathname) || url.hostname === 'images.scrydex.com');
}

/* corta as imagens mais antigas quando passa do limite */
function aparar() {
  return caches.open(CACHE_IMG).then(function (c) {
    return c.keys().then(function (k) {
      var sobra = k.length - LIMITE_IMG;
      return sobra > 0 ? Promise.all(k.slice(0, sobra).map(function (r) { return c.delete(r); })) : null;
    });
  });
}
var apararAgendado = false;

function imagem(req, url) {
  return caches.open(CACHE_IMG).then(function (c) {
    return c.match(url.href).then(function (guardada) {
      if (guardada) { return guardada; }
      // pede em modo CORS para a cache não guardar respostas "opacas" (que ocupam muito espaço)
      return fetch(url.href, { mode: 'cors', credentials: 'omit' }).then(function (r) {
        if (r.ok) {
          c.put(url.href, r.clone());
          if (!apararAgendado) { apararAgendado = true; setTimeout(function () { apararAgendado = false; aparar(); }, 10000); }
        }
        return r;
      }).catch(function () { return fetch(req); });
    });
  });
}

function site(req) {
  return caches.open(CACHE_SITE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (guardada) {
      var rede = fetch(req).then(function (r) {
        if (r.ok && r.type === 'basic') { c.put(req, r.clone()); }
        return r;
      }).catch(function () { return guardada; });
      return guardada || rede;
    });
  });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin === self.location.origin) { ev.respondWith(site(req)); return; }
  if (ehImagem(req, url)) { ev.respondWith(imagem(req, url)); }
  // o resto (Supabase, PokeAPI, CDN de bibliotecas) passa direto
});
