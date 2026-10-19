/* Página Pokédex (versão web): mesma lógica das medidas DAX da página Pokédex do Power BI.
   Usa window.PK (comum.js), window.DEX_DADOS (colunas extras) e window.CARTAS (TCG).
   Seleção exibida: forma clicada > evolução clicada > item da lista > primeiro do filtro. */
(function () {
  var K = window.PK, X = window.DEX_DADOS, C = window.CARTAS, raiz = document.getElementById('app-raiz');
  if (!K || !X || !raiz) { return; }
  var esc = K.esc, P = K.P, SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

  // mesmos IDs sem arquivo no repositório de sprites (Pokemon.m)
  var SEM_GIF = [990, 991, 992, 993, 994, 995, 1006, 1008, 1010, 1017, 1022, 1023, 1024, 1025, 10072, 10075, 10078, 10079, 10081, 10082, 10084, 10085, 10086, 10087, 10088, 10089, 10257, 10264, 10265, 10266, 10267, 10268, 10269, 10270, 10271, 10273, 10274, 10275, 10276, 10277];
  var SEM_GIF_SHINY = [990, 991, 992, 993, 994, 995, 1006, 1008, 1010, 1017, 1022, 1023, 1024, 1025, 10257, 10264, 10265, 10266, 10267, 10268, 10269, 10270, 10271, 10273, 10274, 10275, 10276, 10277];
  var SEM_ARTE_SHINY = [10158, 10159, 10264, 10266, 10268, 10270, 10277];

  K.LISTA.forEach(function (p) {
    var x = X[p.id];
    p.nomeEsp = x[0]; p.forma = x[1]; p.tag = x[2]; p.alt = x[3]; p.peso = x[4]; p.cat = x[5]; p.desc = x[6];
    p.chain = x[7]; p.est = x[8]; p.ests = x[9]; p.nivel = x[10]; p.rar = x[11]; p.genLabel = x[12]; p.ordem = x[13];
  });
  var PADRAO = K.LISTA.filter(function (p) { return p.padrao; });

  /* ---------- imagens ---------- */
  function arte(p, shiny) {
    var base = SPR + 'other/official-artwork/' + p.id + '.png';
    return shiny && SEM_ARTE_SHINY.indexOf(p.id) < 0 ? [SPR + 'other/official-artwork/shiny/' + p.id + '.png', base] : [base, SPR + 'other/home/' + p.id + '.png'];
  }
  function gif(p, shiny) {
    var home = SPR + 'other/home/' + (shiny ? 'shiny/' : '') + p.id + '.png';
    var semGif = (shiny ? SEM_GIF_SHINY : SEM_GIF).indexOf(p.id) >= 0;
    return semGif ? [home, SPR + p.id + '.png'] : [SPR + 'other/showdown/' + (shiny ? 'shiny/' : '') + p.id + '.gif', home, SPR + p.id + '.png'];
  }

  /* ---------- cartas TCG por espécie ---------- */
  var porEspecie = null;
  function cartasDe(p) {
    if (!C) { return []; }
    if (!porEspecie) {
      porEspecie = {};
      C.c.forEach(function (c, i) { c[4].forEach(function (d) { (porEspecie[d] || (porEspecie[d] = [])).push(i); }); });
    }
    var todas = (porEspecie[p.esp] || []).map(function (i) { return C.c[i]; });
    var daForma = todas.filter(function (c) { return c[3] === p.tag; });
    return (daForma.length ? daForma : todas).map(function (c) {
      var s = C.s[c[0]];
      return { img: c[5] || ('https://images.pokemontcg.io/' + s[0] + '/' + c[1] + '.png'), rar: C.r[c[2]], col: s[1] + ' · ' + s[2] };
    });
  }

  /* ---------- estado ---------- */
  var S = { gen: '', tipo: '', lend: false, busca: '', lista: null, evo: null, forma: null, modo: 1, exibido: null, animar: null };

  function filtrados() {
    return PADRAO.filter(function (p) {
      return (!S.gen || p.genLabel === S.gen) && (!S.tipo || p.t.indexOf(S.tipo) >= 0) && (!S.lend || p.lend);
    });
  }
  function idLista() {
    var f = filtrados();
    if (S.lista && f.some(function (p) { return p.id === S.lista; })) { return S.lista; }
    return f.length ? f[0].id : (S.lista || 1);
  }
  function mesmaCadeia(id) { return id && P[id] && P[id].chain === P[idLista()].chain ? id : null; }
  function idEvo() { return mesmaCadeia(S.evo); }
  function idForma() { return mesmaCadeia(S.forma); }
  function idSel() { return idForma() || idEvo() || idLista(); }

  /* ---------- CSS de cores por tipo (medida <CSS> Tipos) ---------- */
  (function () {
    var css = '';
    K.TIPOS.forEach(function (t) {
      var c = K.corTipo(t), r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
      var a = function (x) { return 'rgba(' + r + ',' + g + ',' + b + ',' + x + ')'; };
      css += '.bg-' + t + '{background-color:' + c + '}.fl-' + t + '{fill:' + c + ';stroke:' + c + '}.bc-' + t + '{border-color:' + c + '}' +
        '.gl-' + t + '{background-image:radial-gradient(circle,' + a(.55) + ' 0%,' + a(.18) + ' 38%,' + a(0) + ' 68%)}' +
        '.sh-' + t + '{box-shadow:0 0 22px ' + a(.45) + '}';
    });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  })();

  /* ---------- blocos ---------- */
  function fundoHtml(p) {
    var t1 = p.t[0], t2 = p.t[1];
    return `<div class='bg'><div class='bg-g1 gl-${t1}'></div><div class='bg-g2 gl-${t2 || t1}'></div><div class='bg-dots'></div>` +
      `<div class='bg-ball'><i></i></div><div class='bg-num'>${String(p.esp).padStart(3, '0')}</div>` +
      K.particulas(t1, 22, 0) + (t2 ? K.particulas(t2, 10, 40).replace("class='fx ", "class='fx fx2 ") : '') +
      (S.modo === 2 ? K.particulas('shiny', 20, 80) : '') + '</div>';
  }

  function marcaHtml() {
    var n = filtrados().length;
    return `<div class='mk'><div class='mk-ball'></div><div class='mk-txt'><b>POKÉDEX</b><span>${n.toLocaleString('pt-BR')} Pokémon ${n === 1 ? 'encontrado' : 'encontrados'}</span></div></div>`;
  }

  function fmt(x, casas) { return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }

  function heroHtml(p) {
    var shiny = S.modo === 2, anim = S.animar, nome = p.nome;
    var cls = (anim ? ' evo' : '') + (shiny ? ' shiny' : '');
    var classeNome = nome.length > 18 ? ' hn-p' : nome.length > 12 ? ' hn-m' : '';
    var rarCls = p.rar === 'Lendário' ? ' rar-lendario' : p.rar === 'Mítico' ? ' rar-mitico' : '';
    var topo = `<div class='hero-top'><span class='hero-num'>#${String(p.esp).padStart(3, '0')}</span></div>` +
      `<div class='hero-nome${classeNome}'>${esc(nome)}</div>` + (p.cat ? `<div class='hero-cat'>${esc(p.cat)}</div>` : '') +
      `<div class='hero-pills'><span class='pill'>${esc(p.genLabel)}</span><span class='pill'>Estágio ${p.est}/${p.ests}</span>` +
      `<span class='pill${rarCls}'>${p.rar}</span>${shiny ? "<span class='pill pill-shiny'>✨ SHINY</span>" : ''}</div>`;
    if (S.modo === 4) { return `<div class='hero${cls}'>${topo}${golpesHtml(p)}</div>`; }
    if (S.modo === 3) {
      var cartas = cartasDe(p);
      var gal = `<div class='cg-head'>CARTAS DE ${esc(p.nomeEsp.toUpperCase())}<b>${cartas.length}</b></div>`;
      if (!cartas.length) { gal += "<div class='cg-vazio'>Nenhuma carta encontrada para este Pokémon.</div>"; }
      else {
        var t = cartas[0];
        gal += "<div class='cg'><div class='cg-lista'>" + cartas.map(function (c) {
          return `<div class='cg-item' data-acao='carta' data-img='${c.img}' data-txt='${esc(c.rar + ' · ' + c.col)}'><img class='cg-thumb' loading='lazy' src='${c.img}'/><div class='cg-prev'><div class='holo'><img src='${c.img}'/></div>` +
            `<span><b>${esc(c.rar)}</b>${esc(c.col)}</span></div></div>`;
        }).join('') + `</div><div class='cg-padrao'><div class='holo'><img src='${t.img}'/></div><span><b>${esc(t.rar)}</b>${esc(t.col)}</span></div></div>`;
      }
      return `<div class='hero${cls}'>${topo}${gal}</div>`;
    }
    var t1 = p.t[0];
    var brilhos = shiny ? "<div class='brilhos'>" + [[22, 18, 0], [74, 24, .6], [30, 72, 1.1], [68, 66, .3], [50, 8, 1.5], [84, 48, .9], [14, 46, 1.8], [58, 84, .4]]
      .map(function (b) { return `<i style='left:${b[0]}%;top:${b[1]}%;animation-delay:${b[2]}s'></i>`; }).join('') + '</div>' : '';
    var antes = anim ? `<div class='evo-raios'></div>${K.img(arte(anim, shiny), 'evo-antes')}` : '';
    var depois = anim ? `<div class='evo-flash'></div><div class='evo-msg'>${esc(anim.nomeEsp)} evoluiu para ${esc(p.nomeEsp)}!</div>` :
      (p.desc ? `<div class='hero-desc'>${esc(p.desc)}</div>` : '');
    var tipos = p.t.map(function (t) { return `<span class='tp bg-${t} sh-${t}'>${esc(K.nomeTipo(t).toUpperCase())}</span>`; }).join('');
    return `<div class='hero${cls}'>${topo}<div class='hero-palco'><div class='hero-glow gl-${t1}'></div><div class='hero-anel bc-${t1}'></div>` +
      antes + K.img(arte(p, shiny), 'hero-img') + `<div class='hero-chao'></div>${brilhos}${depois}` +
      "<button class='hero-seta hs-ant' data-acao='ant' aria-label='Pokémon anterior'>‹</button><button class='hero-seta hs-prox' data-acao='prox' aria-label='Próximo Pokémon'>›</button></div>" +
      `<div class='hero-tipos'>${tipos}</div><div class='hero-fatos'>` +
      `<div class='fato'><span>ALTURA</span><b>${fmt(p.alt, 1)} m</b></div>` +
      `<div class='fato'><span>PESO</span><b>${fmt(p.peso, 1)} kg</b></div>` +
      `<div class='fato'><span>TOTAL BASE</span><b>${p.total}</b></div></div>` +
      (p.desc ? `<p class='hero-desc-m'>${esc(p.desc)}</p>` : '') + '</div>';
  }

  /* ---------- golpes de ataque que esta forma aprende (dados/golpes.js) ---------- */
  var GD = window.GOLPES_DADOS;
  function acertos(g) { return g[7] <= 1 ? 1 : g[6] === 2 && g[7] === 5 ? 3.1 : (g[6] + g[7]) / 2; }
  function golpesDex(p) {
    if (!GD) { return []; }
    var ids = GD.a[p.id];
    if (!ids) { var base = PADRAO.find(function (x) { return x.esp === p.esp; }); ids = base && GD.a[base.id]; }
    return (ids || []).map(function (i) { return GD.g[i]; });
  }
  function golpesHtml(p) {
    var todos = golpesDex(p), f = S.gfil || '';
    var lista = todos.filter(function (g) { return !f || (f === 'stab' ? p.t.indexOf(g[1]) >= 0 : g[2] === f); })
      .sort(function (a, b) { return b[3] * acertos(b) - a[3] * acertos(a) || a[0].localeCompare(b[0]); });
    var filtros = [['', 'Todos'], ['stab', 'Do tipo dele'], ['F', 'Físicos'], ['E', 'Especiais']].map(function (x) {
      return `<button class='gd-f${f === x[0] ? ' on' : ''}' data-acao='gfil' data-f='${x[0]}'>${x[1]}</button>`;
    }).join('');
    var linhas = lista.map(function (g) {
      var tags = [];
      if (p.t.indexOf(g[1]) >= 0) { tags.push("<i class='gd-stab'>STAB</i>"); }
      if (g[5] > 0) { tags.push('<i>⚡ +' + g[5] + '</i>'); }
      if (g[7] > 1) { tags.push('<i>' + (g[6] === g[7] ? g[6] : g[6] + '–' + g[7]) + ' acertos</i>'); }
      if (g[8] > 0) { tags.push('<i>drena ' + g[8] + '%</i>'); }
      if (g[8] < 0) { tags.push('<i>recuo ' + (-g[8]) + '%</i>'); }
      if (g[9] === 1) { tags.push('<i>crítico alto</i>'); }
      if (g[9] === 2) { tags.push('<i>sempre crítico</i>'); }
      return `<div class='gd' style='--c:${K.corTipo(g[1])}'>${K.icone(g[1], 18)}<b>${esc(g[0])}</b><span class='gd-cat'>${g[2] === 'F' ? 'Físico' : 'Especial'}</span>` +
        `<span class='gd-n'>${g[3]}</span><span class='gd-n'>${g[4] ? g[4] + '%' : '—'}</span><em>${tags.join('')}</em></div>`;
    }).join('');
    return `<div class='cg-head'>GOLPES DE ATAQUE QUE ${esc(p.nome.toUpperCase())} APRENDE<b>${todos.length}</b></div>` +
      `<div class='gd-filtros'>${filtros}</div>` +
      (lista.length ? `<div class='gd-cab'><span></span><span>Golpe</span><span>Categoria</span><span class='gd-n'>Poder</span><span class='gd-n'>Precisão</span><span></span></div><div class='gd-lista'>${linhas}</div>`
        : "<div class='cg-vazio'>Nenhum golpe de ataque nesta lista.</div>");
  }

  function cabeca(p, titulo, extra) {
    var t = p.t[0];
    return `<div class='pn-head'><span class='pn-ico bg-${t} sh-${t}'></span><span class='pn-tit'>${titulo}</span>${extra}</div>`;
  }

  function atributosHtml(p) {
    var cx = 100, cy = 100, r = 62, esc200 = 200, t = p.t[0], b = p.b;
    var eixos = [['HP', b.hp], ['ATQ', b.atk], ['DEF', b.def], ['VEL', b.spe], ['A.ESP', b.spa], ['D.ESP', b.spd]];
    var ang = function (k) { return (-90 + 60 * k) * Math.PI / 180; };
    var pt = function (k, raio) { return (cx + raio * Math.cos(ang(k))).toFixed(1) + ',' + (cy + raio * Math.sin(ang(k))).toFixed(1); };
    var grade = [.25, .5, .75, 1].map(function (f) {
      return `<polygon class='rd-grid' points='${[0, 1, 2, 3, 4, 5].map(function (k) { return pt(k, r * f); }).join(' ')}'/>`;
    }).join('');
    var eixosSvg = [0, 1, 2, 3, 4, 5].map(function (k) { var q = pt(k, r).split(','); return `<line class='rd-ax' x1='${cx}' y1='${cy}' x2='${q[0]}' y2='${q[1]}'/>`; }).join('');
    var rv = function (v) { return r * Math.min(Math.max(v / esc200, .06), 1); };
    var pontos = eixos.map(function (e, k) { return pt(k, rv(e[1])); }).join(' ');
    var dots = eixos.map(function (e, k) { var q = pt(k, rv(e[1])).split(','); return `<circle class='rd-dot' r='3' cx='${q[0]}' cy='${q[1]}'/>`; }).join('');
    var rot = eixos.map(function (e, k) {
      return `<text class='rd-lb' text-anchor='middle' x='${(cx + 84 * Math.cos(ang(k))).toFixed(1)}' y='${(cy + 84 * Math.sin(ang(k)) + 3).toFixed(1)}'>${e[0]}</text>`;
    }).join('');
    var barras = [['HP', b.hp], ['ATQ', b.atk], ['DEF', b.def], ['A.ESP', b.spa], ['D.ESP', b.spd], ['VEL', b.spe]].map(function (e) {
      return `<div class='br'><span class='br-l'>${e[0]}</span><div class='br-t'><div class='br-f bg-${t}' style='width:${Math.round(Math.min(e[1] / esc200, 1) * 100)}%'></div></div><span class='br-v'>${e[1]}</span></div>`;
    }).join('');
    return "<div class='pn'>" + cabeca(p, 'ATRIBUTOS', `<span class='pn-total'>TOTAL <b>${p.total}</b></span>`) +
      `<div class='at'><svg class='rd' viewBox='0 0 200 200'>${grade}${eixosSvg}<polygon class='rd-poly fl-${t}' points='${pontos}'/>${dots}${rot}</svg>` +
      `<div class='bars'>${barras}</div></div></div>`;
  }

  function fraquezasHtml(p) {
    var todos = K.TIPOS.map(function (t, i) { return { t: t, i: i, m: K.efTotal(t, p.t) }; });
    var fracos = todos.filter(function (x) { return x.m > 1; }).sort(function (a, b) { return b.m - a.m || a.i - b.i; });
    var resiste = todos.filter(function (x) { return x.m < 1; }).sort(function (a, b) { return a.m - b.m || a.i - b.i; });
    var chipF = fracos.map(function (x) { return `<span class='ch bg-${x.t}${x.m >= 4 ? ' ch-x4' : ''}'>${esc(K.nomeTipo(x.t))}<b>${x.m}×</b></span>`; }).join('');
    var chipR = resiste.map(function (x) {
      return `<span class='ch ch-res bg-${x.t}${x.m === 0 ? ' ch-imune' : ''}'>${esc(K.nomeTipo(x.t))}<b>${x.m === 0 ? '0×' : x.m === .25 ? '¼×' : '½×'}</b></span>`;
    }).join('');
    // vantagem: tipos que os golpes do próprio tipo dele acertam com dano dobrado
    var forte = K.TIPOS.map(function (t, i) { return { t: t, i: i, m: Math.max.apply(null, p.t.map(function (a) { return K.ef(a, t); })) }; })
      .filter(function (x) { return x.m > 1; });
    var chipV = forte.map(function (x) { return `<span class='ch ch-van bg-${x.t}'>${esc(K.nomeTipo(x.t))}<b>${x.m}×</b></span>`; }).join('');
    var golpesDoTipo = p.t.map(function (t) { return esc(K.nomeTipo(t)); }).join(' e ');
    return "<div class='pn'>" + cabeca(p, 'FRAQUEZAS E VANTAGENS', '') + "<div class='fq'>" +
      `<div class='fq-sec'>VANTAGEM <i>${forte.length}</i><span class='fq-dica'>golpes de ${golpesDoTipo} causam dano dobrado em</span></div>` +
      (chipV ? `<div class='fq-chips'>${chipV}</div>` : "<div class='fq-vazio'>Nenhuma vantagem de tipo</div>") +
      `<div class='fq-sec'>FRACO CONTRA <i>${fracos.length}</i><span class='fq-dica'>dano recebido</span></div>` + (chipF ? `<div class='fq-chips'>${chipF}</div>` : "<div class='fq-vazio'>Nenhuma fraqueza</div>") +
      `<div class='fq-sec'>RESISTE OU É IMUNE <i>${resiste.length}</i></div>` + (chipR ? `<div class='fq-chips'>${chipR}</div>` : "<div class='fq-vazio'>Nenhuma resistência</div>") +
      '</div></div>';
  }

  function evolucaoHtml(p) {
    var shiny = S.modo === 2, evo = idEvo();
    var membros = PADRAO.filter(function (x) { return x.chain === p.chain; })
      .sort(function (a, b) { return a.est - b.est || a.esp - b.esp || a.id - b.id; });
    var pequeno = membros.length > 4 ? ' ev-p' : '', vistos = {};
    var itens = membros.map(function (m) {
      var seta = m.est > 1 && !vistos[m.est] ? "<span class='ev-seta'>›</span>" : '';
      vistos[m.est] = 1;
      var prox = m.est === p.est + 1;
      var cls = pequeno + (m.esp === p.esp ? ' ev-atual' : '') + (prox ? ' ev-prox' : '') + (evo && m.id !== evo ? ' unsel' : '');
      var nivel = m.nivel ? `<span class='ev-nv'>Nv. ${m.nivel}</span>` : m.est > 1 ? "<span class='ev-nv'>Especial</span>" : "<span class='ev-nv ev-nv0'>Base</span>";
      return `<div class='ev${cls}' data-acao='evo' data-id='${m.id}' title='${esc(m.nomeEsp)}'>${seta}<div class='ev-card'>${prox ? "<span class='ev-evoluir'>EVOLUIR ›</span>" : ''}` +
        `<div class='ev-img gl-${m.t[0]}'>${K.img(gif(m, shiny), '', "loading='lazy'")}</div><span class='ev-nome'>${esc(m.nomeEsp)}</span>${nivel}</div></div>`;
    }).join('');
    return "<div class='pn'>" + cabeca(p, 'EVOLUÇÃO', "<span class='pn-sub ev-dica'>clique no próximo estágio para evoluir · de novo para voltar</span>") +
      `<div class='pn-corpo'><div class='evs'>${itens}</div></div></div>`;
  }

  function formasHtml(p) {
    var shiny = S.modo === 2, forma = idForma();
    var formas = K.LISTA.filter(function (x) { return x.esp === p.esp; });
    var itens = formas.map(function (f) {
      var cls = (f.id === p.id ? ' fm-atual' : '') + (forma && f.id !== forma ? ' unsel' : '');
      return `<div class='fm${cls}' data-acao='forma' data-id='${f.id}' title='${esc(f.nome)}'><div class='fm-img gl-${f.t[0]}'>${K.img(gif(f, shiny), '', "loading='lazy'")}</div><span>${esc(f.forma)}</span></div>`;
    }).join('');
    return "<div class='pn'>" + cabeca(p, 'FORMAS', `<span class='pn-sub'>${formas.length} ${formas.length === 1 ? 'forma' : 'formas'}</span>`) +
      `<div class='pn-corpo'><div class='fms'>${itens}</div></div></div>`;
  }

  function listaHtml() {
    var termo = K.normalizar(S.busca), sel = idLista();
    var itens = filtrados().filter(function (p) { return !termo || K.normalizar(p.nome).indexOf(termo) >= 0 || String(p.esp) === S.busca.trim(); });
    if (!itens.length) { return "<div class='dx-vazio'>Nenhum Pokémon com esses filtros.</div>"; }
    return itens.map(function (p) {
      return `<button class='dx-it${p.id === sel ? ' on' : ''}' data-acao='lista' data-id='${p.id}'><small>#${String(p.esp).padStart(3, '0')}</small>` +
        `<img loading='lazy' src='${SPR + p.id}.png' alt='' onerror='pkImgErro(this)' data-alt=''/><span>${esc(p.nome)}</span></button>`;
    }).join('');
  }

  /* ---------- montagem ---------- */
  function caixa(id, x, y, w, h, z) { return `<div id='${id}' class='dx-cx' style='left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${z || 1}'></div>`; }
  var gens = [], vistoGen = {};
  PADRAO.forEach(function (p) { if (!vistoGen[p.genLabel]) { vistoGen[p.genLabel] = 1; gens.push([p.gen, p.genLabel]); } });
  gens.sort(function (a, b) { return a[0] - b[0]; });

  // no celular (html.movel) os blocos viram uma coluna e #dx-escolha (filtros + lista) vira uma tela por cima
  raiz.innerHTML = "<div class='pk-palco'>" +
    caixa('dx-fundo', 0, 0, 1280, 720, 0) + caixa('dx-marca', 24, 48, 320, 40, 2) +
    "<button id='dx-abrir' class='dx-abrir' data-acao='abrir'><span>Buscar Pokémon</span><b id='dx-abrir-n'></b></button>" +
    "<div id='dx-escolha'><div class='dx-escolha-topo'><b>Escolha um Pokémon</b><button class='dx-fechar' data-acao='fechar' aria-label='Fechar'>✕</button></div><div id='dx-filtros'>" +
    `<div class='dx-cx' style='left:16px;top:94px;width:118px;height:32px;z-index:3'><select id='dx-gen' class='dx-sel' aria-label='Geração'><option value=''>Geração</option>${gens.map(function (g) { return `<option value='${esc(g[1])}'>${esc(g[1])}</option>`; }).join('')}</select></div>` +
    `<div class='dx-cx' style='left:140px;top:94px;width:118px;height:32px;z-index:3'><select id='dx-tipo' class='dx-sel' aria-label='Tipo'><option value=''>Tipo</option>${K.TIPOS.map(function (t) { return `<option value='${t}'>${esc(K.nomeTipo(t))}</option>`; }).join('')}</select></div>` +
    `<div class='dx-cx' style='left:264px;top:94px;width:84px;height:32px;z-index:3'><button id='dx-lend' class='dx-bt' style='width:100%' data-acao='lend'>★ Lendários</button></div></div>` +
    `<div class='dx-cx dx-lista' style='left:16px;top:134px;width:332px;height:570px;z-index:3'><input id='dx-busca' class='dx-busca' type='search' placeholder='Pesquisar' autocomplete='off' aria-label='Pesquisar Pokémon'/><div id='dx-grade' class='dx-grade'></div></div></div>` +
    caixa('dx-hero', 364, 14, 472, 462, 4) +
    `<div class='dx-cx' style='left:520px;top:18px;width:316px;height:30px;z-index:5'><div class='dx-modos' id='dx-modos'>` +
    ['Normal', '✨ Shiny', '🃏 Cartas', '⚔ Golpes'].map(function (m, i) { return `<button class='dx-bt' data-acao='modo' data-m='${i + 1}'>${m}</button>`; }).join('') + '</div></div>' +
    caixa('dx-evo', 360, 486, 480, 218, 4) + caixa('dx-atr', 856, 16, 408, 276, 4) +
    caixa('dx-fraq', 856, 304, 408, 248, 4) + caixa('dx-formas', 856, 564, 408, 140, 4) + '</div>' +
    "<div id='dx-zoom' hidden><div class='dx-zoom-c'><img id='dx-zoom-img' alt=''/><span id='dx-zoom-txt'></span></div></div>";

  var html = document.documentElement;
  function movel() { return html.classList.contains('movel'); }
  function abrirLista(abrir) {
    html.classList.toggle('dx-aberta', abrir);
    html.classList.toggle('travado', abrir && movel());
    if (abrir) { var it = $('dx-grade').querySelector('.dx-it.on'); if (it) { it.scrollIntoView({ block: 'center' }); } }
  }
  function passo(d) {
    var f = filtrados(); if (!f.length) { return; }
    var i = f.findIndex(function (p) { return p.id === idLista(); });
    var novo = f[(i + d + f.length) % f.length].id;
    mudar(function () { S.lista = novo; S.evo = S.forma = null; });
    var it = $('dx-grade').querySelector('.dx-it.on'); if (it && !movel()) { it.scrollIntoView({ block: 'nearest' }); }
  }
  // carta grande: pokemontcg.io tem versão _hires; scrydex (coleções novas) tem /large
  function abrirCarta(src, txt) {
    var img = $('dx-zoom-img');
    img.onerror = function () { img.onerror = null; img.src = src; };
    img.src = /images\.pokemontcg\.io\/.+\.png$/.test(src) ? src.replace(/\.png$/, '_hires.png') : src.replace(/\/small$/, '/large');
    $('dx-zoom-txt').textContent = txt;
    $('dx-zoom').hidden = false;
  }

  function $(id) { return document.getElementById(id); }
  function renderLista() {
    $('dx-grade').innerHTML = listaHtml();
    $('dx-marca').innerHTML = marcaHtml();
    $('dx-abrir-n').textContent = filtrados().length.toLocaleString('pt-BR');
  }
  function renderSel() {
    var p = P[idSel()];
    $('dx-fundo').innerHTML = fundoHtml(p);
    $('dx-hero').innerHTML = heroHtml(p);
    $('dx-atr').innerHTML = atributosHtml(p);
    $('dx-fraq').innerHTML = fraquezasHtml(p);
    $('dx-evo').innerHTML = evolucaoHtml(p);
    $('dx-formas').innerHTML = formasHtml(p);
    $('dx-lend').classList.toggle('on', S.lend);
    [].forEach.call($('dx-modos').children, function (b) { b.classList.toggle('on', +b.getAttribute('data-m') === S.modo); });
    var sel = idLista();
    [].forEach.call($('dx-grade').querySelectorAll('.dx-it'), function (b) { b.classList.toggle('on', +b.getAttribute('data-id') === sel); });
    S.exibido = p.id; S.animar = null;
    try { history.replaceState(null, '', '#' + p.id); } catch (e) { /* sem histórico */ }
  }
  function mudar(fn, evoluir) {
    var antes = S.exibido && P[S.exibido];
    fn();
    var depois = P[idSel()];
    // animação de evolução quando o clique leva a um estágio posterior da mesma cadeia
    S.animar = evoluir && antes && depois.id !== antes.id && depois.chain === antes.chain && depois.est > antes.est && S.modo < 3 ? antes : null;
    renderSel();
  }

  raiz.addEventListener('click', function (ev) {
    if (ev.target.closest('#dx-zoom')) { $('dx-zoom').hidden = true; return; }
    var el = ev.target.closest('[data-acao]'); if (!el) { return; }
    var id = +el.getAttribute('data-id');
    switch (el.getAttribute('data-acao')) {
      case 'lista':
        mudar(function () { S.lista = id; S.evo = null; S.forma = null; });
        if (movel()) { abrirLista(false); window.scrollTo(0, 0); }
        break;
      case 'abrir': abrirLista(true); break;
      case 'fechar': abrirLista(false); break;
      case 'ant': passo(-1); break;
      case 'prox': passo(1); break;
      case 'carta': abrirCarta(el.getAttribute('data-img'), el.getAttribute('data-txt')); break;
      case 'evo': mudar(function () {
        S.forma = null;
        S.evo = (S.evo === id || (!S.evo && id === idLista())) ? null : id;
      }, true); break;
      case 'forma': mudar(function () { S.forma = idForma() === id ? null : id; }); break;
      case 'gfil': S.gfil = el.getAttribute('data-f'); renderSel(); break;
      case 'modo': mudar(function () { var m = +el.getAttribute('data-m'); S.modo = S.modo === m && m !== 1 ? 1 : m; }); break;
      case 'lend': S.lend = !S.lend; S.evo = S.forma = null; renderLista(); renderSel(); break;
    }
  });
  $('dx-gen').addEventListener('change', function () { S.gen = this.value; S.evo = S.forma = null; renderLista(); renderSel(); });
  $('dx-tipo').addEventListener('change', function () { S.tipo = this.value; S.evo = S.forma = null; renderLista(); renderSel(); });
  $('dx-busca').addEventListener('input', function () { S.busca = this.value; renderLista(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { $('dx-zoom').hidden = true; abrirLista(false); }
  });

  // link direto: index.html#25 abre o Pikachu
  var h = +(location.hash || '').slice(1);
  if (P[h]) { var base = P[h].padrao ? h : (PADRAO.find(function (x) { return x.esp === P[h].esp; }) || {}).id; S.lista = base; if (h !== base) { S.forma = h; } }

  renderLista();
  renderSel();
  if (S.lista) { var it = $('dx-grade').querySelector('.dx-it.on'); if (it) { it.scrollIntoView({ block: 'center' }); } }
  K.escala(raiz);
  window.addEventListener('resize', function () { K.escala(raiz); });
})();
