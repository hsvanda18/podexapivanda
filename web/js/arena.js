/* Arena Pokémon: batalhas 1x1 e Time de 3 (com troca) contra a IA ou online contra um amigo.
   Usa window.PK (comum.js) e window.PKOnline (online.js). O estado fica em window.__arena.
   Online ("lockstep"): os dois browsers correm este mesmo motor; a cada turno só trocam as escolhas,
   e os sorteios (precisão, crítico, dano, desempate) saem de rng() com a mesma semente nos dois lados. */
(function () {
  var K = window.PK, raiz = document.getElementById('app-raiz');
  if (!K || !raiz) { return; }
  var D = K.D, P = K.P, LISTA = K.LISTA, esc = K.esc, corTipo = K.corTipo, nomeTipo = K.nomeTipo, icone = K.icone;
  var rng = Math.random;
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= REGRAS ================= */
  /* Equilíbrio (v2): níveis por Pokémon (dados/niveis.js), estágios de atributos, PP, custos dos golpes fortes,
     Truant/Slow Start, Mega/Gigantamax só com o item e evolução ao derrubar um adversário.
     Tudo o que sorteia usa rng() sempre pela mesma ordem: a batalha online depende disso. */
  var G = {};
  D.gp.forEach(function (r) { G[r[0] + '|' + r[1] + '|' + r[2]] = { t: r[0], c: r[1], papel: r[2], nome: r[3], pw: r[4], ac: r[5], pr: r[6], pp: r[6] > 0 ? 30 : 15 }; });
  function golpe(t, c, papel) { return G[t + '|' + c + '|' + papel] || G[t + '|' + (c === 'F' ? 'E' : 'F') + '|' + papel] || null; }
  /* golpes reais (dados/golpes.js): cada Pokémon só usa golpes que aprende nos jogos */
  var GD = window.GOLPES_DADOS;
  var GR = GD ? GD.g.map(function (r, i) {
    return { id: i, nome: r[0], t: r[1], c: r[2], pw: r[3], ac: r[4], pr: r[5], hmin: r[6], hmax: r[7], dr: r[8], ca: r[9],
      pp: r[10] || 10, ef: r[11] || null, esp: r[12] || '' };
  }) : [];
  var VERSAO = D.v + '.' + GR.length + '.r2';
  /* sem PP em nenhum golpe: Struggle (sem tipo, recuo de ¼ do HP) */
  var LUTA = { nome: 'Struggle', t: 'normal', c: 'F', pw: 50, ac: 0, pr: 0, pp: 0, semTipo: true, luta: true };
  function acertosMedios(g) { return !g.hmax || g.hmax <= 1 ? 1 : g.hmin === 2 && g.hmax === 5 ? 3.1 : (g.hmin + g.hmax) / 2; }
  function aprende(p) {
    if (!GD) { return []; }
    var l = GD.a[p.id];
    if (!l) { var base = LISTA.find(function (x) { return x.esp === p.esp && x.padrao; }); l = base && GD.a[base.id]; }
    return (l || []).map(function (i) { return GR[i]; });
  }
  function baixaPropria(g) { return g.ef && g.ef[0] === 'u' && g.ef[2].some(function (x) { return x[1] < 0; }); }
  /* força do golpe nas mãos de p: base da escolha automática e da ordem da lista (já desconta os custos) */
  function forca(p, g) {
    var A = g.c === 'F' ? p.b.atk : p.b.spa, stab = p.t.indexOf(g.t) >= 0 ? 1.5 : 1;
    return g.pw * acertosMedios(g) * stab * A * (g.ac ? g.ac / 100 : 1) * (g.ca === 2 ? 1.5 : g.ca === 1 ? 1.06 : 1) * (g.dr < 0 ? 0.9 : 1) *
      (baixaPropria(g) ? 0.8 : 1) * (g.esp === 'hp' ? 0.75 : g.esp === 'furia' ? 0.9 : 1) * (g.pp <= 5 ? 0.95 : 1);
  }
  /* escolha automática: o melhor golpe de cada tipo do Pokémon, depois cobertura de outros tipos */
  function golpesAuto(p) {
    var cand = aprende(p).sort(function (a, b) { return forca(p, b) - forca(p, a); });
    if (!cand.length) { return null; }
    var out = [], topo = forca(p, cand[0]);
    p.t.forEach(function (t) { var g = cand.find(function (x) { return x.t === t; }); if (g && out.length < 4) { out.push(g); } });
    cand.forEach(function (g) { if (out.length < 4 && out.indexOf(g) < 0 && forca(p, g) >= topo * 0.35 && !out.some(function (x) { return x.t === g.t; })) { out.push(g); } });
    cand.forEach(function (g) { if (out.length < 4 && out.indexOf(g) < 0) { out.push(g); } });
    return out.map(function (g) { return g.id; });
  }
  function golpesDe(p, ids) {
    var lista = (ids && ids.length ? ids : golpesAuto(p) || []).map(function (i) { return GR[i]; }).filter(Boolean);
    return lista.length ? lista.slice(0, 4) : golpesGenericos(p);
  }
  /* reserva: os golpes por tipo de antes (Pokémon sem lista de golpes de dano, como o Ditto) */
  function golpesGenericos(p) {
    var cat = p.b.atk >= p.b.spa ? 'F' : 'E', outra = cat === 'F' ? 'E' : 'F', t1 = p.t[0], t2 = p.t[1];
    var lista = [golpe(t1, cat, 'forte'), t2 ? golpe(t2, cat, 'forte') : golpe(t1, outra, 'forte'), golpe(t1, cat, 'medio'),
      G[t1 + '|F|prio'] || (t2 && G[t2 + '|F|prio']) || G['normal|F|prio'], golpe('normal', cat, 'forte'), golpe('normal', cat, 'medio')];
    var vistos = {}, out = [];
    lista.forEach(function (g) { if (g && !vistos[g.nome] && out.length < 4) { vistos[g.nome] = 1; out.push(g); } });
    return out;
  }

  /* ---------- níveis equilibrados (calibrados por simulação; ver calibrar()) ---------- */
  var NIV = window.NIVEIS || {};
  function ehFormaEspecial(p) { return !p.padrao && / (Mega|Gigantamax|Primal|Eternamax)/.test(p.nome); }
  function baseDe(p) { return ehFormaEspecial(p) ? (LISTA.find(function (x) { return x.esp === p.esp && x.padrao; }) || p) : p; }
  function nivelFormula(p) { return Math.max(40, Math.min(100, Math.round(50 * Math.pow(500 / Math.max(180, p.total), 1.1)))); }
  function nivelDe(p) { var b = baseDe(p); return NIV[b.id] || nivelFormula(b); }
  function statusDe(b, nv) {
    var f = function (x) { return Math.floor((2 * x + 31) * nv / 100) + 5; };
    return { hp: Math.floor((2 * b.hp + 31) * nv / 100) + nv + 10, atk: f(b.atk), def: f(b.def), spa: f(b.spa), spd: f(b.spd), spe: f(b.spe) };
  }

  /* ---------- evolução em batalha: ao derrubar um adversário, evolui para o próximo estágio ---------- */
  var FILHOS = {};
  D.pk.forEach(function (r) { if (r[14] && r[11] === 1 && P[r[0]]) { (FILHOS[r[14]] || (FILHOS[r[14]] = [])).push(P[r[0]]); } });
  Object.keys(FILHOS).forEach(function (k) { FILHOS[k].sort(function (a, b) { return a.esp - b.esp; }); });
  function evolucaoDe(p) { var f = FILHOS[p.esp]; return f && f.length ? f[0] : null; }

  /* ---------- habilidades que travam (por espécie) ---------- */
  var PREGUICA = { 289: 1 };   // Slaking (Truant): ataca um turno sim, outro não
  var LENTO = { 486: 1 };      // Regigigas (Slow Start): metade do Ataque e da Velocidade nos 5 primeiros turnos em campo

  /* ---------- lutador ---------- */
  function zeroEst() { return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }; }
  function lutador(id, ids, item) {
    var p = P[id], nv = nivelDe(p), st = statusDe(p.b, nv), gs = golpesDe(p, ids);
    return { p: p, nv: nv, st: st, hpMax: st.hp, hp: st.hp, golpes: gs, pp: gs.map(function (g) { return g.pp || 10; }), est: zeroEst(),
      item: item || null, preso: null, descansa: false, lento: 0 };
  }
  function novoLado(ids, mv, itens) { return { time: ids.map(function (id) { return lutador(id, mv && mv[id], itens && itens[id]); }), ativo: 0 }; }
  function ativo(l) { return l.time[l.ativo]; }
  function vivos(l) { return l.time.filter(function (m) { return m.hp > 0; }); }

  /* ---------- estágios de atributos (-6 a +6) ---------- */
  var NOME_ATR = { atk: 'Ataque', def: 'Defesa', spa: 'Atq. Esp.', spd: 'Def. Esp.', spe: 'Velocidade' };
  var CURTO_ATR = { atk: 'ATQ', def: 'DEF', spa: 'A.ESP', spd: 'D.ESP', spe: 'VEL' };
  function multEst(s) { return s >= 0 ? (2 + s) / 2 : 2 / (2 - s); }
  function lentoAtivo(m) { return !!LENTO[m.p.esp] && m.lento < 5; }
  /* crítico ignora as baixas de quem ataca e as subidas de quem defende */
  function atributo(m, k, crit, atacando) {
    var s = m.est ? m.est[k] : 0;
    if (crit && ((atacando && s < 0) || (!atacando && s > 0))) { s = 0; }
    var v = m.st[k] * multEst(s);
    if ((k === 'atk' || k === 'spe') && lentoAtivo(m)) { v *= 0.5; }
    return v;
  }
  function velocidade(m) { return atributo(m, 'spe'); }
  function mudarEst(m, k, d) { var antes = m.est[k]; m.est[k] = Math.max(-6, Math.min(6, antes + d)); return m.est[k] - antes; }
  /* ao sair de campo, estágios, fúria e contadores voltam ao normal */
  function sairDeCampo(m) { m.est = zeroEst(); m.preso = null; m.descansa = false; m.lento = 0; }

  /* ---------- Mega Evolução e Gigantamax: só quem leva o item, uma vez por time ---------- */
  function formasDe(p, tipo) {
    var chave = tipo === 'mega' ? ' Mega' : ' Gigantamax';
    return LISTA.filter(function (x) { return x.esp === p.esp && !x.padrao && x.nome.indexOf(chave) > 0; });
  }
  /* itens possíveis para p: a Mega/Gmax dele ou de uma evolução futura (o item acompanha a evolução) */
  function itensPossiveis(p) {
    var out = [], q = p, n = 0;
    while (q && n++ < 4) {
      if (out.indexOf('mega') < 0 && formasDe(q, 'mega').length) { out.push('mega'); }
      if (out.indexOf('gmax') < 0 && formasDe(q, 'gmax').length) { out.push('gmax'); }
      q = evolucaoDe(q);
    }
    return out;
  }
  function opcoesTransformar(l) {
    var m = ativo(l);
    if (l.transformou || m.hp <= 0 || m.base || !m.item) { return []; }
    return formasDe(m.p, m.item).map(function (f) { return { tipo: m.item, p: f }; });
  }
  /* Max: poder pela faixa do golpe original (Lutador e Venenoso mais fracos, como nos jogos) */
  function poderMax(g) {
    var pw = g.pw * acertosMedios(g), fraco = g.t === 'fighting' || g.t === 'poison';
    var faixa = pw < 45 ? 0 : pw < 55 ? 1 : pw < 65 ? 2 : pw < 75 ? 3 : pw < 110 ? 4 : pw < 150 ? 5 : 6;
    return (fraco ? [70, 75, 80, 85, 90, 95, 100] : [90, 100, 110, 120, 130, 140, 150])[faixa];
  }
  function aplicarForma(m, op) {
    var razao = m.hp / m.hpMax;
    // a Mega mantém os golpes escolhidos; o Gigantamax troca-os pelos golpes Max (HP ×1,5 durante 3 turnos)
    m.base = m.p; m.forma = op.tipo; m.p = op.p; m.st = statusDe(op.p.b, m.nv); m.hpMax = m.st.hp; m.golpesBase = m.golpes;
    if (op.tipo === 'gmax') {
      m.hpMax = Math.round(m.hpMax * 1.5); m.gmax = 3; m.preso = null;
      m.golpes = m.golpesBase.map(function (g) { return { t: g.t, c: g.c, nome: 'Max ' + nomeTipo(g.t), pw: poderMax(g), ac: 0, pr: 0, pp: g.pp, max: true }; });
    }
    m.hp = Math.max(1, Math.round(razao * m.hpMax));
  }
  function desfazerGmax(m) {
    var razao = m.hp / m.hpMax, p = m.base;
    m.p = p; m.st = statusDe(p.b, m.nv); m.hpMax = m.st.hp; m.golpes = m.golpesBase || golpesDe(p); m.golpesBase = null; m.gmax = 0; m.base = null; m.forma = null;
    m.hp = m.hp <= 0 ? 0 : Math.max(1, Math.round(razao * m.hpMax));
  }
  function rotuloForma(op) {
    if (op.tipo === 'gmax') { return '🔴 Gigantamax'; }
    var sufixo = op.p.nome.split(' Mega')[1] || '';
    return '💎 Mega Evoluir' + (sufixo.trim() ? ' ' + sufixo.trim() : '');
  }

  /* ---------- dano ---------- */
  function efTotal(tipo, alvo) { return K.efTotal(tipo, alvo.t); }
  function poderDe(a, g) { return g.esp === 'hp' ? Math.max(1, Math.floor(150 * a.hp / a.hpMax)) : g.pw; }
  function danoBase(a, d, g, crit) {
    var A = atributo(a, g.c === 'F' ? 'atk' : 'spa', crit, true), Df = atributo(d, g.c === 'F' ? 'def' : 'spd', crit, false);
    return Math.floor(Math.floor(Math.floor(2 * a.nv / 5 + 2) * poderDe(a, g) * A / Df) / 50) + 2;
  }
  function calcular(a, d, g) {
    var e = g.semTipo ? 1 : efTotal(g.t, d.p);
    if (!(g.ac === 0 || rng() * 100 < g.ac)) { return { erro: true, dano: 0, ef: e, crit: false, acertos: 0 }; }
    var stab = !g.semTipo && a.p.t.indexOf(g.t) >= 0 ? 1.5 : 1;
    var crit = g.ca === 2 || rng() < (g.ca === 1 ? 1 / 8 : 1 / 24), variacao = 0.85 + rng() * 0.15;
    var acertos = 1;
    if (g.hmax > 1) {
      var r = rng();
      acertos = g.hmin === 2 && g.hmax === 5 ? (r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5) : g.hmin + Math.floor(r * (g.hmax - g.hmin + 1));
    }
    var dano = e === 0 ? 0 : Math.max(1, Math.floor(danoBase(a, d, g, crit) * stab * e * (crit ? 1.5 : 1) * variacao)) * acertos;
    return { erro: false, dano: dano, ef: e, crit: crit, acertos: acertos };
  }
  function esperado(a, d, g) {
    var stab = !g.semTipo && a.p.t.indexOf(g.t) >= 0 ? 1.5 : 1, critMedio = g.ca === 2 ? 1.5 : g.ca === 1 ? 1.0625 : 1.02;
    return danoBase(a, d, g, false) * stab * (g.semTipo ? 1 : efTotal(g.t, d.p)) * (g.ac === 0 ? 1 : g.ac / 100) * acertosMedios(g) * critMedio * 0.925;
  }
  /* dreno (cura quem atacou) e recuo (fere quem atacou, sem o derrubar) */
  function efeitoDreno(a, g, causado) {
    if (!g.dr || causado <= 0 || a.hp <= 0) { return 0; }
    var x = Math.max(1, Math.floor(causado * Math.abs(g.dr) / 100));
    if (g.dr > 0) { x = Math.min(x, a.hpMax - a.hp); a.hp += x; return x; }
    x = Math.min(x, a.hp - 1); a.hp -= x; return -x;
  }

  /* ---------- usar um golpe: regras comuns à batalha e à simulação ---------- */
  /* decide o golpe que sai mesmo (preguiça, fúria, PP) e gasta o PP */
  function golpeEfetivo(a, idx) {
    if (PREGUICA[a.p.esp] && a.descansa) { a.descansa = false; return { descansa: true }; }
    if (PREGUICA[a.p.esp]) { a.descansa = true; }
    if (a.preso) { idx = a.preso.idx; }
    if (!a.pp.some(function (x) { return x > 0; })) { return { g: LUTA, idx: -1 }; }
    if (!(a.pp[idx] > 0)) { idx = a.pp.findIndex(function (x) { return x > 0; }); }
    a.pp[idx]--;
    return { g: a.golpes[idx], idx: idx };
  }
  /* depois do golpe: dreno/recuo, Struggle, efeitos nos atributos e fúria; devolve o que aconteceu */
  function efeitosDepois(a, d, g, r, causado, idx) {
    var ev = { dreno: 0, est: [] };
    if (g.luta) {
      var rec = Math.min(Math.max(1, Math.floor(a.hpMax / 4)), a.hp - 1);
      if (rec > 0) { a.hp -= rec; ev.dreno = -rec; }
    } else { ev.dreno = efeitoDreno(a, g, causado); }
    if (g.ef && !r.erro && r.ef !== 0) {
      var alvo = g.ef[0] === 'u' ? a : d;
      if (alvo.hp > 0 && (g.ef[1] >= 100 || rng() * 100 < g.ef[1])) {
        g.ef[2].forEach(function (x) { ev.est.push({ quem: alvo === a ? 'a' : 'd', k: x[0], d: mudarEst(alvo, x[0], x[1]), pedido: x[1] }); });
      }
    }
    if (g.esp === 'furia') {
      if (r.erro || r.ef === 0) { a.preso = null; }
      else if (!a.preso) { a.preso = { idx: idx, resta: rng() < 0.5 ? 1 : 2 }; }
      else { a.preso.resta--; if (a.preso.resta <= 0) { a.preso = null; ev.cansou = true; } }
    }
    return ev;
  }
  /* derrubou um adversário: evolui (nível a meio caminho entre o atual e o equilibrado da evolução) */
  function evoluir(m) {
    if (m.hp <= 0 || m.base || m.gmax) { return null; }
    var nova = evolucaoDe(m.p); if (!nova) { return null; }
    var razao = m.hp / m.hpMax, antes = m.p;
    m.nv = Math.round((m.nv + nivelDe(nova)) / 2);
    m.p = nova; m.st = statusDe(nova.b, m.nv); m.hpMax = m.st.hp; m.hp = Math.max(1, Math.round(razao * m.hpMax));
    return antes;
  }
  /* fim do turno: o Início Lento conta os turnos em campo */
  function fimTurnoLado(l) { var m = ativo(l); if (m.hp > 0 && LENTO[m.p.esp] && m.lento < 5) { m.lento++; } }
  function prioridade(m, ac) {
    if (ac.tipo === 'troca') { return 10; }
    if (!m.pp.some(function (x) { return x > 0; })) { return 0; }
    var g = m.golpes[m.preso ? m.preso.idx : ac.idx];
    return g ? g.pr : 0;
  }

  /* ---------- IA ---------- */
  function golpesDisponiveis(a) {
    if (a.preso) { return [a.preso.idx]; }
    var l = []; a.pp.forEach(function (x, i) { if (x > 0) { l.push(i); } });
    return l.length ? l : [0];
  }
  function melhorEsperado(a, d) {
    var gs = golpesDisponiveis(a);
    return Math.max.apply(null, gs.map(function (i) { return a.pp.some(function (x) { return x > 0; }) ? esperado(a, d, a.golpes[i]) : esperado(a, d, LUTA); }));
  }
  function iaGolpe(a, d) {
    var rapido = velocidade(a) >= velocidade(d), melhor = golpesDisponiveis(a)[0], nota = -1;
    golpesDisponiveis(a).forEach(function (i) {
      var g = a.golpes[i], v = esperado(a, d, g);
      if (g.pr > 0 && !rapido && v >= d.hp) { v += 1000; }
      if (baixaPropria(g) && v < d.hp) { v *= 0.8; }
      v *= 0.9 + Math.random() * 0.2;
      if (v > nota) { nota = v; melhor = i; }
    });
    return melhor;
  }
  function iaMelhorReserva(l, foe) {
    var melhor = -1, nota = -1e9;
    l.time.forEach(function (m, i) {
      if (m.hp <= 0 || i === l.ativo) { return; }
      var v = melhorEsperado(m, foe) / foe.hp - melhorEsperado(foe, m) / m.hp;
      if (v > nota) { nota = v; melhor = i; }
    });
    return melhor;
  }
  function iaAcao(l, foeLado) {
    var eu = ativo(l), foe = ativo(foeLado);
    if (vivos(l).length > 1 && !eu.preso) {
      var ameaca = melhorEsperado(foe, eu) / eu.hp, forca = melhorEsperado(eu, foe) / foe.hp;
      if (ameaca >= 0.9 && forca < 0.6 && Math.random() < 0.45) {
        var r = iaMelhorReserva(l, foe);
        if (r >= 0 && melhorEsperado(foe, l.time[r]) / l.time[r].hp < ameaca * 0.6) { return { tipo: 'troca', idx: r }; }
      }
    }
    return { tipo: 'golpe', idx: iaGolpe(eu, foe) };
  }
  function ordem(B, aj, ao) {
    var acoes = [{ lado: 'j', a: aj }, { lado: 'o', a: ao }];
    if (B.online) {
      // online: exatamente um sorteio por turno; empate de prioridade e velocidade decidido por ele
      var r = rng(), ladoHost = B.host ? 'j' : 'o';
      var chaveOn = function (x) { var m = ativo(B[x.lado]); return [prioridade(m, x.a), velocidade(m)]; };
      return acoes.sort(function (x, y) {
        var a = chaveOn(x), b = chaveOn(y);
        return b[0] - a[0] || b[1] - a[1] || ((x.lado === ladoHost) === (r < 0.5) ? -1 : 1);
      });
    }
    function chave(x) { var m = ativo(B[x.lado]); return [prioridade(m, x.a), velocidade(m) + Math.random() * 0.1]; }
    acoes.sort(function (x, y) { var a = chave(x), b = chave(y); return b[0] - a[0] || b[1] - a[1]; });
    return acoes;
  }

  /* ---------- simulação rápida (previsão, Simular ×1000 e calibração dos níveis) ---------- */
  function simular(idsJ, idsO, mvJ, mvO) {
    var B = { j: novoLado(idsJ, mvJ || S.mv.j), o: novoLado(idsO, mvO || S.mv.o) }, turnos = 0;
    while (vivos(B.j).length && vivos(B.o).length && turnos < 300) {
      turnos++;
      var acoes = ordem(B, iaAcao(B.j, B.o), iaAcao(B.o, B.j));
      for (var k = 0; k < acoes.length; k++) {
        var lado = acoes[k].lado, foe = lado === 'j' ? 'o' : 'j', ac = acoes[k].a;
        if (ac.tipo === 'troca') { sairDeCampo(ativo(B[lado])); B[lado].ativo = ac.idx; continue; }
        var a = ativo(B[lado]), d = ativo(B[foe]);
        if (a.hp <= 0) { continue; }
        var uso = golpeEfetivo(a, ac.idx);
        if (uso.descansa) { continue; }
        var r = calcular(a, d, uso.g), antes = d.hp;
        d.hp = Math.max(0, d.hp - r.dano);
        efeitosDepois(a, d, uso.g, r, antes - d.hp, uso.idx);
        if (d.hp <= 0) {
          evoluir(a);
          var rs = iaMelhorReserva(B[foe], a);
          if (rs >= 0) { sairDeCampo(d); B[foe].ativo = rs; }
          break;
        }
      }
      fimTurnoLado(B.j); fimTurnoLado(B.o);
    }
    return { venc: vivos(B.j).length ? 'j' : 'o', turnos: turnos };
  }
  function rodarSimulacoes(n) {
    var vj = 0, tt = 0;
    for (var i = 0; i < n; i++) { var r = simular(S.time.j, S.time.o); if (r.venc === 'j') { vj++; } tt += r.turnos; }
    return { j: 100 * vj / n, o: 100 - 100 * vj / n, turnos: tt / n, n: n };
  }

  /* ================= ESTADO ================= */
  /* fotografia da batalha local (só entre turnos): Pokémon por id, com HP, forma e golpes */
  function fotoLutador(m) {
    return { pid: m.p.id, bid: m.base ? m.base.id : null, forma: m.forma || null, hp: m.hp, hpMax: m.hpMax, gmax: m.gmax || 0, golpes: m.golpes, golpesBase: m.golpesBase || null,
      nv: m.nv, pp: m.pp, est: m.est, item: m.item, preso: m.preso, descansa: m.descansa, lento: m.lento };
  }
  function lutadorDaFoto(f) {
    var p = P[f.pid]; if (!p || !f.nv || !f.pp) { return null; }
    return { p: p, nv: f.nv, st: statusDe(p.b, f.nv), hp: f.hp, hpMax: f.hpMax, golpes: f.golpes, golpesBase: f.golpesBase, base: f.bid ? P[f.bid] : null, forma: f.forma, gmax: f.gmax,
      pp: f.pp, est: f.est || zeroEst(), item: f.item || null, preso: f.preso || null, descansa: !!f.descansa, lento: f.lento || 0 };
  }
  function fotoBatalha(B) {
    var lado = function (l) { return { ativo: l.ativo, transformou: !!l.transformou, time: l.time.map(fotoLutador) }; };
    return { j: lado(B.j), o: lado(B.o) };
  }
  function batalhaDaFoto(f) {
    var lado = function (l) { return { ativo: l.ativo, transformou: l.transformou, time: l.time.map(lutadorDaFoto) }; };
    var B = { j: lado(f.j), o: lado(f.o) };
    return B.j.time.every(Boolean) && B.o.time.every(Boolean) ? B : null;
  }
  if (!window.__arena) {
    var salvo = K.restaurar('arena', 72);
    if (salvo && salvo.versao === D.v) {
      salvo.B = salvo.foto ? batalhaDaFoto(salvo.foto) : null;
      if (!salvo.B && salvo.tela === 'batalha') { salvo.tela = 'selecao'; }
      Object.assign(salvo, { ocupado: false, auto: false, sim: null, previa: null, foto: null, ge: null, online: false, on: null });
      window.__arena = salvo;
    }
  }
  var S = window.__arena;
  if (!S || S.versao !== D.v) {
    S = window.__arena = { versao: D.v, tela: 'selecao', modo: 3, lado: 'j', time: { j: [], o: [] }, busca: '', tipo: '', gen: 0,
      B: null, log: [], msg: '', ocupado: false, auto: false, sim: null, previa: null, escolha: null, fim: null };
  }
  /* estado online: escolhas por turno (n) dos dois lados, trocas forçadas e verificação de sincronia */
  function novaPartida() {
    return { turno: 0, minhas: {}, deles: {}, trocas: {}, minhasTrocas: {}, syncEu: {}, syncEle: {}, forma: null, revEu: false, revEle: false, esperaTroca: null, resolverTroca: null };
  }
  if (!S.on) {
    S.online = false;
    S.on = { pronto: false, opPronto: false, opQtd: 0, opTime: [], codigo: '', aviso: '', host: false, p: novaPartida() };
  }
  if (!S.mv) { S.mv = { j: {}, o: {} }; }
  if (!S.itens) { S.itens = { j: {}, o: {} }; }
  var NET = window.PKOnline;
  function emOnline() { return !!(S.B && S.B.online); }
  function $(id) { return document.getElementById(id); }
  /* S.rapido: reconstrói uma batalha online a partir das jogadas guardadas, sem esperar pelas animações */
  function esperar(ms) { return S.rapido ? Promise.resolve() : new Promise(function (r) { setTimeout(r, ms); }); }
  function tamanhoTime() { return S.modo === 1 ? 1 : 3; }

  /* ================= SELEÇÃO ================= */
  function slotHtml(l, i) {
    var id = S.time[l][i];
    if (!id) { return `<div class='sl sl-vazio' data-acao='lado' data-lado='${l}'><b>+</b><span>Escolher Pokémon</span></div>`; }
    var p = P[id];
    return `<div class='sl sl-cheio' style='--c:${corTipo(p.t[0])}'>
      <div class='sl-arte'>${K.img([K.URL.arte(id), K.URL.home(id)])}</div>
      <div class='sl-info'><b title='${esc(p.nome)}'>${esc(p.nome)}</b><div class='sl-tipos'>${p.t.map(K.chip).join('')}</div><span>Nv. ${nivelDe(p)} · base ${p.total}</span></div>
        ${itemHtml(l, p)}<div class='sl-gps' data-acao='editarGolpes' data-lado='${l}' data-id='${id}' title='Escolher golpes'>${golpesDe(p, S.mv[l][id]).map(function (g) { return icone(g.t, 14); }).join('')}<em>✎ Golpes</em>${S.mv[l][id] ? '' : '<small>auto</small>'}</div>
      <i data-acao='tirar' data-lado='${l}' data-i='${i}'>×</i></div>`;
  }
  /* botão do item: só para quem tem (ou terá ao evoluir) Mega ou Gigantamax; um item por time */
  function itemHtml(l, p) {
    var pos = itensPossiveis(p); if (!pos.length) { return ''; }
    var meu = S.itens[l][p.id];
    var txt = meu === 'mega' ? '💎' : meu === 'gmax' ? '🔴' : '＋';
    var dica = meu ? (meu === 'mega' ? 'Leva a Pedra Mega' : 'Leva o Fator Gigantamax') + ' · toca para mudar' : 'Dar Pedra Mega / Fator Gigantamax (um por time)';
    return `<b class='sl-item${meu ? ' on ' + meu : ''}' data-acao='item' data-lado='${l}' data-id='${p.id}' title='${dica}'>${txt}</b>`;
  }
  function trocarItem(l, id) {
    var pos = itensPossiveis(P[id]), atual = S.itens[l][id], ciclo = [null].concat(pos);
    var prox = ciclo[(ciclo.indexOf(atual || null) + 1) % ciclo.length];
    S.itens[l] = {};
    if (prox) { S.itens[l][id] = prox; }
  }
  /* sem item escolhido, o primeiro do time que puder leva-o (Mega primeiro) */
  function itensAuto(ids) {
    var out = {};
    ['mega', 'gmax'].some(function (tipo) {
      var id = ids.find(function (i) { return itensPossiveis(P[i]).indexOf(tipo) >= 0; });
      if (id) { out[id] = tipo; return true; }
      return false;
    });
    return out;
  }
  function itensDoTime(l) {
    var out = {};
    Object.keys(S.itens[l] || {}).forEach(function (id) { if (S.time[l].indexOf(+id) >= 0) { out[id] = S.itens[l][id]; } });
    return out;
  }
  function colunaHtml(l, titulo) {
    var slots = '';
    for (var i = 0; i < tamanhoTime(); i++) { slots += slotHtml(l, i); }
    return `<div class='sel-col sel-col-${l}${S.lado === l ? ' ativo' : ''}' data-acao='lado' data-lado='${l}'>
      <div class='sel-col-tit'><span>${titulo}</span><em>${S.time[l].length}/${tamanhoTime()}</em></div>
      <div class='sel-slots m${tamanhoTime()}'>${slots}</div>
      <div class='bt bt-sec' data-acao='aleatorio' data-lado='${l}'>🎲 Sortear time</div></div>`;
  }
  function filtrados() {
    var b = K.normalizar(S.busca);
    return LISTA.filter(function (p) {
      return !ehFormaEspecial(p) && (!b || K.normalizar(p.nome).indexOf(b) >= 0 || String(p.esp) === b) && (!S.tipo || p.t.indexOf(S.tipo) >= 0) && (!S.gen || p.gen === S.gen);
    });
  }
  function gradeHtml() {
    var itens = filtrados(), total = itens.length;
    var html = itens.slice(0, 210).map(function (p) {
      var no = S.time.j.indexOf(p.id) >= 0 ? ' no-j' : S.time.o.indexOf(p.id) >= 0 ? ' no-o' : '';
      return `<div class='cd${no}' data-acao='add' data-id='${p.id}' style='--c:${corTipo(p.t[0])}'>
        <img loading='lazy' src='${K.URL.sprite(p.id)}'/><span>${esc(p.nome)}</span><em>${p.t.map(function (t) { return icone(t, 13); }).join('')}</em></div>`;
    }).join('');
    if (total > 210) { html += `<div class='cd-mais'>+${total - 210} Pokémon — refine a busca</div>`; }
    return html || `<div class='cd-mais'>Nenhum Pokémon encontrado</div>`;
  }
  function previaHtml() {
    var cheio = S.time.j.length === tamanhoTime() && S.time.o.length === tamanhoTime();
    if (!cheio) { return `<span class='pv-dica'>Clique num lado e escolha os Pokémon na grade · nível 50 · golpes definidos pelos tipos</span>`; }
    var chave = S.modo + ':' + S.time.j.join(',') + 'x' + S.time.o.join(',') + ':' + JSON.stringify(S.mv) + JSON.stringify(S.itens);
    if (!S.previa || S.previa.chave !== chave) { S.previa = rodarSimulacoes(300); S.previa.chave = chave; }
    var pj = S.previa.j;
    return `<div class='pv'><span class='pv-tit'>PREVISÃO</span>
      <div class='pv-barra'><div class='pv-j' style='width:${pj}%'>${pj.toFixed(0)}%</div><div class='pv-o'>${(100 - pj).toFixed(0)}%</div></div>
      <span class='pv-tx'>${pj >= 60 ? 'Seu time é favorito' : pj <= 40 ? 'O oponente é favorito' : 'Confronto equilibrado'}</span></div>`;
  }
  function telaSelecao() {
    var cheio = S.time.j.length === tamanhoTime() && S.time.o.length === tamanhoTime();
    var chips = K.TIPOS.map(function (t) {
      return `<span class='tc${S.tipo === t ? ' on' : ''}' data-acao='tipo' data-t='${t}' title='${nomeTipo(t)}' style='--c:${corTipo(t)}'>${icone(t, 22)}</span>`;
    }).join('');
    var gens = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (g) {
      return `<span class='gc${S.gen === g ? ' on' : ''}' data-acao='gen' data-g='${g}'>${g ? 'Gen ' + g : 'Todas'}</span>`;
    }).join('');
    var travaModo = S.online && NET.papel === 'conv' && ligadoOuAusente() ? ' off' : '';
    var rodape = S.online ? rodapeOnline() : `<div id='ar-previa'>${previaHtml()}</div>
        <div class='bt bt-go${cheio ? '' : ' off'}' data-acao='batalhar'>⚔ BATALHAR!</div>`;
    return `<div class='pk-palco sel${S.online ? ' sel-online' : ''}'>
      <div class='sel-bg'></div>
      <div class='topo'><div class='modos'>
        <span class='${S.modo === 1 ? 'on' : ''}${travaModo}' data-acao='modo' data-m='1'>⚔ 1 x 1</span>
        <span class='${S.modo === 3 ? 'on' : ''}${travaModo}' data-acao='modo' data-m='3'>🛡 Time de 3</span>
        <span class='md-online${S.online ? ' on' : ''}' data-acao='online'>🌐 Online</span></div>
        <div class='titulo'><b>ARENA</b><span>${S.online ? 'batalhe contra um amigo' : 'monte os times e batalhe'}</span></div></div>
      ${colunaHtml('j', 'SEU TIME')}
      <div class='sel-meio'>
        <input id='ar-busca' class='busca' placeholder='🔍  Buscar Pokémon pelo nome ou número...' value='${esc(S.busca)}'/>
        <div class='gens'>${gens}</div>
        <div class='tcs'>${chips}</div>
        <div id='ar-grade' class='grade'>${gradeHtml()}</div>
      </div>
      ${S.online ? salaHtml() : colunaHtml('o', 'OPONENTE')}
      <div class='sel-rodape'>${rodape}</div>
      ${S.ge ? editorHtml() : ''}
    </div>`;
  }
  /* coluna da direita no modo online: criar sala, entrar com código ou estado do adversário */
  function salaHtml() {
    var e = NET ? NET.estado : 'erro', corpo = '', tit = 'ADVERSÁRIO ONLINE', tag = '';
    var aviso = S.on.aviso ? `<div class='sala-aviso'>${esc(S.on.aviso)}</div>` : '';
    var entrarHtml = `<div class='sala-ou'><span>ou entra na sala de um amigo</span></div>
      <div class='sala-entrar'><input id='ar-codigo' class='busca' maxlength='6' placeholder='CÓDIGO' autocomplete='off' value='${esc(S.on.codigo)}'/>
      <div class='bt bt-sec' data-acao='entrarSala'>Entrar</div></div>`;
    if (!NET) {
      corpo = `<p class='sala-tx'>O modo online não carregou. Recarrega a página.</p>`;
    } else if (!NET.configurado) {
      corpo = `<p class='sala-tx'>O modo online ainda não está configurado neste site (falta ligar o Supabase em <b>js/config.js</b>).</p>`;
    } else if (e === 'off' || e === 'erro' || e === 'caiu') {
      corpo = (e !== 'off' ? `<div class='sala-erro'>${esc(NET.erro)}</div>` : `<p class='sala-tx'>Joga contra um amigo noutro telemóvel ou computador. É grátis, não precisa de conta e podes minimizar a app: a batalha fica guardada.</p>`) +
        `<div class='bt bt-go sala-criar' data-acao='criarSala'>＋ Criar sala</div>` + entrarHtml;
    } else if (e === 'a-ligar') {
      corpo = `<div class='sala-espera'><i class='sala-giro'></i>${NET.papel === 'conv' ? 'A entrar na sala ' + esc(NET.codigo || '') + '...' : 'A criar a sala...'}</div>`;
    } else if (e === 'sala') {
      var link = NET.link(), zap = 'https://wa.me/?text=' + encodeURIComponent('Bora uma batalha Pokémon? ⚔️ Entra na minha sala: ' + link);
      tag = 'à espera';
      corpo = `<p class='sala-tx'>Sala criada! Manda o código ou o link ao teu amigo:</p>
        <div class='sala-cod'>${esc(NET.codigo)}</div>
        <input id='ar-link' class='busca sala-link' readonly value='${esc(link)}'/>
        <div class='sala-bts'><div class='bt bt-sec' data-acao='copiarLink' id='ar-copiar'>📋 Copiar link</div>
        <a class='bt bt-zap' href='${zap}' target='_blank' rel='noopener'>💬 WhatsApp</a></div>
        <div class='sala-espera'><i class='sala-giro'></i>À espera do adversário...</div>
        <div class='bt bt-sec sala-sair' data-acao='sairSala'>Cancelar</div>`;
    } else if (e === 'ligado' || e === 'ausente') {
      var n = tamanhoTime(), slots = '';
      for (var i = 0; i < n; i++) { slots += `<div class='sl sala-sl${i < S.on.opQtd ? ' cheio' : ''}'><b>${i < S.on.opQtd ? '?' : '+'}</b><span>${i < S.on.opQtd ? 'Escolhido' : 'A escolher...'}</span></div>`; }
      tag = S.on.opPronto ? '✓ pronto' : S.on.opQtd + '/' + n;
      corpo = (e === 'ligado' ? `<div class='sala-ok'>✓ Adversário ligado${NET.papel === 'conv' ? ' · sala ' + esc(NET.codigo) : ''}</div>`
        : `<div class='sala-aus'>⏸ Adversário fora da app${NET.papel === 'conv' ? ' · sala ' + esc(NET.codigo) : ''}</div>`) + `
        <div class='sel-slots m${n}'>${slots}</div>
        <p class='sala-tx'>${NET.papel === 'host' ? 'Tu escolhes o formato (1 x 1 ou Time de 3) lá em cima.' : 'O formato é escolhido por quem criou a sala.'} O time dele só aparece quando a batalha começar.</p>
        <div class='bt bt-sec sala-sair' data-acao='sairSala'>Sair da sala</div>`;
    }
    return `<div class='sel-col sel-col-o sala'><div class='sel-col-tit'><span>${tit}</span><em>${tag}</em></div>${aviso}<div class='sala-corpo'>${corpo}</div></div>`;
  }
  function rodapeOnline() {
    var ligado = ligadoOuAusente(), cheio = S.time.j.length === tamanhoTime();
    var dica = !ligado ? 'Cria uma sala ou entra com o código de um amigo' :
      !cheio ? 'Monta o teu time e carrega em PRONTO · nível 50 · golpes definidos pelos tipos' :
      S.on.pronto ? (S.on.opPronto ? 'A começar...' : 'À espera que o adversário fique pronto...') : 'Time completo! Carrega em PRONTO';
    return `<span class='pv-dica'>${dica}</span>
      <div class='bt bt-go${ligado && cheio ? '' : ' off'}${S.on.pronto ? ' pronto' : ''}' data-acao='pronto'>${S.on.pronto ? '✓ PRONTO · cancelar' : '⚔ PRONTO'}</div>`;
  }


  /* ================= EDITOR DE GOLPES ================= */
  function extrasHtml(p, g) {
    var x = [];
    if (p.t.indexOf(g.t) >= 0) { x.push("<i class='ge-stab'>STAB</i>"); }
    if (g.pr > 0) { x.push(`<i>⚡ prioridade +${g.pr}</i>`); }
    if (g.hmax > 1) { x.push(`<i>${g.hmin === g.hmax ? g.hmin : g.hmin + '–' + g.hmax} acertos</i>`); }
    if (g.dr > 0) { x.push(`<i>drena ${g.dr}%</i>`); }
    if (g.dr < 0) { x.push(`<i>recuo ${-g.dr}%</i>`); }
    if (g.ca === 1) { x.push('<i>crítico alto</i>'); }
    if (g.ca === 2) { x.push('<i>sempre crítico</i>'); }
    return x.join('');
  }
  function geCandidatos() {
    var p = P[S.ge.id], b = K.normalizar(S.ge.busca);
    return aprende(p).filter(function (g) {
      return (!b || K.normalizar(g.nome).indexOf(b) >= 0) && (!S.ge.tipo || g.t === S.ge.tipo) && (!S.ge.cat || g.c === S.ge.cat);
    }).sort(function (a, c) { return forca(p, c) - forca(p, a); });
  }
  function geListaHtml() {
    var p = P[S.ge.id], cheio = S.ge.ids.length >= 4, lista = geCandidatos();
    if (!lista.length) { return `<div class='cd-mais'>Nenhum golpe com esses filtros</div>`; }
    return lista.map(function (g) {
      var on = S.ge.ids.indexOf(g.id) >= 0;
      return `<div class='ge-g${on ? ' on' : ''}${cheio && !on ? ' cheio' : ''}' data-acao='geToggle' data-g='${g.id}' style='--c:${corTipo(g.t)}'>
        ${icone(g.t, 22)}<b>${esc(g.nome)}</b><span class='ge-cat'>${g.c === 'F' ? 'Físico' : 'Especial'}</span>
        <span class='ge-num'>${g.pw}</span><span class='ge-num'>${g.ac ? g.ac + '%' : '—'}</span><em>${extrasHtml(p, g)}</em></div>`;
    }).join('');
  }
  function editorHtml() {
    var p = P[S.ge.id], todos = aprende(p), tipos = [];
    todos.forEach(function (g) { if (tipos.indexOf(g.t) < 0) { tipos.push(g.t); } });
    tipos.sort(function (a, b) { return K.TIPOS.indexOf(a) - K.TIPOS.indexOf(b); });
    var slots = [0, 1, 2, 3].map(function (i) {
      var g = GR[S.ge.ids[i]];
      return g ? `<div class='ge-sl' data-acao='geToggle' data-g='${g.id}' style='--c:${corTipo(g.t)}'>${icone(g.t, 20)}<b>${esc(g.nome)}</b><span>${g.c === 'F' ? 'Físico' : 'Especial'} · ${g.pw}</span><i>×</i></div>`
        : `<div class='ge-sl vazio'><span>Golpe ${i + 1}</span></div>`;
    }).join('');
    var chips = `<span class='gc${S.ge.tipo ? '' : ' on'}' data-acao='geTipo' data-t=''>Todos</span>` + tipos.map(function (t) {
      return `<span class='tc${S.ge.tipo === t ? ' on' : ''}' data-acao='geTipo' data-t='${t}' title='${nomeTipo(t)}' style='--c:${corTipo(t)}'>${icone(t, 20)}</span>`;
    }).join('');
    var cats = [['', 'Todos'], ['F', 'Físicos'], ['E', 'Especiais']].map(function (c) {
      return `<span class='gc${S.ge.cat === c[0] ? ' on' : ''}' data-acao='geCat' data-c='${c[0]}'>${c[1]}</span>`;
    }).join('');
    return `<div class='ge'><div class='ge-box' style='--c:${corTipo(p.t[0])}'>
      <div class='ge-topo'><div class='ge-arte'>${K.img([K.URL.home(p.id), K.URL.sprite(p.id)])}</div>
        <div class='ge-tit'><b>${esc(p.nome)}</b><div class='sl-tipos'>${p.t.map(K.chip).join('')}</div>
        <span>Ataque ${p.b.atk} · Atq. Esp. ${p.b.spa} · ${todos.length} golpes de dano que aprende</span></div>
        <div class='bt bt-sec ge-x' data-acao='geFechar'>✕</div></div>
      <div class='ge-sls'>${slots}</div>
      <div class='ge-filtros'><input id='ar-ge-busca' class='busca' placeholder='🔍  Procurar golpe...' value='${esc(S.ge.busca)}'/><div class='gens'>${cats}</div></div>
      <div class='tcs ge-tipos'>${chips}</div>
      <div class='ge-cab'><span></span><b>Golpe</b><span>Categoria</span><span class='ge-num'>Poder</span><span class='ge-num'>Precisão</span><em></em></div>
      <div class='ge-lista' id='ar-ge-lista'>${geListaHtml()}</div>
      <div class='ge-rodape'><span class='pv-dica'>Toca num golpe para o pôr ou tirar · ${S.ge.ids.length}/4</span>
        <div class='bt bt-sec' data-acao='geAuto'>🎲 Escolha automática</div>
        <div class='bt bt-go${S.ge.ids.length ? '' : ' off'}' data-acao='geOk'>✓ Concluir</div></div>
    </div></div>`;
  }
  function geAtualizar() {
    var l = $('ar-ge-lista'), topo = l ? l.scrollTop : 0;
    render();
    var n = $('ar-ge-lista'); if (n) { n.scrollTop = topo; }
  }

  /* ================= BATALHA ================= */
  function hpClasse(m) { var p = m.hp / m.hpMax; return p > 0.5 ? 'ok' : p > 0.2 ? 'med' : 'baixo'; }
  function barraTopo(lado) {
    var l = S.B[lado], m = ativo(l), pct = 100 * m.hp / m.hpMax;
    var bolas = S.modo === 3 ? `<span class='bolas'>${l.time.map(function (x, i) { return `<i class='${x.hp <= 0 ? 'ko' : i === l.ativo ? 'at' : ''}'></i>`; }).join('')}</span>` : '';
    return `<div class='hud hud-${lado}'>
      <div class='hud-foto' style='--c:${corTipo(m.p.t[0])}'>${K.img([K.URL.home(m.p.id), K.URL.sprite(m.p.id)])}</div>
      <div class='hud-corpo'>
        <div class='hud-nome'><b>${esc(m.p.nome)}</b>${m.p.t.map(function (t) { return icone(t, 16); }).join('')}<span>Nv. ${m.nv}</span>${m.gmax > 0 ? `<em class='gmax-t'>G-MAX ${m.gmax}</em>` : ''}${bolas}</div>
        <div class='hud-est'>${estHtml(m)}</div>
        <div class='hp'><div class='hp-fant' id='hpg-${lado}' style='width:${pct}%'></div><div class='hp-f ${hpClasse(m)}' id='hpf-${lado}' style='width:${pct}%'></div></div>
        <div class='hp-tx' id='hpt-${lado}'>${m.hp} / ${m.hpMax} HP</div>
      </div></div>`;
  }
  function estHtml(m) {
    var out = Object.keys(m.est || {}).filter(function (k) { return m.est[k]; }).map(function (k) {
      var v = m.est[k]; return `<i class='${v > 0 ? 'sobe' : 'desce'}'>${CURTO_ATR[k]} ${v > 0 ? '+' : ''}${v}</i>`;
    });
    if (PREGUICA[m.p.esp]) { out.push(`<i class='hab'>${m.descansa ? '😴 vai preguiçar' : '😴 Truant'}</i>`); }
    if (LENTO[m.p.esp]) { out.push(`<i class='hab'>${lentoAtivo(m) ? '🐢 Início lento ' + m.lento + '/5' : '🐢 em força'}</i>`); }
    if (m.preso) { out.push(`<i class='hab'>🔒 ${esc(m.golpes[m.preso.idx].nome)}</i>`); }
    if (m.item && !m.base) { out.push(`<i class='hab'>${m.item === 'mega' ? '💎 Pedra Mega' : '🔴 Fator Gmax'}</i>`); }
    return out.join('');
  }
  function cartaLado(lado) {
    var l = S.B[lado], m = ativo(l), p = m.p, max = 160;
    var stats = [['Vida', p.b.hp], ['Ataque', p.b.atk], ['Defesa', p.b.def], ['Atq. Esp.', p.b.spa], ['Def. Esp.', p.b.spd], ['Veloc.', p.b.spe]].map(function (s) {
      return `<div class='st'><span>${s[0]}</span><div><i style='width:${Math.min(100, 100 * s[1] / max)}%;background:${corTipo(p.t[0])}'></i></div><b>${s[1]}</b></div>`;
    }).join('');
    var time = '';
    if (S.modo === 3) {
      time = `<div class='tm-tit'>${lado === 'j' ? 'SEU TIME · clique para trocar' : 'TIME DO OPONENTE'}</div>` + l.time.map(function (x, i) {
        var pode = lado === 'j' && x.hp > 0 && i !== l.ativo && !S.ocupado && !S.fim && !S.auto && !jaEscolhi();
        return `<div class='tm${i === l.ativo ? ' at' : ''}${x.hp <= 0 ? ' ko' : ''}${pode ? ' pode' : ''}' ${pode ? `data-acao='trocar' data-i='${i}'` : ''}>
          <img src='${K.URL.sprite(x.p.id)}'/><div><b>${esc(x.p.nome)}</b><div class='hp mini'><div class='hp-f ${hpClasse(x)}' style='width:${100 * x.hp / x.hpMax}%'></div></div></div></div>`;
      }).join('');
    }
    return `<div class='carta carta-${lado}' style='--c:${corTipo(p.t[0])}'>
      <div class='carta-rot'>${lado === 'j' ? 'VOCÊ' : 'OPONENTE'}</div>
      <div class='carta-arte'><div class='holo'></div>${K.img([K.URL.arte(p.id), K.URL.home(p.id)])}</div>
      <div class='carta-nome'>${esc(p.nome)}</div><div class='carta-tipos'>${p.t.map(K.chip).join('')}</div>
      <div class='sts'>${stats}</div>${time}</div>`;
  }
  function jaEscolhi() { return emOnline() && !!S.on.p.minhas[S.on.p.turno]; }
  /* online: com a Mega/Gigantamax marcada, os golpes mostrados já são os da forma nova */
  function golpesVisiveis() {
    var eu = ativo(S.B.j), op = emOnline() && S.on.p.forma != null ? opcoesTransformar(S.B.j)[S.on.p.forma] : null;
    if (!op) { return eu.golpes; }
    var copia = Object.assign({}, eu); aplicarForma(copia, op); return copia.golpes;
  }
  function golpesHtml() {
    var foe = ativo(S.B.o), eu = ativo(S.B.j), trava = S.ocupado || S.auto || !!S.fim || !!S.escolha || jaEscolhi();
    if (!eu.pp.some(function (x) { return x > 0; })) {
      return `<div class='gp${trava ? ' off' : ''}' data-acao='golpe' data-i='0' style='--c:#A8A878'><div class='gp-ico'>${icone('normal', 30)}</div>
        <div class='gp-tx'><b>Struggle</b><span>Sem PP em nenhum golpe · Poder 50 · recuo de ¼ do HP</span></div><em class='ef ef-nor'>último recurso</em></div>`;
    }
    return golpesVisiveis().map(function (g, i) {
      var semPP = !(eu.pp[i] > 0), bloqueado = eu.preso && eu.preso.idx !== i;
      var e = efTotal(g.t, foe.p);
      var tag = e === 0 ? ['nul', 'sem efeito'] : e >= 2 ? ['sup', 'super efetivo ×' + e] : e < 1 ? ['pou', 'pouco efetivo ×' + K.fmtEf(e)] : ['nor', 'normal'];
      return `<div class='gp${trava || semPP || bloqueado ? ' off' : ''}${eu.preso && !bloqueado ? ' preso' : ''}' data-acao='golpe' data-i='${i}' style='--c:${corTipo(g.t)}'>
        <div class='gp-ico'>${icone(g.t, 30)}</div><small class='gp-pp${eu.pp[i] <= 2 ? ' pouco' : ''}'>PP ${eu.pp[i]}/${g.pp || 10}</small>
        <div class='gp-tx'><b>${eu.preso && !bloqueado ? '🔒 ' : ''}${esc(g.nome)}</b><span>${g.c === 'F' ? 'Físico' : 'Especial'} · Poder ${g.esp === 'hp' ? poderDe(eu, g) + ' (cai com o HP)' : g.pw}${g.hmax > 1 ? ' ×' + (g.hmin === g.hmax ? g.hmin : g.hmin + '–' + g.hmax) : ''} · ${g.ac ? g.ac + '%' : 'nunca erra'}${g.pr > 0 ? ' · ⚡ prioridade' : ''}${g.dr > 0 ? ' · drena' : g.dr < 0 ? ' · recuo' : ''}${efeitoTexto(g)}${g.esp === 'furia' ? ' · prende 2-3 turnos' : ''}</span></div>
        <em class='ef ef-${tag[0]}'>${tag[1]}</em></div>`;
    }).join('');
  }
  function efeitoTexto(g) {
    if (!g.ef) { return ''; }
    var partes = g.ef[2].map(function (x) { return CURTO_ATR[x[0]] + ' ' + (x[1] > 0 ? '+' : '') + x[1]; }).join(' ');
    return ' · ' + (g.ef[0] === 'u' ? 'em si: ' : 'no alvo: ') + partes + (g.ef[1] < 100 ? ' (' + g.ef[1] + '%)' : '');
  }
  function logHtml() { return S.log.slice(-60).map(function (x) { return `<div>${x}</div>`; }).join(''); }
  function simHtml() {
    if (!S.sim) { return ''; }
    return `<div class='pv-barra'><div class='pv-j' style='width:${S.sim.j}%'>Você ${S.sim.j.toFixed(1)}%</div><div class='pv-o'>${S.sim.o.toFixed(1)}%</div></div>
      <div class='sim-tx'>1.000 batalhas simuladas · média de ${S.sim.turnos.toFixed(1)} turnos</div>`;
  }
  function overlayHtml() {
    var B = S.B;
    if (emOnline() && caiu() && !S.fim) {
      return `<div class='ov'><div class='ov-box'><div class='ov-tit'>${esc(NET.erro || 'A ligação caiu.')}</div>
        <div class='fim-sub'>A batalha online foi interrompida.</div>
        <div class='fim-bts'><div class='bt bt-go' data-acao='novo'>Voltar à sala</div></div></div></div>`;
    }
    if (S.escolha === 'forcada') {
      var cards = B.j.time.map(function (m, i) {
        var pode = m.hp > 0 && i !== B.j.ativo;
        return `<div class='tc-card${pode ? '' : ' off'}' ${pode ? `data-acao='trocar' data-i='${i}'` : ''} style='--c:${corTipo(m.p.t[0])}'>
          ${K.img([K.URL.home(m.p.id), K.URL.sprite(m.p.id)])}<b>${esc(m.p.nome)}</b>
          <div class='hp mini'><div class='hp-f ${hpClasse(m)}' style='width:${100 * m.hp / m.hpMax}%'></div></div><span>${m.hp} / ${m.hpMax}</span></div>`;
      }).join('');
      return `<div class='ov'><div class='ov-box'><div class='ov-tit'>${esc(ativo(B.j).p.nome)} desmaiou! Escolha o próximo</div><div class='tc-cards'>${cards}</div></div></div>`;
    }
    if (S.fim) {
      var win = S.fim === 'j', conf = '';
      if (win) { for (var i = 0; i < 60; i++) { conf += `<i style='left:${(i * 37) % 100}%;background:${corTipo(K.TIPOS[i % 18])};animation-delay:${((i * 13) % 20) / 10}s;animation-duration:${2 + ((i * 7) % 15) / 10}s'></i>`; } }
      return `<div class='ov'><div class='confete'>${conf}</div><div class='ov-box fim ${win ? 'win' : 'lose'}'>
        <div class='fim-tit'>${win ? 'VITÓRIA!' : 'DERROTA'}</div>
        <div class='fim-sub'>${win ? 'Seu time venceu a batalha!' : 'O oponente venceu desta vez.'}${emOnline() && caiu() ? '<br>' + esc(NET.erro || 'A ligação caiu.') : ''}</div>
        <div class='fim-bts'>${botaoRevanche()}<div class='bt bt-sec' data-acao='novo'>Novos times</div></div>
      </div></div>`;
    }
    return '';
  }
  function telaBatalha() {
    var B = S.B, eu = ativo(B.j), foe = ativo(B.o), tj = eu.p.t[0], to = foe.p.t[0];
    return `<div class='pk-palco bat' id='ar-palco'>
      <div class='campo campo-o' style='--c:${corTipo(to)}'>${K.particulas(to, 18, 3)}</div>
      <div class='campo campo-j' style='--c:${corTipo(tj)}'>${K.particulas(tj, 18, 11)}</div>
      <div class='campo-luz'></div><div class='diag'></div>
      <div class='vs'><span>VS</span></div>
      <div class='plat plat-o' style='--c:${corTipo(to)}'></div><div class='plat plat-j' style='--c:${corTipo(tj)}'></div>
      <div class='mon mon-o${foe.gmax > 0 ? ' gmax' : ''}' id='mon-o'>${K.img([K.URL.gif(foe.p.id), K.URL.home(foe.p.id)], 'spr')}</div>
      <div class='mon mon-j${eu.gmax > 0 ? ' gmax' : ''}' id='mon-j'>${K.img([K.URL.costas(eu.p.id), K.URL.gif(eu.p.id), K.URL.home(eu.p.id)], 'spr')}</div>
      ${barraTopo('j')}${barraTopo('o')}
      ${cartaLado('j')}${cartaLado('o')}
      <div class='msg' id='ar-msg'><span>${S.msg || 'O que <b>' + esc(eu.p.nome) + '</b> vai fazer?'}</span></div>
      <div id='ar-fx' class='efx'></div>
      <div class='painel'>
        <div class='gps' id='ar-golpes'>${golpesHtml()}</div>
        <div class='acoes'>
          ${opcoesTransformar(B.j).map(function (op, i) {
            var marcada = emOnline() && S.on.p.forma === i;
            return `<div class='bt bt-mega ${op.tipo}${marcada ? ' marcada' : ''}${S.ocupado || S.auto || S.fim || S.escolha || jaEscolhi() ? ' off' : ''}' data-acao='transformar' data-i='${i}'>${marcada ? '✓ ' : ''}${rotuloForma(op)}</div>`;
          }).join('')}
          ${emOnline() ? `<div class='on-tag'>🌐 Online · ${S.on.host ? 'tu criaste a sala' : 'sala ' + esc(NET.codigo || '')}</div><div id='ar-aus'>${ausenteHtml()}</div>` :
            `<div class='bt bt-sec${S.auto ? ' on' : ''}' data-acao='auto'>${S.auto ? '⏸ Automático' : '▶ Automático'}</div>
          <div class='bt bt-gold' data-acao='simular'>🎲 Simular ×1000</div>`}
          <div class='bt bt-sec' data-acao='novo'>Sair</div>
          <div class='sim' id='ar-sim'>${simHtml()}</div>
        </div>
        <div class='logbox'><div class='log-tit'>REGISTRO</div><div class='log' id='ar-log'>${logHtml()}</div></div>
      </div>
      ${overlayHtml()}
    </div>`;
  }

  /* ================= RENDER ================= */
  var fotoEstavel = null;
  function render() {
    // guarda a batalha local só em momentos estáveis (fora das animações de um turno)
    if (S.tela === 'batalha' && S.B && !S.B.online && !S.ocupado) { fotoEstavel = { B: fotoBatalha(S.B), log: S.log.slice(-60), msg: S.msg, escolha: S.escolha, fim: S.fim }; }
    raiz.innerHTML = S.tela === 'batalha' && S.B ? telaBatalha() : telaSelecao();
    K.escala(raiz);
    var log = $('ar-log'); if (log) { log.scrollTop = log.scrollHeight; }
    var busca = $('ar-busca');
    if (busca) { busca.addEventListener('input', function () { S.busca = busca.value; $('ar-grade').innerHTML = gradeHtml(); }); }
    var gb = $('ar-ge-busca');
    if (gb) { gb.addEventListener('input', function () { S.ge.busca = gb.value; $('ar-ge-lista').innerHTML = geListaHtml(); }); }
    var cod = $('ar-codigo');
    if (cod) {
      cod.addEventListener('input', function () { cod.value = cod.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); S.on.codigo = cod.value; });
      cod.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { S.on.aviso = ''; NET.entrar(S.on.codigo); } });
    }
  }
  function registrar(txt) { S.log.push(txt); var log = $('ar-log'); if (log) { log.innerHTML = logHtml(); log.scrollTop = log.scrollHeight; } }
  function mensagem(txt) { S.msg = txt; var m = $('ar-msg'); if (m) { m.innerHTML = '<span>' + txt + '</span>'; m.classList.remove('nova'); void m.offsetWidth; m.classList.add('nova'); } }

  /* ================= EFEITOS POR TIPO ================= */
  var FX = {
    fire: ['chama', 'explosao'], water: ['bolha', 'respingo'], grass: ['folha', 'folhas'], electric: [null, 'raio'],
    ice: ['cristal', 'gelo'], fighting: [null, 'soco'], poison: ['bolha', 'nuvem'], ground: [null, 'tremor'],
    flying: [null, 'vento'], psychic: ['orbe', 'aneis'], bug: [null, 'corte'], rock: [null, 'pedras'],
    ghost: ['sombra', 'sombra'], dragon: ['feixe', 'explosao'], dark: [null, 'corte'], steel: [null, 'corte'],
    fairy: ['estrela', 'brilho'], normal: [null, 'estrela']
  };
  function centro(lado) { return lado === 'j' ? { x: 470, y: 400 } : { x: 830, y: 250 }; }
  function particula(cls, x, y, cor, dx, dy, dur, extra) {
    var fx = $('ar-fx'); if (!fx) { return; }
    var el = document.createElement('i');
    el.className = 'pt ' + cls; el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--c', cor); el.style.setProperty('--dx', dx + 'px'); el.style.setProperty('--dy', dy + 'px');
    el.style.animationDuration = dur + 'ms';
    if (extra) { extra(el); }
    fx.appendChild(el); setTimeout(function () { el.remove(); }, dur + 60);
  }
  function balancar(forte) {
    var pc = $('ar-palco'); if (!pc) { return; }
    pc.classList.remove('treme', 'treme-forte'); void pc.offsetWidth; pc.classList.add(forte ? 'treme-forte' : 'treme');
  }
  async function projetil(de, para, tipo) {
    var forma = FX[tipo][0], a = centro(de), b = centro(para), cor = corTipo(tipo);
    if (forma === 'feixe') {
      var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, dist = Math.hypot(b.x - a.x, b.y - a.y);
      particula('feixe', a.x, a.y, cor, 0, 0, 650, function (el) { el.style.width = dist + 'px'; el.style.transform = 'rotate(' + ang + 'deg)'; });
      await esperar(380); return;
    }
    for (var i = 0; i < 14; i++) {
      (function (i) {
        setTimeout(function () {
          particula('p-' + forma, a.x + (Math.random() * 30 - 15), a.y + (Math.random() * 30 - 15), cor,
            b.x - a.x + (Math.random() * 50 - 25), b.y - a.y + (Math.random() * 50 - 25), 520);
        }, i * 28);
      })(i);
    }
    await esperar(560);
  }
  function impacto(lado, tipo, forte) {
    var forma = FX[tipo][1], c = centro(lado), cor = corTipo(tipo), i;
    particula('anel', c.x, c.y, cor, 0, 0, 550);
    if (forma === 'raio') {
      for (i = 0; i < 3; i++) { (function (i) { setTimeout(function () { particula('raio', c.x + (i - 1) * 34, c.y - 230, cor, 0, 0, 420); }, i * 90); })(i); }
      particula('flash', 640, 360, '#FFF6A0', 0, 0, 380);
    } else if (forma === 'tremor') {
      balancar(true);
      for (i = 0; i < 14; i++) { particula('poeira', c.x + (Math.random() * 160 - 80), c.y + 50, cor, Math.random() * 80 - 40, -40 - Math.random() * 60, 800); }
    } else if (forma === 'pedras') {
      for (i = 0; i < 7; i++) { (function (i) { setTimeout(function () { particula('pedra', c.x + (Math.random() * 120 - 60), c.y - 260, cor, 0, 250, 520); }, i * 70); })(i); }
    } else if (forma === 'corte') {
      for (i = 0; i < 3; i++) { (function (i) { setTimeout(function () { particula('corte', c.x, c.y + (i - 1) * 26, cor, 0, 0, 380, function (el) { el.style.transform = 'translate(-50%,-50%) rotate(' + (-35 + i * 25) + 'deg)'; }); }, i * 80); })(i); }
    } else if (forma === 'aneis') {
      for (i = 0; i < 4; i++) { (function (i) { setTimeout(function () { particula('anel grande', c.x, c.y, cor, 0, 0, 700); }, i * 110); })(i); }
    } else if (forma === 'vento') {
      for (i = 0; i < 6; i++) { particula('vento', c.x - 120, c.y + (Math.random() * 120 - 60), cor, 240, Math.random() * 30 - 15, 520 + i * 40); }
    } else if (forma === 'soco' || forma === 'estrela') {
      particula('estrelao', c.x, c.y, cor, 0, 0, 500);
    } else {
      var shape = { explosao: 'p-chama', respingo: 'p-gota', folhas: 'p-folha', gelo: 'p-cristal', nuvem: 'p-nuvem', sombra: 'p-sombra', brilho: 'p-estrela' }[forma] || 'p-chama';
      for (i = 0; i < 18; i++) {
        var ang = Math.random() * Math.PI * 2, d = 50 + Math.random() * 80;
        particula(shape, c.x, c.y, cor, Math.cos(ang) * d, Math.sin(ang) * d, 650);
      }
    }
    if (forte) { balancar(false); }
  }
  async function animarAtaque(lado, foe, g) {
    var mon = $('mon-' + lado);
    if (g.c === 'F' || !FX[g.t][0]) {
      if (mon) { mon.classList.add('investe-' + lado); }
      await esperar(230);
      if (mon) { mon.classList.remove('investe-' + lado); }
    } else {
      if (mon) { mon.classList.add('carrega'); }
      await projetil(lado, foe, g.t);
      if (mon) { mon.classList.remove('carrega'); }
    }
  }
  function textoFx(txt, cls, lado) {
    var fx = $('ar-fx'); if (!fx) { return; }
    var c = centro(lado), el = document.createElement('div');
    el.className = 'tx ' + cls; el.textContent = txt; el.style.left = c.x + 'px'; el.style.top = (c.y - 60) + 'px';
    fx.appendChild(el); setTimeout(function () { el.remove(); }, 1500);
  }
  function bannerFx(txt, cls) {
    var fx = $('ar-fx'); if (!fx) { return; }
    var el = document.createElement('div'); el.className = 'banner ' + cls; el.textContent = txt;
    fx.appendChild(el); setTimeout(function () { el.remove(); }, 1500);
  }
  async function animarHp(lado, m) {
    var f = $('hpf-' + lado), g = $('hpg-' + lado), t = $('hpt-' + lado), pct = 100 * m.hp / m.hpMax;
    if (f) { f.style.width = pct + '%'; f.className = 'hp-f ' + hpClasse(m); }
    if (t) { t.textContent = m.hp + ' / ' + m.hpMax + ' HP'; }
    await esperar(450);
    if (g) { g.style.width = pct + '%'; }
    await esperar(250);
  }

  /* ================= TURNO ================= */
  async function usarGolpe(lado, idx) {
    var B = S.B, foe = lado === 'j' ? 'o' : 'j', a = ativo(B[lado]), d = ativo(B[foe]);
    var quem = lado === 'j' ? esc(a.p.nome) : esc(a.p.nome) + ' inimigo';
    var uso = golpeEfetivo(a, idx);
    if (uso.descansa) {
      mensagem(`<b>${quem}</b> está a preguiçar...`); registrar(`<b>${esc(a.p.nome)}</b> está a preguiçar (Truant).`);
      await esperar(900); return false;
    }
    var g = uso.g;
    if (g.luta) { registrar(`<b>${esc(a.p.nome)}</b> já não tem PP!`); }
    mensagem(`<b>${quem}</b> usou <span style='color:${corTipo(g.t)}'>${esc(g.nome)}</span>!`);
    registrar(`<b>${esc(a.p.nome)}</b> usou <span style='color:${corTipo(g.t)}'>${esc(g.nome)}</span>`);
    await esperar(350);
    await animarAtaque(lado, foe, g);
    var r = calcular(a, d, g);
    if (r.erro || r.ef === 0) {
      efeitosDepois(a, d, g, r, 0, uso.idx);
      if (r.erro) { textoFx('ERROU!', 'erro', foe); mensagem('Mas errou!'); registrar('Errou!'); await esperar(650); }
      else { bannerFx('NÃO AFETA', 'nul'); mensagem(`Não afeta ${esc(d.p.nome)}...`); registrar('Não afetou.'); await esperar(800); }
      return false;
    }
    impacto(foe, g.t, r.ef >= 2 || r.crit);
    var hpAntes = d.hp;
    d.hp = Math.max(0, d.hp - r.dano);
    var mon = $('mon-' + foe); if (mon) { mon.classList.remove('dano'); void mon.offsetWidth; mon.classList.add('dano'); }
    textoFx('-' + r.dano, 'num' + (r.ef >= 2 ? ' sup' : ''), foe);
    if (r.crit) { setTimeout(function () { textoFx('CRÍTICO!', 'crit', foe); }, 150); registrar(`<i class='crit'>Golpe crítico!</i>`); }
    if (r.ef >= 2) { bannerFx('SUPER EFETIVO!', 'sup'); registrar(`<i class='sup'>Foi super efetivo! (×${r.ef})</i>`); }
    else if (r.ef < 1) { bannerFx('pouco efetivo...', 'pou'); registrar(`<i class='pou'>Não foi muito efetivo...</i>`); }
    await animarHp(foe, d);
    if (r.acertos > 1) { registrar(`Acertou ${r.acertos} vezes!`); }
    var ev = efeitosDepois(a, d, g, r, hpAntes - d.hp, uso.idx);
    if (ev.dreno > 0) { textoFx('+' + ev.dreno, 'num cura', lado); registrar(`<b>${esc(a.p.nome)}</b> recuperou ${ev.dreno} HP.`); await animarHp(lado, a); }
    else if (ev.dreno < 0) { textoFx(String(ev.dreno), 'num', lado); registrar(`<b>${esc(a.p.nome)}</b> sofreu ${-ev.dreno} de recuo.`); await animarHp(lado, a); }
    if (ev.est.length) { await mostrarEstagios(ev.est, lado, foe, a, d); }
    if (ev.cansou) { registrar(`<b>${esc(a.p.nome)}</b> acalmou-se.`); }
    if (d.hp <= 0) {
      if (mon) { mon.classList.add('desmaio'); }
      mensagem(`<b>${esc(d.p.nome)}</b> desmaiou!`); registrar(`<b>${esc(d.p.nome)}</b> desmaiou!`);
      await esperar(1000);
      var antes = evoluir(a);
      if (antes) { await animarEvolucao(lado, antes, a); }
      return true;
    }
    return false;
  }
  async function mostrarEstagios(lista, lado, foe, a, d) {
    var txt = lista.map(function (x) {
      var nome = esc((x.quem === 'a' ? a : d).p.nome), atr = NOME_ATR[x.k];
      if (!x.d) { return `${atr} de <b>${nome}</b> não pode ${x.pedido > 0 ? 'subir' : 'baixar'} mais.`; }
      var grau = Math.abs(x.d) >= 2 ? ' muito' : '';
      return `${atr} de <b>${nome}</b>${x.d > 0 ? ' subiu' : ' baixou'}${grau}!`;
    });
    txt.forEach(function (t) { registrar(t); });
    lista.forEach(function (x) { if (x.d) { textoFx(CURTO_ATR[x.k] + (x.d > 0 ? ' ↑' : ' ↓'), x.d > 0 ? 'num cura' : 'num', x.quem === 'a' ? lado : foe); } });
    mensagem(txt[0]);
    var h = $('ar-palco'); if (h) { var est = h.querySelectorAll('.hud-est'); if (est.length) { est[0].innerHTML = estHtml(ativo(S.B.j)); if (est[1]) { est[1].innerHTML = estHtml(ativo(S.B.o)); } } }
    await esperar(700);
  }
  async function animarEvolucao(lado, antes, m) {
    var c = centro(lado), nome = esc(antes.nome), depois = esc(m.p.nome);
    mensagem(`O quê? <b>${nome}</b> está a evoluir!`);
    var mon = $('mon-' + lado); if (mon) { mon.classList.add('mega-anim'); }
    particula('arco', c.x, c.y, '#fff', 0, 0, 1300);
    await esperar(1300);
    particula('flash', 640, 360, '#FFFFFF', 0, 0, 420);
    registrar(`<i class='crit'>${nome} evoluiu para ${depois}! (Nv. ${m.nv})</i>`);
    S.msg = `<b>${nome}</b> evoluiu para <b>${depois}</b>!`;
    render();
    bannerFx('EVOLUÇÃO!', 'mega');
    var mon2 = $('mon-' + lado); if (mon2) { mon2.classList.add('entra'); }
    await esperar(1100);
  }
  async function transformar(lado, op) {
    var l = S.B[lado], m = ativo(l), antes = esc(m.p.nome), c = centro(lado);
    l.transformou = true;
    mensagem(op.tipo === 'mega' ? `<b>${antes}</b> está reagindo à Pedra Chave... está Mega Evoluindo!` : `<b>${antes}</b> está ficando gigante!`);
    var mon = $('mon-' + lado); if (mon) { mon.classList.add(op.tipo === 'mega' ? 'mega-anim' : 'gmax-anim'); }
    particula(op.tipo === 'mega' ? 'arco' : 'arco gx', c.x, c.y, '#fff', 0, 0, 1500);
    await esperar(1500);
    particula('flash', 640, 360, op.tipo === 'mega' ? '#FFFFFF' : '#FF2E63', 0, 0, 420);
    aplicarForma(m, op);
    var depois = esc(m.p.nome);
    registrar(op.tipo === 'mega' ? `<i class='crit'>${antes} Mega Evoluiu em ${depois}!</i>` : `<i class='crit'>${antes} usou o Gigantamax! (3 turnos)</i>`);
    S.msg = op.tipo === 'mega' ? `<b>${antes}</b> Mega Evoluiu em <b>${depois}</b>!` : `<b>${antes}</b> ficou gigante!`;
    render();
    bannerFx(op.tipo === 'mega' ? 'MEGA EVOLUÇÃO!' : 'GIGANTAMAX!', op.tipo === 'mega' ? 'mega' : 'gmax');
    var mon2 = $('mon-' + lado); if (mon2) { mon2.classList.add('entra'); }
    await esperar(1100);
  }
  async function reverterGmax(lado) {
    var m = ativo(S.B[lado]), nome = esc(m.base.nome);
    var mon = $('mon-' + lado); if (mon) { mon.classList.add('sai'); }
    await esperar(400);
    desfazerGmax(m);
    S.msg = `<b>${nome}</b> voltou ao tamanho normal.`; registrar(S.msg); render();
    var mon2 = $('mon-' + lado); if (mon2) { mon2.classList.add('entra'); }
    await esperar(700);
  }
  async function entrar(lado, idx) {
    var B = S.B, velho = ativo(B[lado]);
    if (velho.gmax > 0) { desfazerGmax(velho); }
    sairDeCampo(velho);
    B[lado].ativo = idx;
    var nome = esc(ativo(B[lado]).p.nome);
    S.msg = lado === 'j' ? `Vai, <b>${nome}</b>!` : `O oponente enviou <b>${nome}</b>!`;
    registrar(S.msg);
    render();
    var mon = $('mon-' + lado); if (mon) { mon.classList.add('entra'); }
    await esperar(700);
  }
  async function aposDesmaio(ladoKO) {
    var B = S.B;
    if (!vivos(B.j).length || !vivos(B.o).length) {
      S.fim = vivos(B.j).length ? 'j' : 'o';
      registrar(S.fim === 'j' ? '<b>Você venceu!</b>' : '<b>O oponente venceu.</b>');
      S.ocupado = false; S.auto = false; render(); return true;
    }
    if (ladoKO === 'o') { await entrar('o', iaMelhorReserva(B.o, ativo(B.j))); }
    else if (S.auto) { await entrar('j', iaMelhorReserva(B.j, ativo(B.o))); }
    else { S.escolha = 'forcada'; S.ocupado = false; render(); return true; }
    return false;
  }
  async function executarTurno(acaoJ) {
    if (S.ocupado || !S.B || S.fim) { return; }
    if (emOnline()) { escolherOnline(acaoJ); return; }
    S.ocupado = true; S.escolha = null; render();
    var B = S.B;
    if (S.auto && opcoesTransformar(B.j).length) { await transformar('j', opcoesTransformar(B.j)[0]); }
    if (opcoesTransformar(B.o).length) { await transformar('o', opcoesTransformar(B.o)[0]); }
    var acoes = ordem(B, acaoJ, iaAcao(B.o, B.j));
    for (var k = 0; k < acoes.length; k++) {
      var lado = acoes[k].lado, ac = acoes[k].a;
      if (ac.tipo === 'troca') {
        mensagem(lado === 'j' ? `<b>${esc(ativo(B.j).p.nome)}</b>, volte!` : `O oponente recolheu <b>${esc(ativo(B.o).p.nome)}</b>.`);
        var sai = $('mon-' + lado); if (sai) { sai.classList.add('sai'); }
        await esperar(450);
        await entrar(lado, ac.idx); continue;
      }
      if (ativo(B[lado]).hp <= 0) { continue; }
      var ko = await usarGolpe(lado, ac.idx);
      if (ko) { if (await aposDesmaio(lado === 'j' ? 'o' : 'j')) { return; } break; }
    }
    for (var lg of ['j', 'o']) {
      var mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      fimTurnoLado(B[lg]);
    }
    S.ocupado = false; S.msg = 'O que <b>' + esc(ativo(B.j).p.nome) + '</b> vai fazer?'; render();
    if (S.auto) { proximoAuto(); }
  }
  function proximoAuto() {
    setTimeout(function () {
      if (!S.auto || S.ocupado || S.fim || S.tela !== 'batalha') { return; }
      executarTurno(iaAcao(S.B.j, S.B.o));
    }, 700);
  }
  async function iniciarBatalha(online) {
    if (!online && !Object.keys(itensDoTime('o')).length) { S.itens.o = itensAuto(S.time.o); }
    S.B = { j: novoLado(S.time.j, S.mv.j, itensDoTime('j')), o: novoLado(S.time.o, S.mv.o, itensDoTime('o')) };
    if (online) { S.B.online = true; S.B.host = online.host; }
    S.log = ['A batalha começou!']; S.fim = null; S.escolha = null; S.sim = null; S.ocupado = true;
    S.msg = 'A batalha vai começar!'; S.tela = 'batalha'; render();
    var a = ativo(S.B.j).p, b = ativo(S.B.o).p, fx = $('ar-fx');
    if (fx) {
      var intro = document.createElement('div'); intro.className = 'intro';
      intro.innerHTML = `<div class='intro-j' style='--c:${corTipo(a.t[0])}'>${K.img([K.URL.arte(a.id), K.URL.home(a.id)])}<b>${esc(a.nome)}</b></div>
        <div class='intro-o' style='--c:${corTipo(b.t[0])}'>${K.img([K.URL.arte(b.id), K.URL.home(b.id)])}<b>${esc(b.nome)}</b></div><div class='intro-vs'>VS</div>`;
      fx.appendChild(intro);
      await esperar(1900);
      intro.remove();
    }
    var mj = $('mon-j'), mo = $('mon-o');
    if (mj) { mj.classList.add('entra'); } if (mo) { mo.classList.add('entra'); }
    S.ocupado = false; S.msg = 'O que <b>' + esc(a.nome) + '</b> vai fazer?'; render();
    if (online) { await resolverOnline(); }
  }

  /* ================= ONLINE: TURNOS ================= */
  function ladosCanonicos() { return S.B.host ? ['j', 'o'] : ['o', 'j']; }
  function msgVez() { return 'O que <b>' + esc(ativo(S.B.j).p.nome) + '</b> vai fazer?'; }
  function escolherOnline(acao) {
    var p = S.on.p, n = p.turno;
    if (p.minhas[n]) { return; }
    var a = { tipo: acao.tipo, idx: acao.idx };
    if (a.tipo === 'golpe' && p.forma != null) { a.forma = p.forma; }
    p.forma = null; p.minhas[n] = a;
    NET.enviar({ t: 'acao', n: n, a: a });
    S.msg = 'À espera da jogada do adversário...';
    render();
    resolverOnline();
  }
  async function resolverOnline() {
    var p = S.on.p, n = p.turno, aj = p.minhas[n], ao = p.deles[n];
    if (!emOnline() || S.ocupado || S.fim || !aj || !ao) { return; }
    S.ocupado = true; S.escolha = null; render();
    var B = S.B, lados = ladosCanonicos();
    for (var t = 0; t < 2; t++) {
      var lt = lados[t], at = lt === 'j' ? aj : ao;
      var op = at.forma != null ? opcoesTransformar(B[lt])[at.forma] : null;
      if (op) { await transformar(lt, op); }
    }
    var acoes = ordem(B, aj, ao);
    for (var k = 0; k < acoes.length; k++) {
      var lado = acoes[k].lado, ac = acoes[k].a;
      if (ac.tipo === 'troca') {
        mensagem(lado === 'j' ? `<b>${esc(ativo(B.j).p.nome)}</b>, volte!` : `O oponente recolheu <b>${esc(ativo(B.o).p.nome)}</b>.`);
        var sai = $('mon-' + lado); if (sai) { sai.classList.add('sai'); }
        await esperar(450);
        await entrar(lado, ac.idx); continue;
      }
      if (ativo(B[lado]).hp <= 0) { continue; }
      var ko = await usarGolpe(lado, ac.idx);
      if (ko) { if (await aposDesmaioOnline(lado === 'j' ? 'o' : 'j', n)) { fecharTurno(n); return; } break; }
    }
    for (var g = 0; g < 2; g++) {
      var lg = lados[g], mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      fimTurnoLado(B[lg]);
    }
    fecharTurno(n);
    S.ocupado = false; S.msg = p.deles[p.turno] ? msgVez() + ' <i>(o adversário já escolheu)</i>' : msgVez(); render();
    return resolverOnline();
  }
  /* fim do turno: avança o contador e compara o estado com o do outro lado */
  function fecharTurno(n) {
    var p = S.on.p, B = S.B, resumo = ladosCanonicos().map(function (l) {
      return B[l].ativo + ':' + B[l].time.map(function (m) { return m.hp + '/' + m.pp.join('.') + '/' + m.p.id; }).join(',') + ':' + JSON.stringify(ativo(B[l]).est);
    }).join('|');
    p.turno = n + 1; p.syncEu[n] = resumo;
    NET.enviar({ t: 'sync', n: n, h: resumo });
    conferirSync(n);
  }
  function conferirSync(n) {
    var p = S.on.p;
    if (p.syncEu[n] != null && p.syncEle[n] != null && p.syncEu[n] !== p.syncEle[n]) {
      registrar(`<i class='pou'>⚠ Os dois aparelhos ficaram dessincronizados no turno ${n + 1}. Saiam e comecem outra batalha.</i>`);
    }
  }
  async function aposDesmaioOnline(ladoKO, n) {
    var B = S.B;
    if (!vivos(B.j).length || !vivos(B.o).length) {
      S.fim = vivos(B.j).length ? 'j' : 'o';
      registrar(S.fim === 'j' ? '<b>Você venceu!</b>' : '<b>O oponente venceu.</b>');
      S.ocupado = false; render(); return true;
    }
    var idx = await new Promise(function (ok) {
      var p = S.on.p;
      if (ladoKO === 'j' && p.minhasTrocas[n] != null) { ok(p.minhasTrocas[n]); }
      else if (ladoKO === 'j') {
        S.rapido = false;
        p.resolverTroca = function (i) { p.resolverTroca = null; S.escolha = null; p.minhasTrocas[n] = i; NET.enviar({ t: 'troca', n: n, idx: i }); ok(i); };
        S.escolha = 'forcada'; render();
      } else if (p.trocas[n] != null) { ok(p.trocas[n]); }
      else {
        S.rapido = false;
        p.esperaTroca = function (i) { p.esperaTroca = null; ok(i); };
        mensagem('À espera que o adversário escolha o próximo Pokémon...');
      }
    });
    await entrar(ladoKO, idx);
    return false;
  }
  function comecarOnline() {
    // só o anfitrião: sorteia a semente e manda os dois times
    var cfg = { t: 'inicio', semente: Math.floor(Math.random() * 4294967296), modo: S.modo, times: { host: S.time.j.slice(), conv: S.on.opTime.slice() },
      mv: { host: golpesDoTime(S.time.j, S.mv.j), conv: S.on.opMv || {} }, itens: { host: itensDoTime('j'), conv: S.on.opItens || {} } };
    NET.enviar(cfg);
    iniciarOnline(cfg);
  }
  function iniciarOnline(cfg) { prepararOnline(cfg); iniciarBatalha({ host: S.on.host }); }
  async function retomarOnline(m) {
    prepararOnline(m.cfg);
    var p = S.on.p;
    (m.jogadas || []).forEach(function (j) {
      var d = j.dados || {};
      if (j.tipo === 'acao') { (j.minha ? p.minhas : p.deles)[j.n] = d; }
      else if (j.tipo === 'troca') { (j.minha ? p.minhasTrocas : p.trocas)[j.n] = d.idx; }
      else if (j.tipo === 'sync' && !j.minha) { p.syncEle[j.n] = d.h; }
      else if (j.tipo === 'revanche') { if (j.minha) { p.revEu = true; } else { p.revEle = true; } }
    });
    S.online = true; S.rapido = true;
    try { await iniciarBatalha({ host: S.on.host }); } finally { S.rapido = false; }
    if (!S.fim && !S.escolha) { S.msg = p.minhas[p.turno] ? 'À espera da jogada do adversário...' : p.deles[p.turno] ? msgVez() + ' <i>(o adversário já escolheu)</i>' : msgVez(); }
    registrar('<i>Batalha retomada.</i>');
    render();
    revancheOnline();
  }
  function prepararOnline(cfg) {
    var host = NET.papel === 'host';
    S.modo = cfg.modo;
    S.time.j = (host ? cfg.times.host : cfg.times.conv).slice();
    S.time.o = (host ? cfg.times.conv : cfg.times.host).slice();
    var mv = cfg.mv || {};
    S.mv.j = limparGolpes(host ? mv.host : mv.conv); S.mv.o = limparGolpes(host ? mv.conv : mv.host);
    var it = cfg.itens || {};
    S.itens.j = limparItens(host ? it.host : it.conv); S.itens.o = limparItens(host ? it.conv : it.host);
    S.ge = null;
    S.on.host = host; S.on.pronto = S.on.opPronto = false; S.on.p = novaPartida();
    rng = mulberry32(cfg.semente);
    S.auto = false; S.sim = null;
  }
  function voltarSala(avisarOutro) {
    if (avisarOutro && emOnline()) { NET.enviar({ t: 'sala' }); }
    rng = Math.random;
    S.tela = 'selecao'; S.B = null; S.fim = null; S.escolha = null; S.ocupado = false; S.auto = false;
    S.time.o = []; S.mv.o = {}; S.itens.o = {}; S.on.pronto = S.on.opPronto = false; S.on.p = novaPartida();
    enviarTime(); render();
  }
  function ausenteHtml() { return NET && NET.estado === 'ausente' ? "<div class='on-aus'>⏸ O adversário saiu da app. A batalha continua quando ele voltar.</div>" : ''; }
  function botaoRevanche() {
    if (!emOnline()) { return `<div class='bt bt-go' data-acao='revanche'>↻ REVANCHE</div>`; }
    if (!ligadoOuAusente()) { return ''; }
    var p = S.on.p;
    return p.revEu ? `<div class='bt bt-go off'>À espera do adversário...</div>` :
      `<div class='bt bt-go' data-acao='revanche'>${p.revEle ? '↻ ACEITAR REVANCHE' : '↻ PEDIR REVANCHE'}</div>`;
  }
  function revancheOnline() {
    var p = S.on.p;
    if (p.revEu && p.revEle && NET.papel === 'host') {
      S.time.j = S.time.j.slice(); S.on.opTime = S.time.o.slice(); S.on.opMv = golpesDoTime(S.time.o, S.mv.o); S.on.opItens = itensDoTime('o');
      comecarOnline();
    }
  }

  /* ================= ONLINE: SALA ================= */
  function golpesDoTime(ids, mv) {
    var out = {};
    ids.forEach(function (id) { if (mv[id]) { out[id] = mv[id].slice(0, 4); } });
    return out;
  }
  /* golpes recebidos do outro lado: só índices válidos */
  function limparGolpes(mv) {
    var out = {};
    Object.keys(mv || {}).forEach(function (id) {
      var l = (mv[id] || []).filter(function (i) { return typeof i === 'number' && GR[i]; }).slice(0, 4);
      if (l.length) { out[id] = l; }
    });
    return out;
  }
  function ligadoOuAusente() { return NET && (NET.estado === 'ligado' || NET.estado === 'ausente'); }
  function caiu() { return NET && (NET.estado === 'caiu' || NET.estado === 'erro' || NET.estado === 'off'); }
  function limparItens(it) {
    var out = {}, n = 0;
    Object.keys(it || {}).forEach(function (id) { if (n < 1 && P[id] && (it[id] === 'mega' || it[id] === 'gmax') && itensPossiveis(P[id]).indexOf(it[id]) >= 0) { out[id] = it[id]; n++; } });
    return out;
  }
  function enviarTime() {
    if (!S.online || !ligadoOuAusente()) { return; }
    NET.enviar({ t: 'time', ids: S.time.j.slice(), mv: golpesDoTime(S.time.j, S.mv.j), itens: itensDoTime('j'), pronto: S.on.pronto });
  }
  function talvezComecar() {
    if (NET.papel === 'host' && S.on.pronto && S.on.opPronto && S.time.j.length === tamanhoTime() && S.on.opTime.length === tamanhoTime()) { comecarOnline(); }
  }
  function aoReceber(m) {
    var p = S.on.p;
    switch (m.t) {
      case 'ola':
        S.on.aviso = m.v !== VERSAO ? 'Vocês estão com versões diferentes do site. Recarreguem a página nos dois aparelhos.' : '';
        if (NET.papel === 'host') { NET.enviar({ t: 'modo', m: S.modo }); }
        enviarTime(); if (S.tela !== 'batalha') { render(); } break;
      case 'modo':
        S.modo = m.m; S.time.j = S.time.j.slice(0, tamanhoTime()); S.on.pronto = false; enviarTime();
        if (S.tela !== 'batalha') { render(); } break;
      case 'time':
        S.on.opTime = m.ids || []; S.on.opMv = limparGolpes(m.mv); S.on.opItens = limparItens(m.itens); S.on.opQtd = S.on.opTime.length; S.on.opPronto = !!m.pronto;
        if (S.tela !== 'batalha') { render(); talvezComecar(); } break;
      case 'inicio': iniciarOnline(m); break;
      case 'retomar': retomarOnline(m); break;
      case 'saiu':
        S.on.opPronto = false; S.on.opTime = []; S.on.opQtd = 0; S.on.aviso = 'O adversário saiu da sala.';
        if (emOnline()) { voltarSala(false); } else { render(); }
        break;
      case 'acao': p.deles[m.n] = m.a; if (emOnline() && !S.ocupado && m.n === p.turno && p.minhas[m.n] == null) { mensagem(msgVez() + ' <i>(o adversário já escolheu)</i>'); } resolverOnline(); break;
      case 'troca': p.trocas[m.n] = m.idx; if (p.esperaTroca) { p.esperaTroca(m.idx); } break;
      case 'sync': p.syncEle[m.n] = m.h; conferirSync(m.n); break;
      case 'revanche': p.revEle = true; if (S.fim) { render(); } revancheOnline(); break;
      case 'sala': if (emOnline()) { voltarSala(false); S.on.aviso = 'O adversário voltou à escolha de times.'; render(); } break;
    }
  }
  if (NET && !window.__arenaNet) {
    window.__arenaNet = true;
    NET.aoReceber(function (m) { aoReceber(m); });
    NET.versao = VERSAO;
    NET.aoMudarEstado(function (estado) {
      if (estado === 'ligado') { if (/saiu/.test(S.on.aviso || '')) { S.on.aviso = ''; } enviarTime(); }
      if (estado === 'off' || estado === 'caiu' || estado === 'erro') { S.on.opPronto = false; S.on.opTime = []; S.on.opQtd = 0; }
      if (S.tela !== 'batalha') { render(); return; }
      if (emOnline() && caiu()) { render(); return; }
      var aus = $('ar-aus'); if (aus) { aus.innerHTML = ausenteHtml(); }
    });
  }
  function codigoDoLink() { var m = /^#sala-([A-Za-z0-9]{6})$/.exec(location.hash || ''); return m ? m[1].toUpperCase() : ''; }

  /* ================= CALIBRAÇÃO DOS NÍVEIS ================= */
  /* corre na consola (__arenaApi.calibrar()): ajusta o nível de cada Pokémon até ganhar perto de 50%
     contra adversários ao acaso, em 1x1 com golpes automáticos. O resultado vai para web/dados/niveis.js. */
  function calibrar(opts) {
    opts = opts || {};
    var cand = LISTA.filter(function (p) { return !ehFormaEspecial(p); }), rodadas = opts.rodadas || [[12, 40], [6, 60], [3, 80], [2, 120]];
    cand.forEach(function (p) { if (!NIV[p.id]) { NIV[p.id] = nivelFormula(p); } });
    var estado = { feito: 0, total: cand.length * rodadas.length, rodada: 0 };
    window.__calibracao = estado;
    function pool(n) { var o = []; for (var i = 0; i < n; i++) { o.push(cand[Math.floor(Math.random() * cand.length)].id); } return o; }
    return new Promise(function (ok) {
      var r = 0, i = 0;
      function passo() {
        var t0 = Date.now();
        while (Date.now() - t0 < 40) {
          if (r >= rodadas.length) { estado.fim = true; ok(NIV); return; }
          var p = cand[i], passoN = rodadas[r][0], n = rodadas[r][1], vit = 0, ops = pool(n);
          ops.forEach(function (o) { if (simular([p.id], [o], {}, {}).venc === 'j') { vit++; } });
          var wr = vit / n, ajuste = Math.round((0.5 - wr) * 2 * passoN);
          NIV[p.id] = Math.max(1, Math.min(100, NIV[p.id] + ajuste));
          estado.feito++; i++;
          if (i >= cand.length) { i = 0; r++; estado.rodada = r; }
        }
        setTimeout(passo, 0);
      }
      passo();
    });
  }

  /* ================= CLIQUES ================= */
  function sortear(l) {
    var base = LISTA.filter(function (p) { return p.padrao; });
    S.time[l] = [];
    while (S.time[l].length < tamanhoTime()) { var id = K.aleatorio(base).id; if (S.time[l].indexOf(id) < 0) { S.time[l].push(id); } }
  }
  raiz.onclick = function (ev) {
    var el = ev.target.closest('[data-acao]'); if (!el || el.classList.contains('off')) { return; }
    var acao = el.getAttribute('data-acao'), l = el.getAttribute('data-lado');
    if (S.online && (acao === 'lado' || acao === 'add' || acao === 'aleatorio' || acao === 'tirar')) { l = 'j'; S.lado = 'j'; }
    var mudouTime = S.online && S.tela !== 'batalha' && (acao === 'add' || acao === 'aleatorio' || acao === 'tirar');
    switch (acao) {
      case 'modo':
        S.modo = +el.getAttribute('data-m'); ['j', 'o'].forEach(function (x) { S.time[x] = S.time[x].slice(0, tamanhoTime()); });
        if (S.online) { S.on.pronto = false; if (NET.papel === 'host') { NET.enviar({ t: 'modo', m: S.modo }); } enviarTime(); }
        render(); break;
      case 'online':
        S.online = !S.online; S.lado = 'j'; S.on.aviso = '';
        if (!S.online && NET) { NET.sair(); }
        render(); break;
      case 'criarSala': S.on.aviso = ''; NET.criarSala(); break;
      case 'entrarSala': S.on.aviso = ''; NET.entrar(S.on.codigo); break;
      case 'sairSala': S.on.aviso = ''; NET.sair(); break;
      case 'copiarLink':
        var campo = $('ar-link'), ok = function () { el.textContent = '✓ Copiado'; };
        try { navigator.clipboard.writeText(NET.link()).then(ok, function () { campo.select(); }); } catch (e) { campo.select(); }
        break;
      case 'pronto': S.on.pronto = !S.on.pronto; enviarTime(); render(); talvezComecar(); break;
      case 'item':
        ev.stopPropagation();
        trocarItem(l, +el.getAttribute('data-id'));
        if (S.online) { S.on.pronto = false; enviarTime(); }
        S.previa = null; render(); break;
      case 'editarGolpes':
        ev.stopPropagation();
        var eid = +el.getAttribute('data-id');
        S.ge = { lado: l, id: eid, ids: golpesDe(P[eid], S.mv[l][eid]).filter(function (g) { return g.id != null; }).map(function (g) { return g.id; }), busca: '', tipo: '', cat: '' };
        render(); break;
      case 'geToggle':
        var gid = +el.getAttribute('data-g'), pos = S.ge.ids.indexOf(gid);
        if (pos >= 0) { S.ge.ids.splice(pos, 1); } else if (S.ge.ids.length < 4) { S.ge.ids.push(gid); }
        geAtualizar(); break;
      case 'geTipo': S.ge.tipo = el.getAttribute('data-t'); geAtualizar(); break;
      case 'geCat': S.ge.cat = el.getAttribute('data-c'); geAtualizar(); break;
      case 'geAuto': S.ge.ids = golpesAuto(P[S.ge.id]) || []; geAtualizar(); break;
      case 'geFechar': S.ge = null; render(); break;
      case 'geOk':
        if (S.ge.ids.length) { S.mv[S.ge.lado][S.ge.id] = S.ge.ids.slice(); }
        if (S.online && S.ge.lado === 'j') { S.on.pronto = false; S.ge = null; enviarTime(); }
        S.ge = null; S.previa = null; render(); break;
      case 'lado': S.lado = l; render(); break;
      case 'tipo': var t = el.getAttribute('data-t'); S.tipo = S.tipo === t ? '' : t; render(); break;
      case 'gen': S.gen = +el.getAttribute('data-g'); render(); break;
      case 'add':
        var id = +el.getAttribute('data-id'), lado = S.lado;
        if (S.time[lado].length >= tamanhoTime()) { if (S.online) { break; } lado = lado === 'j' ? 'o' : 'j'; }
        if (S.time[lado].length < tamanhoTime() && S.time[lado].indexOf(id) < 0) {
          S.time[lado].push(id);
          if (!Object.keys(itensDoTime(lado)).length) { var itAuto = itensAuto([id]); if (Object.keys(itAuto).length) { S.itens[lado] = itAuto; } }
          if (S.time[lado].length >= tamanhoTime() && lado === 'j') { S.lado = 'o'; } else { S.lado = lado; }
        }
        render(); break;
      case 'tirar': ev.stopPropagation(); S.time[l].splice(+el.getAttribute('data-i'), 1); S.lado = l; render(); break;
      case 'aleatorio': ev.stopPropagation(); sortear(l); render(); break;
      case 'batalhar': iniciarBatalha(); break;
      case 'golpe': executarTurno({ tipo: 'golpe', idx: +el.getAttribute('data-i') }); break;
      case 'trocar':
        var i = +el.getAttribute('data-i');
        if (S.escolha === 'forcada' && emOnline()) { if (S.on.p.resolverTroca) { S.on.p.resolverTroca(i); } }
        else if (S.escolha === 'forcada') { S.escolha = null; S.ocupado = true; entrar('j', i).then(function () { S.ocupado = false; S.msg = 'O que <b>' + esc(ativo(S.B.j).p.nome) + '</b> vai fazer?'; render(); }); }
        else { executarTurno({ tipo: 'troca', idx: i }); }
        break;
      case 'transformar':
        var op = opcoesTransformar(S.B.j)[+el.getAttribute('data-i')];
        if (emOnline()) {
          // online a transformação vai junto com o golpe deste turno
          var fi = +el.getAttribute('data-i');
          if (op && !S.ocupado && !jaEscolhi()) { S.on.p.forma = S.on.p.forma === fi ? null : fi; render(); }
        } else if (op && !S.ocupado) {
          S.ocupado = true;
          transformar('j', op).then(function () { S.ocupado = false; S.msg = 'O que <b>' + esc(ativo(S.B.j).p.nome) + '</b> vai fazer?'; render(); });
        }
        break;
      case 'auto': S.auto = !S.auto; render(); if (S.auto) { proximoAuto(); } break;
      case 'simular':
        S.sim = rodarSimulacoes(1000);
        registrar(`Simulação: você venceu <b>${S.sim.j.toFixed(1)}%</b> de 1.000 batalhas.`);
        var box = $('ar-sim'); if (box) { box.innerHTML = simHtml(); }
        break;
      case 'revanche':
        if (emOnline()) { S.on.p.revEu = true; NET.enviar({ t: 'revanche' }); render(); revancheOnline(); }
        else { iniciarBatalha(); }
        break;
      case 'novo':
        if (emOnline()) { voltarSala(true); break; }
        S.tela = 'selecao'; S.B = null; S.auto = false; S.fim = null; S.escolha = null; S.ocupado = false; render(); break;
    }
    if (mudouTime) { S.on.pronto = false; enviarTime(); render(); }
  };
  if (!window.__arenaResize) { window.__arenaResize = true; window.addEventListener('resize', function () { K.escala(raiz); }); }

  window.__arenaApi = { calibrar: calibrar, nivelDe: nivelDe, nivelFormula: nivelFormula, ehFormaEspecial: ehFormaEspecial, simular: simular, golpesDe: golpesDe, statusDe: statusDe, opcoesTransformar: opcoesTransformar, aplicarForma: aplicarForma, desfazerGmax: desfazerGmax, novoLado: novoLado };
  // link de convite: arena.html#sala-ABC123 entra direto na sala
  var codigoLink = codigoDoLink();
  var codigoRetomar = codigoLink || (NET && NET.configurado ? NET.salaGuardada() : '');
  if (codigoRetomar && NET && NET.estado === 'off') { S.online = true; S.lado = 'j'; S.on.codigo = codigoRetomar; NET.entrar(codigoRetomar); }
  if (!window.__arenaGuarda) {
    window.__arenaGuarda = true;
    K.aoSair(function () {
      var s = window.__arena; if (!s) { return; }
      var local = s.tela === 'batalha' && s.B && !s.B.online && fotoEstavel;
      K.guardar('arena', { versao: s.versao, tela: local ? 'batalha' : 'selecao', modo: s.modo, lado: s.lado, time: s.online ? { j: s.time.j, o: [] } : s.time,
        mv: s.online ? { j: s.mv.j, o: {} } : s.mv, itens: s.online ? { j: s.itens.j, o: {} } : s.itens, busca: s.busca, tipo: s.tipo, gen: s.gen, log: local ? fotoEstavel.log : [],
        msg: local ? fotoEstavel.msg : '', escolha: local ? fotoEstavel.escolha : null, fim: local ? fotoEstavel.fim : null, foto: local ? fotoEstavel.B : null });
    });
  }
  render();
  if (S.auto && S.tela === 'batalha' && !S.ocupado) { proximoAuto(); }
})();
