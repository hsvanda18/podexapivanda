/* Base compartilhada das páginas em JavaScript (Arena, Tipos, Quiz).
   Lê window.ARENA_DADOS (medida DAX [JS Dados]) e publica window.PK com dados e utilidades.
     pk: [id, nome, especie, tipo1, tipo2, hp, atk, def, spa, spd, spe, padrao, geracao, lendario/mítico]
     ef: { 'ataque>defesa': fator }   gp: golpes   tp: { slug: [nome PT, cor] }
   Não use aspas duplas neste arquivo (ele vira uma string DAX). */
(function () {
  var D = window.ARENA_DADOS;
  if (!D) { return; }
  if (window.PK && window.PK.v === D.v) { return; }

  /* imagens pelo CDN jsDelivr (cache de 7 dias); se falhar, pkImgErro tenta o GitHub direto */
  var CDN_SPR = 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/', RAW_SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/';
  var SPR = CDN_SPR + 'sprites/pokemon/';
  var ICO = 'https://cdn.jsdelivr.net/gh/partywhale/pokemon-type-icons@main/icons/';
  function urlReserva(u) { return u.indexOf(CDN_SPR) === 0 ? RAW_SPR + u.slice(CDN_SPR.length) : ''; }
  var P = {}, LISTA = [];
  D.pk.forEach(function (r) {
    var p = { id: r[0], nome: r[1], esp: r[2], t: r[4] ? [r[3], r[4]] : [r[3]],
      b: { hp: r[5], atk: r[6], def: r[7], spa: r[8], spd: r[9], spe: r[10] }, padrao: r[11] === 1, gen: r[12] || 0, lend: r[13] === 1, peso: r[15] || 0 };
    p.total = p.b.hp + p.b.atk + p.b.def + p.b.spa + p.b.spd + p.b.spe;
    P[p.id] = p; LISTA.push(p);
  });
  var TIPOS = Object.keys(D.tp);

  function ef(a, d) { var x = D.ef[a + '>' + d]; return x === undefined ? 1 : x; }
  function efTotal(tipo, tiposDef) { return tiposDef.reduce(function (m, d) { return m * ef(tipo, d); }, 1); }
  function corTipo(t) { return (D.tp[t] || ['', '#888'])[1]; }
  function nomeTipo(t) { return (D.tp[t] || [t])[0]; }
  function icone(t, tam) {
    return `<img class='pk-ico' src='${ICO + t}.svg' alt='' title='${nomeTipo(t)}' style='width:${tam || 18}px;height:${tam || 18}px'/>`;
  }
  function chip(t) {
    return `<span class='pk-chip' style='--c:${corTipo(t)}'>${icone(t, 14)}${nomeTipo(t)}</span>`;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;'); }
  function fmtEf(x) { return x === 0.5 ? '½' : x === 0.25 ? '¼' : String(x); }
  function normalizar(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }
  var URL = {
    sprite: function (id) { return SPR + id + '.png'; },
    gif: function (id) { return SPR + 'other/showdown/' + id + '.gif'; },
    costas: function (id) { return SPR + 'other/showdown/back/' + id + '.gif'; },
    home: function (id) { return SPR + 'other/home/' + id + '.png'; },
    arte: function (id) { return SPR + 'other/official-artwork/' + id + '.png'; }
  };
  /* <img> com cadeia de reserva: se a URL falhar, tenta a próxima */
  function img(urls, cls, extra) {
    return `<img class='${cls || ''}' src='${urls[0]}' data-alt='${urls.slice(1).join('|')}' onerror='pkImgErro(this)' ${extra || ''}/>`;
  }
  window.pkImgErro = function (el) {
    var alts = (el.getAttribute('data-alt') || '').split('|').filter(Boolean), raw = urlReserva(el.src);
    if (raw && !el.getAttribute('data-raw')) { el.setAttribute('data-raw', '1'); el.src = raw; return; }
    el.removeAttribute('data-raw');
    if (!alts.length) { el.onerror = null; el.style.visibility = 'hidden'; return; }
    el.setAttribute('data-alt', alts.slice(1).join('|'));
    el.src = alts[0];
  };
  /* estado guardado no aparelho: o telemóvel pode fechar o separador quando a app é minimizada */
  var PREFIXO = 'pkdx:';
  function guardar(chave, obj) {
    try { window.localStorage.setItem(PREFIXO + chave, JSON.stringify({ em: Date.now(), d: obj })); } catch (e) { /* sem espaço ou bloqueado */ }
  }
  function restaurar(chave, horas) {
    try {
      var x = JSON.parse(window.localStorage.getItem(PREFIXO + chave) || 'null');
      if (!x || (horas && Date.now() - x.em > horas * 3600000)) { return null; }
      return x.d;
    } catch (e) { return null; }
  }
  function esquecer(chave) { try { window.localStorage.removeItem(PREFIXO + chave); } catch (e) { /* ignora */ } }
  /* corre fn quando a página fica escondida (minimizar, trocar de app) ou é fechada */
  function aoSair(fn) {
    var f = function () { try { fn(); } catch (e) { /* não impede a saída */ } };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { f(); } });
    window.addEventListener('pagehide', f);
  }
  /* palco fixo de 1280x720 escalado para caber no visual */
  function escala(raiz) {
    var palco = raiz.querySelector('.pk-palco');
    if (!palco) { return; }
    var w = raiz.clientWidth || window.innerWidth, h = raiz.clientHeight || window.innerHeight;
    var s = Math.min(w / 1280, h / 720);
    palco.style.transform = 'translate(' + ((w - 1280 * s) / 2) + 'px,' + ((h - 720 * s) / 2) + 'px) scale(' + s + ')';
  }
  function aleatorio(lista) { return lista[Math.floor(Math.random() * lista.length)]; }
  function embaralhar(lista) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  /* partículas de fundo por tipo (mesmas classes .fx-<tipo> da Pokédex) */
  function particulas(tipo, n, semente) {
    var html = '';
    for (var i = 1; i <= n; i++) {
      var k = i + (semente || 0);
      html += `<i style='left:${(k * 37 + 11) % 100}%;top:${(k * 53 + 7) % 100}%;width:${4 + (k * 7) % 10}px;height:${4 + (k * 7) % 10}px;animation-duration:${(5 + ((k * 13) % 60) / 10).toFixed(1)}s;animation-delay:-${(((k * 29) % 80) / 10).toFixed(1)}s'></i>`;
    }
    return `<div class='fx fx-${tipo}'>${html}</div>`;
  }

  window.PK = { v: D.v, D: D, P: P, LISTA: LISTA, TIPOS: TIPOS, ef: ef, efTotal: efTotal, corTipo: corTipo,
    nomeTipo: nomeTipo, icone: icone, chip: chip, esc: esc, fmtEf: fmtEf, normalizar: normalizar, URL: URL,
    img: img, escala: escala, SPR: SPR, guardar: guardar, restaurar: restaurar, esquecer: esquecer, aoSair: aoSair, aleatorio: aleatorio, embaralhar: embaralhar, particulas: particulas };
})();
