/* Moldura das páginas: posiciona a navegação no palco 1280x720 (mesmo lugar do navegador do Power BI)
   e adapta ao celular. Páginas de jogo giram 90° quando o celular está em pé; a Pokédex usa o layout
   vertical de dex.css (classe html.movel). */
(function () {
  var tela = document.getElementById('pk-tela'), nav = document.getElementById('pk-nav');
  if (!tela || !nav) { return; }
  var html = document.documentElement, body = document.body;
  var dex = body.classList.contains('dex'), largura = dex ? 332 : 420;
  var LIMITE = 700;

  function layout() {
    var w = window.innerWidth, h = window.innerHeight;
    var movel = dex && w < LIMITE;
    var girar = !dex && h > w && w < LIMITE;
    html.classList.toggle('movel', movel);
    html.classList.toggle('girado', girar);
    if (movel) {
      tela.style.width = tela.style.height = tela.style.transform = '';
    } else {
      var W = girar ? h : w, H = girar ? w : h, s = Math.min(W / 1280, H / 720);
      tela.style.width = W + 'px';
      tela.style.height = H + 'px';
      tela.style.transform = girar ? 'translateX(' + w + 'px) rotate(90deg)' : '';
      nav.style.width = largura + 'px';
      nav.style.transform = 'translate(' + ((W - 1280 * s) / 2 + 16 * s) + 'px,' + ((H - 720 * s) / 2 + 12 * s) + 'px) scale(' + s + ')';
    }
    var raiz = document.getElementById('app-raiz');
    if (window.PK && raiz) { window.PK.escala(raiz); }
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 150); });
  layout();
})();
