/* Versão web: posiciona a navegação no palco 1280x720 (mesmo lugar do navegador de páginas do Power BI). */
(function () {
  var nav = document.getElementById('pk-nav');
  if (!nav) { return; }
  var largura = document.querySelector('#pk-nav a.on[href=\'index.html\']') ? 332 : 420;
  nav.style.width = largura + 'px';
  var aviso = document.createElement('div');
  aviso.id = 'pk-girar';
  aviso.textContent = 'Gire o celular na horizontal para ver melhor.';
  document.body.appendChild(aviso);
  function posicionar() {
    var w = window.innerWidth, h = window.innerHeight, s = Math.min(w / 1280, h / 720);
    var ox = (w - 1280 * s) / 2, oy = (h - 720 * s) / 2;
    nav.style.transform = 'translate(' + (ox + 16 * s) + 'px,' + (oy + 12 * s) + 'px) scale(' + s + ')';
    var raiz = document.getElementById('app-raiz');
    if (window.PK && raiz) { window.PK.escala(raiz); }
  }
  window.addEventListener('resize', posicionar);
  posicionar();
})();
