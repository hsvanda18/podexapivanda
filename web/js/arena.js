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
      pp: r[10] || 10, ef: r[11] || null, esp: r[12] || '', st: r[13] || null, fl: r[14] || 0, cura: r[15] || 0 };
  }) : [];
  var GR_NOME = {}; GR.forEach(function (g) { GR_NOME[g.nome] = g; });
  /* os golpes guardam-se pelo nome; números vêm de versões antigas (ordem em GOLPES_DADOS.antigos) */
  function nomeGolpe(x) { return typeof x === 'number' ? (GD && GD.antigos ? GD.antigos[x] : null) : x; }
  function converterMv(mv) {
    var out = {};
    Object.keys(mv || {}).forEach(function (id) {
      var l = (mv[id] || []).map(nomeGolpe).filter(function (n) { return n && GR_NOME[n]; }).slice(0, 4);
      if (l.length) { out[id] = l; }
    });
    return out;
  }
  var VERSAO = D.v + '.' + GR.length + '.r10';
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
      (baixaPropria(g) ? 0.8 : 1) * (g.esp === 'hp' ? 0.75 : g.esp === 'furia' ? 0.9 : g.esp === 'primeiro' ? 0.35 : g.esp === 'mao' ? 0.3 : g.esp === 'resposta' ? 0.85 : 1) * (g.pp <= 5 ? 0.95 : 1);
  }
  /* escolha automática: o melhor golpe de cada tipo do Pokémon, depois cobertura de outros tipos */
  /* quanto vale um golpe de estado para p (0 a ~1), para a escolha automática */
  function valorEstadoAuto(p, g) {
    var pk = p.b.atk >= p.b.spa ? 'atk' : 'spa', v = 0;
    if (g.ef && g.ef[0] === 'u') { g.ef[2].forEach(function (x) { v += x[1] * (x[0] === pk ? 0.35 : x[0] === 'spe' ? 0.21 : x[0] === 'def' || x[0] === 'spd' ? 0.1 : 0) * (x[1] < 0 ? 0.5 : 1); }); }
    if (g.ef && g.ef[0] === 'a') { g.ef[2].forEach(function (x) { v += -x[1] * 0.08; }); }
    if (g.st) { v += { brn: 0.45, par: 0.45, tox: 0.5, psn: 0.35, slp: 0.75, frz: 0.3, conf: 0.3 }[g.st[0]] || 0; }
    if (g.cura) { v += g.cura / 100 * 0.9; }
    if (g.esp === 'cura-sol' || g.esp === 'cura-areia') { v += 0.4; }
    if (g.esp === 'rest') { v += 0.35; }
    var beneficio = { sol: 'fire', chuva: 'water', areia: 'rock', neve: 'ice', 't-eletrico': 'electric', 't-planta': 'grass', 't-psiquico': 'psychic' }[g.esp];
    if (beneficio && p.t.indexOf(beneficio) >= 0) { v += 0.3; }
    var hl = habsDe(p), hAuto = hl.length ? hl[habAuto(p)].slug : '', defensivo = (p.b.def + p.b.spd + p.b.hp) > (p.b.atk + p.b.spa) * 1.6;
    if (PROTECAO[g.esp]) { v += hAuto === 'speed-boost' ? 0.6 : 0.2; }
    if (g.esp === 'reflect' || g.esp === 'light-screen') { v += defensivo ? 0.5 : 0.25; }
    if (g.esp === 'substituto') { v += defensivo ? 0.4 : 0.3; }
    if (RISCO[g.esp]) { v += (g.esp === 'rochas' ? 0.35 : 0.25) + (defensivo ? 0.15 : 0); }
    if (g.esp === 'semente') { v += defensivo ? 0.5 : 0.4; }
    if (g.esp === 'taunt' || g.esp === 'roar' || g.esp === 'haze' || g.esp === 'defog') { v += 0.25; }
    return v * (g.ac ? g.ac / 100 : 1);
  }
  function golpesAuto(p) {
    var todos = aprende(p), estados = todos.filter(function (g) { return g.c === 'S'; });
    var cand = todos.filter(function (g) { return g.c !== 'S'; }).sort(function (a, b) { return forca(p, b) - forca(p, a); });
    if (!cand.length) { return null; }
    var out = [], topo = forca(p, cand[0]);
    p.t.forEach(function (t) { var g = cand.find(function (x) { return x.t === t; }); if (g && out.length < 4) { out.push(g); } });
    cand.forEach(function (g) { if (out.length < 4 && out.indexOf(g) < 0 && forca(p, g) >= topo * 0.35 && !out.some(function (x) { return x.t === g.t; })) { out.push(g); } });
    cand.forEach(function (g) { if (out.length < 4 && out.indexOf(g) < 0) { out.push(g); } });
    var est = estados.sort(function (a, b) { return valorEstadoAuto(p, b) - valorEstadoAuto(p, a); })[0];
    if (est && valorEstadoAuto(p, est) >= 0.5 && out.length >= 3) { if (out.length === 4) { out[3] = est; } else { out.push(est); } }
    return out.map(function (g) { return g.id; });
  }
  function golpesDe(p, ids) {
    var lista = (ids && ids.length ? ids : golpesAuto(p) || []).map(function (i) { return typeof i === 'number' ? GR[i] : GR_NOME[i]; }).filter(Boolean);
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
  /* IV 31, sem EVs; a nature dá ×1,1 a um atributo e ×0,9 a outro (nunca ao HP) */
  function statusDe(b, nv, nat) {
    var n = NATURES[nat] || NATURES[0];
    var f = function (x, k) { var v = Math.floor((2 * x + 31) * nv / 100) + 5; return n.sobe === k ? Math.floor(v * 1.1) : n.desce === k ? Math.floor(v * 0.9) : v; };
    return { hp: Math.floor((2 * b.hp + 31) * nv / 100) + nv + 10, atk: f(b.atk, 'atk'), def: f(b.def, 'def'), spa: f(b.spa, 'spa'), spd: f(b.spd, 'spd'), spe: f(b.spe, 'spe') };
  }

  /* ---------- natures: as 25 dos jogos, pela ordem oficial (linha = sobe, coluna = desce) ---------- */
  var ORDEM_NAT = ['atk', 'def', 'spe', 'spa', 'spd'];
  var NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
    'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'].map(function (nome, i) {
    var s = ORDEM_NAT[Math.floor(i / 5)], d = ORDEM_NAT[i % 5];
    return { i: i, nome: nome, sobe: s === d ? null : s, desce: s === d ? null : d };
  });
  function natDe(nome) { return NATURES.find(function (n) { return n.nome === nome; }).i; }
  /* perfil de ataque: que atributos de ataque os golpes escolhidos usam */
  function perfil(p, golpes) {
    var F = 0, E = 0;
    golpes.forEach(function (g) { if (g.c === 'F') { F += forca(p, g) || 1; } else { E += forca(p, g) || 1; } });
    var tot = F + E || 1;
    return { F: F / tot >= 0.2, E: E / tot >= 0.2 };
  }
  function pesoAtr(k, pf) {
    if (k === 'atk') { return pf.F ? (pf.E ? 1.5 : 2) : 0; }
    if (k === 'spa') { return pf.E ? (pf.F ? 1.5 : 2) : 0; }
    return k === 'spe' ? 1.5 : 1;
  }
  /* benéfica (sobe algo útil, baixa o que não usa), neutra ou prejudicial (baixa o ataque que usa ou a velocidade) */
  function classeNat(i, p, golpes) {
    var n = NATURES[i]; if (!n.sobe) { return 'neutra'; }
    var pf = perfil(p, golpes), s = pesoAtr(n.sobe, pf) - pesoAtr(n.desce, pf);
    if (s <= -0.5 || ((n.desce === 'atk' && pf.F && !pf.E) || (n.desce === 'spa' && pf.E && !pf.F))) { return 'ma'; }
    return s >= 0.5 && n.desce !== 'spe' ? 'boa' : 'neutra';
  }
  var ROTULO_NAT = { boa: '🟢 Benéfica', neutra: '⚪ Neutra', ma: '🔴 Prejudicial' };
  /* escolha automática: a melhor benéfica para o perfil (rápidos sobem a Velocidade) */
  function natAuto(p, golpes) {
    var pf = perfil(p, golpes), rapido = p.b.spe >= 80, b = p.b;
    if (pf.F && !pf.E) { return natDe(rapido ? 'Jolly' : 'Adamant'); }
    if (pf.E && !pf.F) { return natDe(rapido ? 'Timid' : 'Modest'); }
    if (rapido) { return natDe(b.def <= b.spd ? 'Hasty' : 'Naive'); }
    return b.atk >= b.spa ? natDe(b.def <= b.spd ? 'Lonely' : 'Naughty') : natDe(b.def <= b.spd ? 'Mild' : 'Rash');
  }

  /* ---------- evolução em batalha: ao derrubar um adversário, evolui para o próximo estágio ---------- */
  var FILHOS = {};
  D.pk.forEach(function (r) { if (r[14] && r[11] === 1 && P[r[0]]) { (FILHOS[r[14]] || (FILHOS[r[14]] = [])).push(P[r[0]]); } });
  Object.keys(FILHOS).forEach(function (k) { FILHOS[k].sort(function (a, b) { return a.esp - b.esp; }); });
  function evolucaoDe(p) { var f = FILHOS[p.esp]; return f && f.length ? f[0] : null; }

  /* ---------- habilidades (dados/habilidades.js) ---------- */
  /* [valor para a escolha automática, o que faz na Arena]. As que não estão aqui (clima, estados, terrenos...) não têm efeito. */
  var HAB_INFO = {
    'huge-power': [10, 'Ataque ×2'], 'pure-power': [10, 'Ataque ×2'],
    'adaptability': [7, 'STAB ×2 em vez de ×1,5'], 'technician': [6, 'golpes de poder 60 ou menos ×1,5'],
    'sheer-force': [6, 'golpes com efeito secundário ×1,3, mas sem o efeito'], 'tough-claws': [6, 'golpes físicos ×1,3'],
    'iron-fist': [5, 'socos ×1,2'], 'strong-jaw': [6, 'mordidas ×1,5'], 'mega-launcher': [6, 'golpes de pulso e de aura ×1,5'],
    'sharpness': [6, 'golpes cortantes ×1,5'], 'reckless': [5, 'golpes com recuo ×1,2'], 'punk-rock': [5, 'golpes sonoros ×1,3; recebe metade dos sonoros'],
    'hustle': [5, 'Ataque ×1,5, mas os golpes físicos têm 80% da precisão'],
    'blaze': [4, 'golpes de Fogo ×1,5 com HP ≤ 1/3'], 'torrent': [4, 'golpes de Água ×1,5 com HP ≤ 1/3'],
    'overgrow': [4, 'golpes de Planta ×1,5 com HP ≤ 1/3'], 'swarm': [4, 'golpes de Inseto ×1,5 com HP ≤ 1/3'],
    'tinted-lens': [6, 'golpes pouco efetivos fazem o dobro'], 'neuroforce': [5, 'golpes super efetivos ×1,25'],
    'sniper': [3, 'golpes críticos ×2,25'], 'super-luck': [3, 'mais golpes críticos'], 'skill-link': [6, 'golpes múltiplos acertam sempre o máximo'],
    'compound-eyes': [3, 'precisão ×1,3'], 'victory-star': [2, 'precisão ×1,1'], 'no-guard': [3, 'nenhum golpe falha, dos dois lados'],
    'pixilate': [7, 'golpes Normal viram Fada e fazem ×1,2'], 'refrigerate': [7, 'golpes Normal viram Gelo e fazem ×1,2'],
    'aerilate': [7, 'golpes Normal viram Voador e fazem ×1,2'], 'galvanize': [7, 'golpes Normal viram Elétrico e fazem ×1,2'],
    'liquid-voice': [3, 'golpes sonoros viram Água'], 'protean': [6, 'STAB em todos os golpes'], 'libero': [6, 'STAB em todos os golpes'],
    'parental-bond': [8, 'ataca duas vezes (o 2.º golpe a 25%)'], 'scrappy': [3, 'Normal e Lutador acertam Fantasma; imune a Intimidate'],
    'mold-breaker': [4, 'ignora as habilidades defensivas do alvo'], 'teravolt': [4, 'ignora as habilidades defensivas do alvo'], 'turboblaze': [4, 'ignora as habilidades defensivas do alvo'],
    'steelworker': [4, 'golpes de Aço ×1,5'], 'steely-spirit': [4, 'golpes de Aço ×1,5'], 'dragons-maw': [4, 'golpes de Dragão ×1,5'],
    'transistor': [4, 'golpes Elétrico ×1,3'], 'rocky-payload': [4, 'golpes de Pedra ×1,5'], 'water-bubble': [8, 'golpes de Água ×2; Fogo recebido ×0,5; não pode ser queimado'],
    'orichalcum-pulse': [7, 'ao entrar: sol por 5 turnos; com sol, Ataque ×1,33'], 'hadron-engine': [7, 'ao entrar: terreno Elétrico por 5 turnos; com ele, Atq. Esp. ×1,33'],
    'electric-surge': [5, 'ao entrar: terreno Elétrico por 5 turnos (golpes Elétrico ×1,3)'],
    'grassy-surge': [5, 'ao entrar: terreno de Planta por 5 turnos (Planta ×1,3, cura 1/16 por turno, Earthquake a metade)'],
    'psychic-surge': [5, 'ao entrar: terreno Psíquico por 5 turnos (Psíquico ×1,3, protege de golpes com prioridade)'],
    'misty-surge': [5, 'ao entrar: terreno de Névoa por 5 turnos (golpes de Dragão recebidos a metade)'],
    'seed-sower': [3, 'quando é atingido: terreno de Planta por 5 turnos'],
    'quark-drive': [3, 'com terreno Elétrico, o melhor atributo ×1,3 (Velocidade ×1,5)'],
    'surge-surfer': [2, 'com terreno Elétrico, Velocidade ×2'], 'grass-pelt': [2, 'com terreno de Planta, Defesa ×1,5'],
    'mimicry': [2, 'muda para o tipo do terreno (Elétrico, Planta, Psíquico ou Fada)'],
    'drought': [5, 'ao entrar: sol por 5 turnos (Fogo ×1,5, Água ×0,5)'], 'drizzle': [5, 'ao entrar: chuva por 5 turnos (Água ×1,5, Fogo ×0,5)'],
    'sand-stream': [4, 'ao entrar: tempestade de areia por 5 turnos (fere 1/16 por turno quem não é Pedra, Terra ou Aço; Pedra com Def. Esp. ×1,5)'],
    'snow-warning': [4, 'ao entrar: neve por 5 turnos (Gelo com Defesa ×1,5)'], 'sand-spit': [3, 'quando é atingido: tempestade de areia por 5 turnos'],
    'swift-swim': [2, 'com chuva, Velocidade ×2'], 'chlorophyll': [2, 'com sol, Velocidade ×2'], 'sand-rush': [2, 'com areia, Velocidade ×2; imune à areia'],
    'slush-rush': [2, 'com neve, Velocidade ×2'], 'solar-power': [2, 'com sol, Atq. Esp. ×1,5, mas perde 1/8 do HP por turno'],
    'sand-force': [2, 'com areia, golpes de Pedra, Terra e Aço ×1,3; imune à areia'], 'sand-veil': [1, 'com areia, o adversário acerta menos (precisão ×0,8); imune à areia'],
    'snow-cloak': [1, 'com neve, o adversário acerta menos (precisão ×0,8)'], 'rain-dish': [1, 'com chuva, recupera 1/16 do HP por turno'],
    'ice-body': [1, 'com neve, recupera 1/16 do HP por turno'], 'flower-gift': [2, 'com sol, Ataque e Def. Esp. ×1,5'],
    'protosynthesis': [3, 'com sol, o melhor atributo ×1,3 (Velocidade ×1,5)'], 'overcoat': [2, 'imune ao dano da areia e aos pós (Spore, Sleep Powder...)'],
    'cloud-nine': [2, 'anula o clima enquanto está em campo'], 'air-lock': [2, 'anula o clima enquanto está em campo'],
    'fairy-aura': [4, 'golpes de Fada ×1,33 (para os dois lados)'], 'dark-aura': [4, 'golpes Sombrio ×1,33 (para os dois lados)'],
    'sword-of-ruin': [5, 'Defesa do adversário ×0,75'], 'beads-of-ruin': [5, 'Def. Esp. do adversário ×0,75'],
    'tablets-of-ruin': [5, 'Ataque do adversário ×0,75'], 'vessel-of-ruin': [5, 'Atq. Esp. do adversário ×0,75'],
    'gale-wings': [5, 'golpes Voador com prioridade +1 com o HP cheio'], 'triage': [4, 'golpes que drenam com prioridade +3'],
    'serene-grace': [4, 'efeitos secundários com o dobro da chance'], 'pressure': [3, 'o adversário gasta 2 PP por golpe'],
    'moxie': [6, 'ao derrubar um adversário: Ataque +1'], 'chilling-neigh': [6, 'ao derrubar um adversário: Ataque +1'],
    'as-one-glastrier': [6, 'ao derrubar um adversário: Ataque +1'], 'grim-neigh': [6, 'ao derrubar um adversário: Atq. Esp. +1'],
    'as-one-spectrier': [6, 'ao derrubar um adversário: Atq. Esp. +1'], 'beast-boost': [6, 'ao derrubar um adversário: o melhor atributo +1'],
    'defeatist': [-3, 'Ataque e Atq. Esp. a metade com HP abaixo de 50%'],
    'truant': [-8, 'ataca um turno sim, outro não'], 'slow-start': [-6, 'Ataque e Velocidade a metade nos 5 primeiros turnos em campo'],
    'speed-boost': [7, 'Velocidade +1 no fim de cada turno'], 'moody': [6, 'fim de cada turno: um atributo +2 e outro −1'],
    'intimidate': [6, 'ao entrar: Ataque do adversário −1'], 'download': [5, 'ao entrar: Ataque ou Atq. Esp. +1 (o que o adversário defende pior)'],
    'intrepid-sword': [7, 'ao entrar pela 1.ª vez: Ataque +1'], 'dauntless-shield': [5, 'ao entrar pela 1.ª vez: Defesa +1'],
    'trace': [3, 'ao entrar: copia a habilidade do adversário'], 'regenerator': [5, 'ao sair de campo recupera 1/3 do HP'],
    'contrary': [4, 'as mudanças de atributos são invertidas'], 'simple': [4, 'as mudanças de atributos contam a dobrar'],
    'unaware': [5, 'ignora as mudanças de atributos do adversário'],
    'clear-body': [3, 'o adversário não lhe baixa atributos'], 'white-smoke': [3, 'o adversário não lhe baixa atributos'],
    'full-metal-body': [3, 'o adversário não lhe baixa atributos'], 'mirror-armor': [4, 'devolve ao adversário as baixas de atributos'],
    'hyper-cutter': [2, 'o Ataque não pode ser baixado'], 'big-pecks': [1, 'a Defesa não pode ser baixada'],
    'defiant': [4, 'quando o adversário lhe baixa um atributo: Ataque +2'], 'competitive': [4, 'quando o adversário lhe baixa um atributo: Atq. Esp. +2'],
    'inner-focus': [2, 'imune a Intimidate e a recuar'], 'oblivious': [1, 'imune a Intimidate'], 'own-tempo': [2, 'imune a Intimidate e à confusão'],
    'guard-dog': [3, 'Intimidate sobe-lhe o Ataque em vez de baixar'],
    'magic-guard': [4, 'só perde HP com golpes (sem recuo nem dano de habilidades)'], 'rock-head': [3, 'sem recuo dos golpes'],
    'liquid-ooze': [2, 'quem o drena perde HP em vez de recuperar'], 'shield-dust': [3, 'protegido dos efeitos secundários (atributos, estados e recuo)'],
    'battle-armor': [2, 'não sofre golpes críticos'], 'shell-armor': [2, 'não sofre golpes críticos'],
    'levitate': [5, 'imune a golpes de Terra'], 'flash-fire': [5, 'imune a Fogo; depois disso, os golpes de Fogo dele ×1,5'],
    'water-absorb': [5, 'imune a Água e recupera 1/4 do HP'], 'volt-absorb': [5, 'imune a Elétrico e recupera 1/4 do HP'],
    'dry-skin': [3, 'imune a Água (recupera 1/4 do HP); Fogo recebido ×1,25; com chuva recupera 1/8 por turno, com sol perde 1/8'], 'earth-eater': [5, 'imune a Terra e recupera 1/4 do HP'],
    'lightning-rod': [5, 'imune a Elétrico; Atq. Esp. +1'], 'storm-drain': [5, 'imune a Água; Atq. Esp. +1'],
    'motor-drive': [5, 'imune a Elétrico; Velocidade +1'], 'sap-sipper': [5, 'imune a Planta; Ataque +1'], 'well-baked-body': [5, 'imune a Fogo; Defesa +2'],
    'wonder-guard': [8, 'só os golpes super efetivos lhe acertam'], 'bulletproof': [3, 'imune a bombas e esferas'], 'soundproof': [3, 'imune a golpes sonoros'],
    'dazzling': [3, 'imune a golpes com prioridade'], 'queenly-majesty': [3, 'imune a golpes com prioridade'], 'armor-tail': [3, 'imune a golpes com prioridade'],
    'thick-fat': [5, 'Fogo e Gelo recebidos ×0,5'], 'heatproof': [3, 'Fogo recebido ×0,5; a queimadura tira metade'], 'purifying-salt': [5, 'Fantasma recebido ×0,5; imune a estados'],
    'fluffy': [5, 'golpes físicos recebidos ×0,5; Fogo recebido ×2'], 'ice-scales': [6, 'golpes especiais recebidos ×0,5'], 'fur-coat': [8, 'golpes físicos recebidos ×0,5'],
    'multiscale': [6, 'com o HP cheio, recebe metade do dano'], 'shadow-shield': [6, 'com o HP cheio, recebe metade do dano'],
    'filter': [5, 'super efetivos recebidos ×0,75'], 'solid-rock': [5, 'super efetivos recebidos ×0,75'], 'prism-armor': [5, 'super efetivos recebidos ×0,75'],
    'sturdy': [4, 'com o HP cheio, aguenta qualquer golpe com 1 HP'], 'disguise': [7, 'o primeiro golpe só lhe tira 1/8 do HP'], 'ice-face': [5, 'o primeiro golpe físico não lhe faz dano'],
    'rough-skin': [4, 'quem o ataca com golpe físico perde 1/8 do HP'], 'iron-barbs': [4, 'quem o ataca com golpe físico perde 1/8 do HP'],
    'justified': [3, 'atingido por golpe Sombrio: Ataque +1'], 'weak-armor': [3, 'atingido por golpe físico: Defesa −1, Velocidade +2'],
    'stamina': [5, 'sempre que é atingido: Defesa +1'], 'rattled': [2, 'atingido por Inseto, Fantasma ou Sombrio: Velocidade +1'],
    'steam-engine': [4, 'atingido por Fogo ou Água: Velocidade +6'], 'thermal-exchange': [3, 'atingido por Fogo: Ataque +1'],
    'berserk': [4, 'ao cair abaixo de metade do HP: Atq. Esp. +1'], 'anger-shell': [5, 'ao cair abaixo de metade do HP: Ataque, Atq. Esp. e Velocidade +1, defesas −1'],
    'anger-point': [3, 'ao sofrer um crítico: Ataque no máximo'], 'gooey': [3, 'quem o ataca com golpe físico: Velocidade −1'],
    'tangling-hair': [3, 'quem o ataca com golpe físico: Velocidade −1'], 'cotton-down': [3, 'sempre que é atingido: Velocidade do adversário −1'],
    'guts': [5, 'com um estado: Ataque ×1,5 (e a queimadura não lhe tira força)'], 'marvel-scale': [4, 'com um estado: Defesa ×1,5'],
    'quick-feet': [4, 'com um estado: Velocidade ×1,5 (e a paralisia não o abranda)'], 'toxic-boost': [4, 'envenenado: Ataque ×1,5'],
    'flare-boost': [4, 'queimado: Atq. Esp. ×1,5'], 'poison-heal': [6, 'envenenado, recupera 1/8 do HP por turno em vez de perder'],
    'natural-cure': [3, 'cura o estado ao sair de campo'], 'shed-skin': [3, '1/3 de chance por turno de se curar do estado'],
    'hydration': [2, 'com chuva, cura-se do estado no fim do turno'], 'leaf-guard': [2, 'com sol, não apanha estados'],
    'immunity': [2, 'não pode ser envenenado'], 'pastel-veil': [2, 'não pode ser envenenado'], 'limber': [2, 'não pode ser paralisado'],
    'insomnia': [2, 'não adormece'], 'vital-spirit': [2, 'não adormece'], 'sweet-veil': [2, 'não adormece'],
    'water-veil': [2, 'não pode ser queimado'], 'magma-armor': [2, 'não congela'],
    'static': [4, 'quem o ataca com golpe físico: 30% de ficar paralisado'], 'flame-body': [4, 'quem o ataca com golpe físico: 30% de ficar queimado'],
    'poison-point': [3, 'quem o ataca com golpe físico: 30% de ficar envenenado'], 'effect-spore': [3, 'quem o ataca com golpe físico: 30% de veneno, paralisia ou sono'],
    'poison-touch': [3, 'os golpes físicos dele têm 30% de envenenar'], 'synchronize': [2, 'passa a queimadura, a paralisia ou o veneno a quem lhos causou'],
    'early-bird': [2, 'acorda duas vezes mais depressa'], 'steadfast': [2, 'quando recua: Velocidade +1'],
    'tangled-feet': [2, 'confuso, o adversário acerta metade das vezes'], 'stench': [2, 'os golpes dele têm 10% de fazer recuar'],
    'prankster': [5, 'golpes de estado com prioridade +1 (mas não afetam Pokémon Sombrio)'],
    'magic-bounce': [5, 'devolve os golpes de estado do adversário'], 'good-as-gold': [5, 'imune aos golpes de estado do adversário'],
    'heavy-metal': [1, 'pesa o dobro (Heavy Slam mais forte; Low Kick recebido também)'], 'light-metal': [1, 'pesa metade'],
    'merciless': [3, 'golpes contra envenenados são sempre críticos'],
    'aftermath': [2, 'derrubado por golpe físico: o atacante perde 1/4 do HP'], 'innards-out': [3, 'ao ser derrubado, fere o atacante com o HP que tinha']
  };
  var HD = window.HABILIDADES_DADOS || { h: [], a: {} };
  var NOME_HAB = {}; HD.h.forEach(function (h) { NOME_HAB[h[0]] = h[1]; });
  function habsDe(p) {
    var l = HD.a[p.id];
    if (!l) { var b = LISTA.find(function (x) { return x.esp === p.esp && x.padrao; }); l = b && HD.a[b.id]; }
    return (l || []).map(function (x) { var h = HD.h[x < 0 ? -x - 1 : x]; return { slug: h[0], nome: h[1], oculta: x < 0 }; });
  }
  function valorHab(slug) { return HAB_INFO[slug] ? HAB_INFO[slug][0] : 0; }
  function habAuto(p) {
    var l = habsDe(p), melhor = 0;
    l.forEach(function (h, i) { if (valorHab(h.slug) > valorHab(l[melhor].slug)) { melhor = i; } });
    return melhor;
  }
  /* ao evoluir, a habilidade fica na mesma posição (a oculta passa para a oculta) */
  function habEvolucao(nova, antiga) {
    var l = habsDe(nova); if (!l.length) { return ''; }
    var mesma = l.find(function (h) { return h.slug === antiga.slug; });
    if (mesma) { return mesma.slug; }
    var normais = l.filter(function (h) { return !h.oculta; }), oc = l.find(function (h) { return h.oculta; });
    return (antiga.oculta && oc ? oc : normais[Math.min(antiga.pos || 0, normais.length - 1)] || l[0]).slug;
  }
  function hab(m) { return (m && m.hab) || ''; }
  function nomeHab(slug) { return NOME_HAB[slug] || slug; }
  var INQUEBRAVEL = { 'shadow-shield': 1, 'prism-armor': 1, 'full-metal-body': 1 };
  function quebra(a) { var h = hab(a); return h === 'mold-breaker' || h === 'teravolt' || h === 'turboblaze' || (a && a.golpeAtual === 'quebra'); }
  /* a habilidade do alvo, a não ser que o atacante a ignore (Mold Breaker) */
  function habAlvo(a, d) { var h = hab(d); return quebra(a) && !INQUEBRAVEL[h] ? '' : h; }
  var PELE = { pixilate: 'fairy', refrigerate: 'ice', aerilate: 'flying', galvanize: 'electric' };
  var APERTO = { blaze: 'fire', torrent: 'water', overgrow: 'grass', swarm: 'bug' };
  var TIPO_FORTE = { steelworker: ['steel', 1.5], 'steely-spirit': ['steel', 1.5], 'dragons-maw': ['dragon', 1.5], transistor: ['electric', 1.3], 'rocky-payload': ['rock', 1.5], 'water-bubble': ['water', 2] };
  var ABSORVE = { 'flash-fire': 'fire', 'well-baked-body': 'fire', 'water-absorb': 'water', 'storm-drain': 'water', 'dry-skin': 'water',
    'volt-absorb': 'electric', 'lightning-rod': 'electric', 'motor-drive': 'electric', 'sap-sipper': 'grass', 'earth-eater': 'ground', levitate: 'ground' };
  var SEM_BAIXAS = { 'clear-body': 1, 'white-smoke': 1, 'full-metal-body': 1 };
  var SEM_INTIMIDAR = { 'inner-focus': 1, oblivious: 1, 'own-tempo': 1, scrappy: 1 };
  var NAO_COPIA = { trace: 1, 'as-one-glastrier': 1, 'as-one-spectrier': 1, disguise: 1, 'ice-face': 1, 'wonder-guard': 1 };
  var SOM = /\b(hyper voice|boomburst|bug buzz|snarl|echoed voice|uproar|disarming voice|clanging scales|overdrive|relic song|chatter|sparkling aria|torch song|psychic noise|alluring voice|round)\b/i;
  var SOCO = /punch|hammer arm|meteor mash|uppercut|ice hammer|iron bash|wicked blow|surging strikes|rage fist|headlong rush/i;
  var MORDIDA = /bite|fang|crunch|jaw lock|fishious/i, PULSO = /pulse|aura sphere/i;
  var CORTE = /slash|cut|blade|razor|sword|scissor|cleave|stone axe|ceaseless edge|kowtow/i;
  var BOMBA = /ball|bomb|bullet|focus blast|pollen puff|beak blast|octazooka|zap cannon|aura sphere/i;
  function secundario(g) { return !!((g.ef && g.ef[1] < 100) || g.st || g.fl); }

  /* ---------- estados: queimadura, paralisia, veneno (e tóxico), sono, congelamento; confusão e recuo ---------- */
  var NOME_EST = { brn: '🔥 Queimado', par: '⚡ Paralisado', psn: '☠️ Envenenado', tox: '☠️ Tóxico', slp: '💤 A dormir', frz: '❄️ Congelado' };
  var CURTO_EST = { brn: 'QUE', par: 'PAR', psn: 'ENV', tox: 'TÓX', slp: 'DOR', frz: 'GEL' };
  var TXT_EST = { brn: ' ficou queimado!', par: ' ficou paralisado!', psn: ' ficou envenenado!', tox: ' ficou gravemente envenenado!', slp: ' adormeceu!', frz: ' ficou congelado!' };
  var VERBO_EST = { brn: 'queimar', par: 'paralisar', psn: 'envenenar', tox: 'envenenar gravemente', slp: 'adormecer', frz: 'congelar', conf: 'confundir',
    tri: 'queimar, paralisar ou congelar', dire: 'envenenar, paralisar ou adormecer' };
  var AUTO_GOLPE = { c: 'F', pw: 40, nome: '', t: 'normal', semTipo: true, esp: '' };
  function envenenado(m) { return m.estado === 'psn' || m.estado === 'tox'; }
  /* pode m apanhar este estado? (tipos, habilidades, terrenos e clima) */
  function podeTerEstado(m, est, fonte) {
    if (!m || m.hp <= 0) { return false; }
    var h = fonte && quebra(fonte) && !INQUEBRAVEL[hab(m)] ? '' : hab(m), t = tiposDe(m), tr = terreno(m), cl = clima(m);
    if (tr === 'nevoa' && noChao(m)) { return false; }
    if (est === 'conf') { return !(m.conf > 0) && h !== 'own-tempo'; }
    if (m.estado || h === 'purifying-salt' || (h === 'leaf-guard' && cl === 'sol')) { return false; }
    if (est === 'brn') { return t.indexOf('fire') < 0 && h !== 'water-veil' && h !== 'water-bubble' && h !== 'thermal-exchange'; }
    if (est === 'par') { return t.indexOf('electric') < 0 && h !== 'limber'; }
    if (est === 'psn' || est === 'tox') { return t.indexOf('poison') < 0 && t.indexOf('steel') < 0 && h !== 'immunity' && h !== 'pastel-veil'; }
    if (est === 'slp') { return h !== 'insomnia' && h !== 'vital-spirit' && h !== 'sweet-veil' && !(tr === 'eletrico' && noChao(m)); }
    if (est === 'frz') { return t.indexOf('ice') < 0 && h !== 'magma-armor' && cl !== 'sol'; }
    return false;
  }
  function aplicarEstado(m, est, fonte, P) {
    if (!podeTerEstado(m, est, fonte)) { return false; }
    var nome = `<b>${esc(m.p.nome)}</b>`;
    if (est === 'conf') { m.conf = 2 + Math.floor(rng() * 4); P.push({ tipo: 'txt', txt: nome + ' ficou confuso!' }); return true; }
    m.estado = est;
    if (est === 'slp') { m.sono = 2 + Math.floor(rng() * 3); }
    if (est === 'tox') { m.toxN = 0; }
    P.push({ tipo: 'txt', txt: nome + TXT_EST[est] });
    // Synchronize: passa o estado a quem o causou
    if (fonte && hab(m) === 'synchronize' && (est === 'brn' || est === 'par' || est === 'psn' || est === 'tox') && podeTerEstado(fonte, est, null)) { anunciar(m, P); aplicarEstado(fonte, est, null, P); }
    return true;
  }
  /* antes de atacar: sono, congelamento, recuo, confusão e paralisia; devolve false se não ataca */
  function antesDeAgir(a, P) {
    var nome = `<b>${esc(a.p.nome)}</b>`;
    if (a.estado === 'slp') {
      a.sono -= hab(a) === 'early-bird' ? 2 : 1;
      if (a.sono > 0) { P.push({ tipo: 'txt', txt: nome + ' está a dormir.' }); a.preso = null; return false; }
      a.estado = null; a.sono = 0; P.push({ tipo: 'txt', txt: nome + ' acordou!' });
    }
    if (a.estado === 'frz') {
      if (rng() < 0.2) { a.estado = null; P.push({ tipo: 'txt', txt: nome + ' descongelou!' }); }
      else { P.push({ tipo: 'txt', txt: nome + ' está congelado!' }); a.preso = null; return false; }
    }
    if (a.recuar) {
      a.recuar = false; P.push({ tipo: 'txt', txt: nome + ' recuou e não atacou!' }); a.preso = null;
      if (hab(a) === 'steadfast') { anunciar(a, P); alterar(a, 'spe', 1, null, P); }
      return false;
    }
    if (a.conf > 0) {
      a.conf--;
      if (a.conf === 0) { P.push({ tipo: 'txt', txt: nome + ' deixou de estar confuso.' }); }
      else {
        P.push({ tipo: 'txt', txt: nome + ' está confuso...' });
        if (rng() < 1 / 3) {
          var x = Math.min(a.hp, Math.max(1, Math.floor(danoBase(a, a, AUTO_GOLPE, false) * (0.85 + rng() * 0.15))));
          a.hp -= x; P.push({ tipo: 'hp', m: a, d: -x, txt: nome + ' magoou-se na confusão e perdeu ' + x + ' HP.' }); a.preso = null;
          return false;
        }
      }
    }
    if (a.estado === 'par' && rng() < 0.25) { P.push({ tipo: 'txt', txt: nome + ' está paralisado e não se consegue mexer!' }); a.preso = null; return false; }
    return true;
  }
  /* perder HP com direito a desmaiar (queimadura, veneno) */
  function perderHp(m, x, txt, P) { x = Math.min(x, m.hp); if (x <= 0) { return; } m.hp -= x; P.push({ tipo: 'hp', m: m, d: -x, txt: txt.replace('{x}', x) }); }
  /* fim do turno: Shed Skin/Hydration, dano da queimadura e do veneno (Poison Heal cura) */
  function fimTurnoEstado(B, lados) {
    var P = [];
    lados.forEach(function (l) {
      var m = ativo(B[l]), h = hab(m), nome = `<b>${esc(m.p.nome)}</b>`;
      m.recuar = false;
      if (m.hp > 0 && m.provocado > 0) { m.provocado--; if (!m.provocado) { P.push({ tipo: 'txt', txt: nome + ' já não está provocado.' }); } }
      if (m.hp > 0 && m.semente && h !== 'magic-guard') {
        var x = Math.min(m.hp, Math.max(1, Math.floor(m.hpMax / 8))), o = ativo(B[l === 'j' ? 'o' : 'j']);
        perderHp(m, x, nome + ' perdeu {x} HP para a semente.', P);
        if (o.hp > 0) { if (h === 'liquid-ooze') { mexerHp(o, -x, `<b>${esc(o.p.nome)}</b> absorveu lodo e perdeu {x} HP.`, P); } else { mexerHp(o, x, `<b>${esc(o.p.nome)}</b> recuperou {x} HP.`, P); } }
      }
      if (m.hp <= 0 || !m.estado) { return; }
      if ((h === 'shed-skin' && rng() < 1 / 3) || (h === 'hydration' && clima(m) === 'chuva')) { anunciar(m, P); m.estado = null; m.sono = 0; P.push({ tipo: 'txt', txt: nome + ' curou-se.' }); return; }
      if (h === 'magic-guard') { return; }
      if (m.estado === 'brn') { perderHp(m, Math.max(1, Math.floor(m.hpMax / (h === 'heatproof' ? 32 : 16))), nome + ' sofreu {x} da queimadura.', P); }
      if (envenenado(m)) {
        if (h === 'poison-heal') { if (m.hp < m.hpMax) { anunciar(m, P); mexerHp(m, Math.max(1, Math.floor(m.hpMax / 8)), nome + ' recuperou {x} HP.', P); } }
        else if (m.estado === 'psn') { perderHp(m, Math.max(1, Math.floor(m.hpMax / 8)), nome + ' sofreu {x} do veneno.', P); }
        else { m.toxN = Math.min(15, (m.toxN || 0) + 1); perderHp(m, Math.max(1, Math.floor(m.hpMax * m.toxN / 16)), nome + ' sofreu {x} do veneno.', P); }
      }
    });
    return P;
  }

  /* ---------- clima: sol, chuva, areia e neve, 5 turnos (B.campo, partilhado pelos lutadores dos dois lados) ---------- */
  var CLIMA_DE = { drought: 'sol', 'orichalcum-pulse': 'sol', drizzle: 'chuva', 'sand-stream': 'areia', 'snow-warning': 'neve' };
  var NOME_CLIMA = { sol: '☀️ Sol forte', chuva: '🌧️ Chuva', areia: '🌪️ Tempestade de areia', neve: '❄️ Neve' };
  var TXT_CLIMA = { sol: 'O sol ficou forte!', chuva: 'Começou a chover!', areia: 'Levantou-se uma tempestade de areia!', neve: 'Começou a nevar!' };
  var FIM_CLIMA = { sol: 'O sol voltou ao normal.', chuva: 'A chuva parou.', areia: 'A tempestade de areia acalmou.', neve: 'Parou de nevar.' };
  var CORRE = { 'swift-swim': 'chuva', chlorophyll: 'sol', 'sand-rush': 'areia', 'slush-rush': 'neve' };
  var BOLA = { sol: 'fire', chuva: 'water', areia: 'rock', neve: 'ice' };
  var TEMPESTADE = /^(Thunder|Hurricane|Bleakwind Storm|Wildbolt Storm|Sandsear Storm)$/;
  function ligarCampo(B, c) {
    var tl = function (x) { return { reflect: (x && x.reflect) || 0, luz: (x && x.luz) || 0, veu: (x && x.veu) || 0 }; };
    B.campo = { clima: (c && c.clima) || null, turnos: (c && c.turnos) || 0, terreno: (c && c.terreno) || null, tturnos: (c && c.tturnos) || 0,
      tela: { j: tl(c && c.tela && c.tela.j), o: tl(c && c.tela && c.tela.o) }, B: B, arrastado: {} };
    var rk = function (x) { return { rochas: (x && x.rochas) || 0, picos: (x && x.picos) || 0, toxicos: (x && x.toxicos) || 0, teia: (x && x.teia) || 0 }; };
    B.campo.risco = { j: rk(c && c.risco && c.risco.j), o: rk(c && c.risco && c.risco.o) };
    ['j', 'o'].forEach(function (l) { B[l].time.forEach(function (m) { m.campo = B.campo; }); });
    return B;
  }
  /* clima em vigor para m ('' se não há, ou se Cloud Nine / Air Lock está em campo) */
  function clima(m) {
    var c = m && m.campo; if (!c || !c.clima) { return ''; }
    var B = c.B;
    if (B && ['j', 'o'].some(function (l) { var x = ativo(B[l]), h = hab(x); return x.hp > 0 && (h === 'cloud-nine' || h === 'air-lock'); })) { return ''; }
    return c.clima;
  }
  /* ---------- terrenos: Elétrico, Planta, Psíquico e Névoa, 5 turnos; só afetam quem está no chão ---------- */
  var TERRENO_DE = { 'electric-surge': 'eletrico', 'hadron-engine': 'eletrico', 'grassy-surge': 'planta', 'psychic-surge': 'psiquico', 'misty-surge': 'nevoa' };
  var NOME_TERRENO = { eletrico: '⚡ Terreno Elétrico', planta: '🌿 Terreno de Planta', psiquico: '🔮 Terreno Psíquico', nevoa: '🌸 Terreno de Névoa' };
  var TXT_TERRENO = { eletrico: 'Uma corrente elétrica percorre o campo!', planta: 'A relva cresceu por todo o campo!', psiquico: 'O campo ficou estranho!', nevoa: 'Uma névoa cobriu o campo!' };
  var FIM_TERRENO = { eletrico: 'A corrente elétrica desapareceu.', planta: 'A relva desapareceu.', psiquico: 'O campo voltou ao normal.', nevoa: 'A névoa desapareceu.' };
  var TIPO_TERRENO = { eletrico: 'electric', planta: 'grass', psiquico: 'psychic', nevoa: 'fairy' };
  function terreno(m) { return (m && m.campo && m.campo.terreno) || ''; }
  /* tipos em campo (Mimicry muda para o tipo do terreno) */
  function tiposDe(m) { return hab(m) === 'mimicry' && terreno(m) ? [TIPO_TERRENO[terreno(m)]] : m.p.t; }
  function noChao(m) { return tiposDe(m).indexOf('flying') < 0 && hab(m) !== 'levitate'; }
  function mudarTerreno(m, tipo, P) {
    var c = m.campo; if (!c || c.terreno === tipo) { return false; }
    c.terreno = tipo; c.tturnos = 5; P.push({ tipo: 'txt', txt: TXT_TERRENO[tipo] }); return true;
  }
  function multTerreno(a, d, g, t) {
    var tr = terreno(a), m = 1; if (!tr || g.semTipo) { return m; }
    if (noChao(a) && ((tr === 'eletrico' && t === 'electric') || (tr === 'planta' && t === 'grass') || (tr === 'psiquico' && t === 'psychic'))) { m *= 1.3; }
    if (tr === 'planta' && noChao(d) && (g.nome === 'Earthquake' || g.nome === 'Bulldoze')) { m *= 0.5; }
    if (tr === 'nevoa' && noChao(d) && t === 'dragon') { m *= 0.5; }
    if (tr === 'eletrico' && g.nome === 'Psyblade') { m *= 1.5; }
    return m;
  }
  /* fim do turno: o terreno de Planta cura quem está no chão; contagem dos turnos */
  function fimTurnoTerreno(B, lados) {
    var P = [], c = B.campo; if (!c || !c.terreno) { return P; }
    if (c.terreno === 'planta') {
      lados.forEach(function (l) { var m = ativo(B[l]); if (m.hp > 0 && m.hp < m.hpMax && noChao(m)) { mexerHp(m, Math.max(1, Math.floor(m.hpMax / 16)), `<b>${esc(m.p.nome)}</b> recuperou {x} HP com a relva.`, P); } });
    }
    c.tturnos--;
    if (c.tturnos <= 0) { P.push({ tipo: 'txt', txt: FIM_TERRENO[c.terreno] }); c.terreno = null; c.tturnos = 0; }
    return P;
  }
  function mudarClima(m, tipo, P) {
    var c = m.campo; if (!c || c.clima === tipo) { return false; }
    c.clima = tipo; c.turnos = 5; P.push({ tipo: 'txt', txt: TXT_CLIMA[tipo] }); return true;
  }
  function multClima(a, g, t) {
    var c = clima(a), m = 1;
    if (c === 'sol') { m *= t === 'fire' ? 1.5 : t === 'water' ? 0.5 : 1; }
    if (c === 'chuva') { m *= t === 'water' ? 1.5 : t === 'fire' ? 0.5 : 1; }
    if (c === 'areia' && hab(a) === 'sand-force' && (t === 'rock' || t === 'ground' || t === 'steel')) { m *= 1.3; }
    return m;
  }
  function melhorAtr(m) { return ['atk', 'def', 'spa', 'spd', 'spe'].reduce(function (x, y) { return m.st[y] > m.st[x] ? y : x; }, 'atk'); }
  function imuneAreia(m) {
    var h = hab(m);
    return tiposDe(m).some(function (t) { return t === 'rock' || t === 'ground' || t === 'steel'; }) || h === 'sand-veil' || h === 'sand-rush' || h === 'sand-force' || h === 'overcoat' || h === 'magic-guard';
  }
  /* fim do turno: dano e cura do clima, pela ordem dos lados, e contagem dos turnos */
  function fimTurnoClima(B, lados) {
    var P = [], c = B.campo; if (!c || !c.clima) { return P; }
    var cl = clima(ativo(B.j));
    if (cl) {
      lados.forEach(function (l) {
        var m = ativo(B[l]), h = hab(m), nome = `<b>${esc(m.p.nome)}</b>`;
        if (m.hp <= 0) { return; }
        if (cl === 'areia' && !imuneAreia(m)) { mexerHp(m, -Math.max(1, Math.floor(m.hpMax / 16)), nome + ' foi atingido pela areia e perdeu {x} HP.', P); }
        if (((cl === 'chuva' && h === 'rain-dish') || (cl === 'neve' && h === 'ice-body')) && m.hp < m.hpMax) { anunciar(m, P); mexerHp(m, Math.max(1, Math.floor(m.hpMax / 16)), nome + ' recuperou {x} HP.', P); }
        if (h === 'dry-skin' && cl === 'chuva' && m.hp < m.hpMax) { anunciar(m, P); mexerHp(m, Math.max(1, Math.floor(m.hpMax / 8)), nome + ' recuperou {x} HP.', P); }
        if ((h === 'dry-skin' || h === 'solar-power') && cl === 'sol' && m.hp > 1) { anunciar(m, P); mexerHp(m, -Math.max(1, Math.floor(m.hpMax / 8)), nome + ' perdeu {x} HP com o sol.', P); }
      });
    }
    c.turnos--;
    if (c.turnos <= 0) { P.push({ tipo: 'txt', txt: FIM_CLIMA[c.clima] }); c.clima = null; c.turnos = 0; }
    return P;
  }

  /* ---------- lutador ---------- */
  function zeroEst() { return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }; }
  /* cfg (opcional): { nat: índice da nature, hab: posição da habilidade na lista do Pokémon } */
  function lutador(id, ids, item, cfg) {
    cfg = cfg || {};
    var p = P[id], nv = nivelDe(p), gs = golpesDe(p, ids);
    var nat = NATURES[cfg.nat] ? cfg.nat : natAuto(p, gs), hl = habsDe(p), hp = hl[cfg.hab] ? cfg.hab : habAuto(p);
    var st = statusDe(p.b, nv, nat), h = hl[hp] ? hl[hp].slug : '';
    return { p: p, nv: nv, nat: nat, st: st, hpMax: st.hp, hp: st.hp, golpes: gs, pp: gs.map(function (g) { return g.pp || 10; }), est: zeroEst(),
      item: item || null, preso: null, descansa: false, turnos: 0, hab: h, habBase: h, habPos: hp, novo: false, flash: false, disfarce: false, usouEntrada: false,
      estado: null, sono: 0, toxN: 0, conf: 0, recuar: false };
  }
  /* extra: { [id]: { nat, hab } } */
  function novoLado(ids, mv, itens, extra) { return { time: ids.map(function (id) { return lutador(id, mv && mv[id], itens && itens[id], extra && extra[id]); }), ativo: 0 }; }
  function ativo(l) { return l.time[l.ativo]; }
  function vivos(l) { return l.time.filter(function (m) { return m.hp > 0; }); }

  /* ---------- estágios de atributos (-6 a +6) ---------- */
  var NOME_ATR = { atk: 'Ataque', def: 'Defesa', spa: 'Atq. Esp.', spd: 'Def. Esp.', spe: 'Velocidade' };
  var CURTO_ATR = { atk: 'ATQ', def: 'DEF', spa: 'A.ESP', spd: 'D.ESP', spe: 'VEL' };
  function multEst(s) { return s >= 0 ? (2 + s) / 2 : 2 / (2 - s); }
  function lentoAtivo(m) { return hab(m) === 'slow-start' && m.turnos < 5; }
  /* crítico ignora as baixas de quem ataca e as subidas de quem defende; Unaware do outro ignora todos os estágios */
  var RUINA = { atk: 'tablets-of-ruin', spa: 'vessel-of-ruin', def: 'sword-of-ruin', spd: 'beads-of-ruin' };
  function atributo(m, k, crit, atacando, outro, semEst) {
    var s = m.est && !semEst ? m.est[k] : 0, h = hab(m);
    if (crit && ((atacando && s < 0) || (!atacando && s > 0))) { s = 0; }
    if (outro && hab(outro) === 'unaware') { s = 0; }
    var v = m.st[k] * multEst(s);
    if ((k === 'atk' || k === 'spe') && lentoAtivo(m)) { v *= 0.5; }
    var cl = clima(m);
    if (cl) {
      if (k === 'spe' && CORRE[h] === cl) { v *= 2; }
      if (!atacando && k === 'def' && cl === 'neve' && tiposDe(m).indexOf('ice') >= 0) { v *= 1.5; }
      if (!atacando && k === 'spd' && cl === 'areia' && tiposDe(m).indexOf('rock') >= 0) { v *= 1.5; }
      if (cl === 'sol' && h === 'flower-gift' && ((atacando && k === 'atk') || (!atacando && k === 'spd'))) { v *= 1.5; }
      if (cl === 'sol' && atacando && k === 'spa' && h === 'solar-power') { v *= 1.5; }
      if (cl === 'sol' && h === 'protosynthesis' && melhorAtr(m) === k) { v *= k === 'spe' ? 1.5 : 1.3; }
    }
    var tr = terreno(m);
    if (tr === 'eletrico') {
      if (h === 'quark-drive' && melhorAtr(m) === k) { v *= k === 'spe' ? 1.5 : 1.3; }
      if (h === 'surge-surfer' && k === 'spe') { v *= 2; }
    }
    if (tr === 'planta' && h === 'grass-pelt' && !atacando && k === 'def') { v *= 1.5; }
    if (k === 'spe' && m.estado === 'par' && h !== 'quick-feet') { v *= 0.5; }
    if (m.estado) {
      if (k === 'spe' && h === 'quick-feet') { v *= 1.5; }
      if (atacando && k === 'atk' && (h === 'guts' || (h === 'toxic-boost' && envenenado(m)))) { v *= 1.5; }
      if (atacando && k === 'spa' && h === 'flare-boost' && m.estado === 'brn') { v *= 1.5; }
      if (!atacando && k === 'def' && h === 'marvel-scale') { v *= 1.5; }
    }
    if (atacando) {
      if (k === 'atk' && (h === 'huge-power' || h === 'pure-power')) { v *= 2; }
      if (k === 'atk' && h === 'hustle') { v *= 1.5; }
      if ((k === 'atk' && h === 'orichalcum-pulse' && cl === 'sol') || (k === 'spa' && h === 'hadron-engine' && tr === 'eletrico')) { v *= 4 / 3; }
      if (h === 'defeatist' && m.hp * 2 < m.hpMax) { v *= 0.5; }
    }
    if (outro && RUINA[k] && hab(outro) === RUINA[k] && h !== RUINA[k]) { v *= 0.75; }
    return v;
  }
  function velocidade(m) { return atributo(m, 'spe'); }
  function mudarEst(m, k, d) { var antes = m.est[k]; m.est[k] = Math.max(-6, Math.min(6, antes + d)); return m.est[k] - antes; }
  /* passos (P): o que aconteceu, pela ordem, para a batalha mostrar ({tipo:'hab'|'est'|'hp'|'txt', m, ...}) */
  function anunciar(m, P) { P.push({ tipo: 'hab', m: m, nome: nomeHab(hab(m)) }); }
  /* muda um atributo passando pelas habilidades; fonte = adversário que causou a mudança (null = o próprio) */
  function alterar(m, k, n, fonte, P) {
    var h = fonte && quebra(fonte) && !INQUEBRAVEL[hab(m)] ? '' : hab(m);
    if (h === 'contrary') { n = -n; }
    if (h === 'simple') { n *= 2; }
    if (fonte && n < 0) {
      if (SEM_BAIXAS[h] || (h === 'hyper-cutter' && k === 'atk') || (h === 'big-pecks' && k === 'def')) {
        anunciar(m, P); P.push({ tipo: 'txt', txt: `${NOME_ATR[k]} de <b>${esc(m.p.nome)}</b> não baixou.` }); return;
      }
      if (h === 'mirror-armor') { anunciar(m, P); alterar(fonte, k, n, null, P); return; }
    }
    var dd = mudarEst(m, k, n);
    P.push({ tipo: 'est', m: m, k: k, d: dd, pedido: n });
    if (fonte && n < 0 && dd < 0 && (h === 'defiant' || h === 'competitive')) {
      anunciar(m, P); var k2 = h === 'defiant' ? 'atk' : 'spa';
      P.push({ tipo: 'est', m: m, k: k2, d: mudarEst(m, k2, 2), pedido: 2 });
    }
  }
  /* perder ou ganhar HP fora dos golpes (nunca desmaia por isto) */
  function mexerHp(m, x, txt, P) {
    x = x < 0 ? -Math.min(-x, m.hp - 1) : Math.min(x, m.hpMax - m.hp);
    if (!x) { return 0; }
    m.hp += x; P.push({ tipo: 'hp', m: m, d: x, txt: txt.replace('{x}', Math.abs(x)) }); return x;
  }
  /* ao entrar em campo: Intimidate, Download, Intrepid Sword, Trace... */
  function aoEntrar(m, foe, P) {
    var h = hab(m);
    if (m.hp <= 0) { return P; }
    aplicarRiscos(m, foe, P);
    if (h === 'trace' && foe && foe.hp > 0 && hab(foe) && !NAO_COPIA[hab(foe)]) {
      anunciar(m, P); m.hab = hab(foe); P.push({ tipo: 'txt', txt: `<b>${esc(m.p.nome)}</b> copiou ${esc(nomeHab(m.hab))}!` }); h = m.hab;
    }
    if (CLIMA_DE[h] && m.campo && m.campo.clima !== CLIMA_DE[h]) { anunciar(m, P); mudarClima(m, CLIMA_DE[h], P); }
    if (TERRENO_DE[h] && m.campo && m.campo.terreno !== TERRENO_DE[h]) { anunciar(m, P); mudarTerreno(m, TERRENO_DE[h], P); }
    if (h === 'mimicry' && terreno(m)) { anunciar(m, P); P.push({ tipo: 'txt', txt: `<b>${esc(m.p.nome)}</b> passou a ser do tipo ${nomeTipo(TIPO_TERRENO[terreno(m)])}.` }); }
    if ((h === 'cloud-nine' || h === 'air-lock') && m.campo && m.campo.clima) { anunciar(m, P); P.push({ tipo: 'txt', txt: 'Os efeitos do clima desapareceram.' }); }
    if (h === 'intimidate' && foe && foe.hp > 0) {
      anunciar(m, P);
      var hf = hab(foe);
      if (SEM_INTIMIDAR[hf]) { anunciar(foe, P); P.push({ tipo: 'txt', txt: `<b>${esc(foe.p.nome)}</b> não se intimidou.` }); }
      else if (hf === 'guard-dog') { anunciar(foe, P); alterar(foe, 'atk', 1, null, P); }
      else { alterar(foe, 'atk', -1, m, P); }
    }
    if (h === 'download' && foe && foe.hp > 0) { anunciar(m, P); alterar(m, atributo(foe, 'def') < atributo(foe, 'spd') ? 'atk' : 'spa', 1, null, P); }
    if ((h === 'intrepid-sword' || h === 'dauntless-shield') && !m.usouEntrada) { m.usouEntrada = true; anunciar(m, P); alterar(m, h === 'intrepid-sword' ? 'atk' : 'def', 1, null, P); }
    return P;
  }
  /* ao sair de campo, estágios, fúria e contadores voltam ao normal; Regenerator recupera 1/3 */
  function sairDeCampo(m, P) {
    if (m.hp > 0 && hab(m) === 'regenerator') { mexerHp(m, Math.floor(m.hpMax / 3), `<b>${esc(m.p.nome)}</b> regenerou {x} HP.`, P || []); }
    if (m.hp > 0 && m.estado && hab(m) === 'natural-cure') { m.estado = null; m.sono = 0; }
    m.est = zeroEst(); m.preso = null; m.descansa = false; m.turnos = 0; m.flash = false; m.novo = true; m.hab = m.habBase || m.hab;
    m.conf = 0; m.recuar = false; m.toxN = 0; m.semente = false; m.provocado = 0; m.usos = 0; m.sub = 0; m.protUsos = 0; m.protegido = null; m.aguentar = false; m.recebido = null;
  }

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
    m.base = m.p; m.forma = op.tipo; m.p = op.p; m.st = statusDe(op.p.b, m.nv, m.nat); m.hpMax = m.st.hp; m.golpesBase = m.golpes;
    // a Mega ganha a habilidade da forma nova (ex.: Mega Charizard X fica com Tough Claws)
    if (op.tipo === 'mega') { var hm = habsDe(op.p); if (hm.length) { m.hab = m.habBase = hm[0].slug; } }
    if (op.tipo === 'gmax') {
      m.hpMax = Math.round(m.hpMax * 1.5); m.gmax = 3; m.preso = null;
      m.golpes = m.golpesBase.map(function (g) { return g.c === 'S' ? g : { t: g.t, c: g.c, nome: 'Max ' + nomeTipo(g.t), pw: poderMax(g), ac: 0, pr: 0, pp: g.pp, max: true }; });
    }
    m.hp = Math.max(1, Math.round(razao * m.hpMax));
  }
  function desfazerGmax(m) {
    var razao = m.hp / m.hpMax, p = m.base;
    m.p = p; m.st = statusDe(p.b, m.nv, m.nat); m.hpMax = m.st.hp; m.golpes = m.golpesBase || golpesDe(p); m.golpesBase = null; m.gmax = 0; m.base = null; m.forma = null;
    m.hp = m.hp <= 0 ? 0 : Math.max(1, Math.round(razao * m.hpMax));
  }
  function rotuloForma(op) {
    if (op.tipo === 'gmax') { return '🔴 Gigantamax'; }
    var sufixo = op.p.nome.split(' Mega')[1] || '';
    return '💎 Mega Evoluir' + (sufixo.trim() ? ' ' + sufixo.trim() : '');
  }

  /* ---------- dano ---------- */
  function efTotal(tipo, alvo) { return K.efTotal(tipo, alvo.t); }
  var PODER_VAR = { 'giro-bola': 1, 'electro-bola': 1, 'peso-alvo': 1, 'peso-razao': 1, reversal: 1, 'hp-alvo': 1, subidas: 1, castigo: 1 };
  function pesoDe(m) { var k = m.p.peso || 50; return hab(m) === 'heavy-metal' ? k * 2 : hab(m) === 'light-metal' ? k / 2 : k; }
  function poderDe(a, g, d) {
    var e = g.esp;
    if (d && e === 'giro-bola') { return Math.min(150, Math.floor(25 * velocidade(d) / Math.max(1, velocidade(a))) + 1); }
    if (d && e === 'electro-bola') { var rz = velocidade(a) / Math.max(1, velocidade(d)); return rz >= 4 ? 150 : rz >= 3 ? 120 : rz >= 2 ? 80 : rz >= 1 ? 60 : 40; }
    if (d && e === 'peso-alvo') { var pk = pesoDe(d); return pk < 10 ? 20 : pk < 25 ? 40 : pk < 50 ? 60 : pk < 100 ? 80 : pk < 200 ? 100 : 120; }
    if (d && e === 'peso-razao') { var rp = pesoDe(a) / Math.max(0.1, pesoDe(d)); return rp >= 5 ? 120 : rp >= 4 ? 100 : rp >= 3 ? 80 : rp >= 2 ? 60 : 40; }
    if (e === 'reversal') { var q = Math.floor(48 * a.hp / a.hpMax); return q <= 1 ? 200 : q <= 4 ? 150 : q <= 9 ? 100 : q <= 16 ? 80 : q <= 32 ? 40 : 20; }
    if (d && e === 'hp-alvo') { return Math.max(1, Math.floor((g.nome === 'Hard Press' ? 100 : 120) * d.hp / d.hpMax)); }
    if (e === 'subidas') { return 20 + 20 * somaSubidas(a); }
    if (d && e === 'castigo') { return Math.min(200, 60 + 20 * somaSubidas(d)); }
    if (g.nome === 'Facade' && a.estado && a.estado !== 'slp' && a.estado !== 'frz') { return 140; }
    if (d && (g.nome === 'Hex' || g.nome === 'Infernal Parade') && d.estado) { return 130; }
    if (d && (g.nome === 'Venoshock' || g.nome === 'Barb Barrage') && envenenado(d)) { return 130; }
    return g.esp === 'hp' ? Math.max(1, Math.floor(150 * a.hp / a.hpMax)) : g.nome === 'Weather Ball' && clima(a) ? 100 : g.nome === 'Terrain Pulse' && terreno(a) && noChao(a) ? 100 : g.pw; }
  /* tipo do golpe depois das habilidades (Pixilate, Liquid Voice...) */
  function tipoDe(a, g) {
    if (g.semTipo || g.max) { return g.t; }
    var h = hab(a);
    if (g.nome === 'Weather Ball' && clima(a)) { return BOLA[clima(a)]; }
    if (g.nome === 'Terrain Pulse' && terreno(a) && noChao(a)) { return TIPO_TERRENO[terreno(a)]; }
    if (PELE[h] && g.t === 'normal') { return PELE[h]; }
    if (h === 'liquid-voice' && SOM.test(g.nome)) { return 'water'; }
    return g.t;
  }
  function efetividade(a, d, g, t) {
    if (g.semTipo) { return 1; }
    var tipos = tiposDe(d);
    if (hab(a) === 'scrappy' && (t === 'normal' || t === 'fighting')) { tipos = tipos.filter(function (x) { return x !== 'ghost'; }); }
    return K.efTotal(t, tipos);
  }
  function stabDe(a, g, t) {
    if (g.semTipo) { return 1; }
    var h = hab(a);
    if (tiposDe(a).indexOf(t) < 0 && h !== 'protean' && h !== 'libero') { return 1; }
    return h === 'adaptability' ? 2 : 1.5;
  }
  function prioGolpe(m, g) {
    var h = hab(m), t = tipoDe(m, g);
    return (g.pr || 0) + (h === 'prankster' && g.c === 'S' ? 1 : 0) + (g.nome === 'Grassy Glide' && terreno(m) === 'planta' && noChao(m) ? 1 : 0) + (h === 'gale-wings' && t === 'flying' && m.hp === m.hpMax ? 1 : 0) + (h === 'triage' && g.dr > 0 ? 3 : 0);
  }
  /* imunidades por habilidade: devolve a habilidade que bloqueou */
  function bloqueio(a, d, g, t, e) {
    if (terreno(d) === 'psiquico' && noChao(d) && !g.luta && prioGolpe(a, g) > 0) { return 'terreno'; }
    var h = habAlvo(a, d);
    if (!h || g.luta) { return ''; }
    if (ABSORVE[h] === t) { return h; }
    if (h === 'wonder-guard' && !g.semTipo && e < 2) { return h; }
    if (h === 'bulletproof' && BOMBA.test(g.nome)) { return h; }
    if (h === 'soundproof' && SOM.test(g.nome)) { return h; }
    if ((h === 'dazzling' || h === 'queenly-majesty' || h === 'armor-tail') && prioGolpe(a, g) > 0) { return h; }
    return '';
  }
  /* multiplicadores das habilidades de quem ataca e de quem defende */
  function multHab(a, d, g, t, e, crit) {
    var h = hab(a), hd = habAlvo(a, d), m = 1;
    if (h === 'technician' && poderDe(a, g, d) <= 60) { m *= 1.5; }
    if (a.estado === 'brn' && g.c === 'F' && h !== 'guts' && g.nome !== 'Facade' && !g.semTipo) { m *= 0.5; }
    if (PELE[h] && g.t === 'normal' && !g.max) { m *= 1.2; }
    if (h === 'sheer-force' && secundario(g)) { m *= 1.3; }
    if (h === 'tough-claws' && g.c === 'F') { m *= 1.3; }
    if (h === 'iron-fist' && SOCO.test(g.nome)) { m *= 1.2; }
    if (h === 'strong-jaw' && MORDIDA.test(g.nome)) { m *= 1.5; }
    if (h === 'mega-launcher' && PULSO.test(g.nome)) { m *= 1.5; }
    if (h === 'sharpness' && CORTE.test(g.nome)) { m *= 1.5; }
    if (h === 'reckless' && g.dr < 0) { m *= 1.2; }
    if (h === 'punk-rock' && SOM.test(g.nome)) { m *= 1.3; }
    if (APERTO[h] === t && a.hp * 3 <= a.hpMax) { m *= 1.5; }
    if (TIPO_FORTE[h] && TIPO_FORTE[h][0] === t) { m *= TIPO_FORTE[h][1]; }
    if (h === 'flash-fire' && a.flash && t === 'fire') { m *= 1.5; }
    if (h === 'tinted-lens' && e > 0 && e < 1) { m *= 2; }
    if (h === 'neuroforce' && e >= 2) { m *= 1.25; }
    if (h === 'parental-bond' && !(g.hmax > 1) && !g.luta) { m *= 1.25; }
    if (h === 'sniper' && crit) { m *= 1.5; }
    if ((t === 'fairy' && (h === 'fairy-aura' || hab(d) === 'fairy-aura')) || (t === 'dark' && (h === 'dark-aura' || hab(d) === 'dark-aura'))) { m *= 4 / 3; }
    if (hd === 'thick-fat' && (t === 'fire' || t === 'ice')) { m *= 0.5; }
    if ((hd === 'heatproof' || hd === 'water-bubble') && t === 'fire') { m *= 0.5; }
    if (hd === 'dry-skin' && t === 'fire') { m *= 1.25; }
    if (hd === 'purifying-salt' && t === 'ghost') { m *= 0.5; }
    if (hd === 'fluffy') { m *= (g.c === 'F' ? 0.5 : 1) * (t === 'fire' ? 2 : 1); }
    if (hd === 'ice-scales' && g.c === 'E') { m *= 0.5; }
    if (hd === 'fur-coat' && g.c === 'F') { m *= 0.5; }
    if (hd === 'punk-rock' && SOM.test(g.nome)) { m *= 0.5; }
    if ((hd === 'multiscale' || hd === 'shadow-shield') && d.hp === d.hpMax) { m *= 0.5; }
    if ((hd === 'filter' || hd === 'solid-rock' || hd === 'prism-armor') && e >= 2) { m *= 0.75; }
    var tl = telaDe(d);
    if (tl && !crit && h !== 'infiltrator' && ((g.c === 'F' && (tl.reflect || tl.veu)) || (g.c === 'E' && (tl.luz || tl.veu)))) { m *= 0.5; }
    return m;
  }
  function danoBase(a, d, g, crit) {
    var A = atributo(a, g.esp === 'body-press' ? 'def' : g.c === 'F' ? 'atk' : 'spa', crit, true, d);
    if (g.esp === 'foul-play') { var sf = d.est ? d.est.atk : 0; if (crit && sf < 0) { sf = 0; } A = d.st.atk * multEst(sf); }
    var Df = atributo(d, g.c === 'F' || g.esp === 'psyshock' ? 'def' : 'spd', crit, false, a, g.esp === 'ignora-est');
    return Math.floor(Math.floor(Math.floor(2 * a.nv / 5 + 2) * poderDe(a, g, d) * A / Df) / 50) + 2;
  }
  function precisaoDe(a, d, g) {
    if (g.ac === 0 || hab(a) === 'no-guard' || hab(d) === 'no-guard') { return 0; }
    var h = hab(a), ac = g.ac, cl = clima(a), hd = habAlvo(a, d);
    if ((cl === 'chuva' && TEMPESTADE.test(g.nome)) || (cl === 'neve' && g.nome === 'Blizzard')) { return 0; }
    if (cl === 'sol' && (g.nome === 'Thunder' || g.nome === 'Hurricane')) { ac = 50; }
    if ((cl === 'areia' && hd === 'sand-veil') || (cl === 'neve' && hd === 'snow-cloak')) { ac *= 0.8; }
    if (h === 'compound-eyes') { ac *= 1.3; }
    if (h === 'victory-star') { ac *= 1.1; }
    if (h === 'hustle' && g.c === 'F') { ac *= 0.8; }
    if (hd === 'tangled-feet' && d.conf > 0) { ac *= 0.5; }
    return ac;
  }
  var CHANCE_CRIT = [1 / 24, 1 / 8, 1 / 2];
  /* Sucker Punch/Thunderclap só resultam se o alvo for usar um golpe de dano e ainda não agiu; Upper Hand, se for um golpe com prioridade */
  function respostaFalha(a, d, g) {
    var c = a.campo, ac = c && c.acoes && c.acoes[ladoM(d)];
    if (!ac || ac.tipo !== 'golpe' || d.agiu || d.hp <= 0) { return true; }
    if (!d.pp.some(function (x) { return x > 0; })) { return false; }
    var gd = d.golpes[d.preso ? d.preso.idx : ac.idx];
    if (!gd || gd.c === 'S') { return true; }
    return g.esp === 'mao' && !(prioGolpe(d, gd) > 0);
  }
  function calcular(a, d, g) {
    a.golpeAtual = g.esp || null;
    if (((g.esp === 'resposta' || g.esp === 'mao') && respostaFalha(a, d, g)) || (g.esp === 'primeiro' && (a.usos || 0) > 1)) {
      return { erro: true, falhou: true, dano: 0, ef: 1, crit: false, acertos: 0, t: g.t };
    }
    var t = tipoDe(a, g), e = efetividade(a, d, g, t), bloq = e === 0 ? '' : bloqueio(a, d, g, t, e);
    if (g.esp in DEVOLVE) {
      var fixo = danoDevolvido(a, g);
      if (!fixo) { return { erro: true, falhou: true, dano: 0, ef: e, crit: false, acertos: 0, t: t }; }
      if (e === 0 || bloq) { return { erro: false, dano: 0, ef: 0, crit: false, acertos: 0, t: t, bloq: bloq || '' }; }
      var rf = { erro: false, dano: fixo, ef: 1, crit: false, acertos: 1, t: t, fixo: true };
      if (d.aguentar && rf.dano >= d.hp) { rf.dano = d.hp - 1; rf.endure = true; }
      return rf;
    }
    if (bloq) { return { erro: false, dano: 0, ef: 0, crit: false, acertos: 0, t: t, bloq: bloq }; }
    var ac = precisaoDe(a, d, g);
    if (!(ac === 0 || rng() * 100 < ac)) { return { erro: true, dano: 0, ef: e, crit: false, acertos: 0, t: t }; }
    var stab = stabDe(a, g, t), nc = Math.min(2, (g.ca || 0) + (hab(a) === 'super-luck' ? 1 : 0));
    var crit = g.ca === 2 || rng() < CHANCE_CRIT[nc], variacao = 0.85 + rng() * 0.15;
    var hd = habAlvo(a, d);
    if (hab(a) === 'merciless' && envenenado(d)) { crit = true; }
    if (hd === 'battle-armor' || hd === 'shell-armor') { crit = false; }
    var acertos = 1;
    if (g.hmax > 1) {
      var r = rng();
      acertos = hab(a) === 'skill-link' ? g.hmax : g.hmin === 2 && g.hmax === 5 ? (r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5) : g.hmin + Math.floor(r * (g.hmax - g.hmin + 1));
    }
    var dano = e === 0 ? 0 : Math.max(1, Math.floor(danoBase(a, d, g, crit) * stab * e * (crit ? 1.5 : 1) * variacao * multHab(a, d, g, t, e, crit) * multClima(a, g, t) * multTerreno(a, d, g, t))) * acertos;
    var res = { erro: false, dano: dano, ef: e, crit: crit, acertos: acertos, t: t };
    // Disguise / Ice Face: o primeiro golpe não faz (quase) dano; Sturdy: aguenta com 1 HP
    if (dano > 0 && !d.disfarce && (hd === 'disguise' || (hd === 'ice-face' && g.c === 'F'))) {
      res.dano = hd === 'disguise' ? Math.min(d.hp, Math.max(1, Math.floor(d.hpMax / 8))) : 0; res.disfarce = hd;
    } else if (hd === 'sturdy' && d.hp === d.hpMax && dano >= d.hp) { res.dano = d.hp - 1; res.aguentou = true; }
    if (d.aguentar && res.dano >= d.hp) { res.dano = d.hp - 1; res.endure = true; }
    return res;
  }
  function esperado(a, d, g) {
    if (g.c === 'S' || g.esp in DEVOLVE) { return 0; }
    if (g.esp === 'primeiro' && (a.usos || 0) > 0) { return 0; }
    var antes = a.golpeAtual; a.golpeAtual = g.esp || null;
    var v = esperadoBase(a, d, g);
    a.golpeAtual = antes;
    if (g.esp === 'mao') { v *= d.golpes.some(function (x) { return x.c !== 'S' && x.pr > 0; }) ? 0.4 : 0; }
    return v;
  }
  function esperadoBase(a, d, g) {
    var t = tipoDe(a, g), e = efetividade(a, d, g, t);
    if (!e || bloqueio(a, d, g, t, e)) { return 0; }
    var h = hab(a), nc = Math.min(2, (g.ca || 0) + (h === 'super-luck' ? 1 : 0)), hd = habAlvo(a, d);
    var pc = hd === 'battle-armor' || hd === 'shell-armor' ? 0 : g.ca === 2 ? 1 : CHANCE_CRIT[nc], critMedio = 1 + pc * (h === 'sniper' ? 1.25 : 0.5);
    var ac = precisaoDe(a, d, g), hits = g.hmax > 1 && h === 'skill-link' ? g.hmax : acertosMedios(g);
    return danoBase(a, d, g, false) * stabDe(a, g, t) * e * (ac === 0 ? 1 : Math.min(1, ac / 100)) * hits * critMedio * 0.925 * multHab(a, d, g, t, e, false) * multClima(a, g, t) * multTerreno(a, d, g, t);
  }
  /* dreno (cura quem atacou; Liquid Ooze fere) e recuo (fere quem atacou, sem o derrubar) */
  function efeitoDreno(a, d, g, causado, P) {
    if (!g.dr || causado <= 0 || a.hp <= 0) { return; }
    var x = Math.max(1, Math.floor(causado * Math.abs(g.dr) / 100));
    if (g.dr > 0) {
      if (hab(d) === 'liquid-ooze') { anunciar(d, P); mexerHp(a, -x, `<b>${esc(a.p.nome)}</b> absorveu lodo e perdeu {x} HP.`, P); return; }
      mexerHp(a, x, `<b>${esc(a.p.nome)}</b> recuperou {x} HP.`, P); return;
    }
    if (hab(a) === 'rock-head' || hab(a) === 'magic-guard') { return; }
    mexerHp(a, -x, `<b>${esc(a.p.nome)}</b> sofreu {x} de recuo.`, P);
  }

  /* ---------- usar um golpe: regras comuns à batalha e à simulação ---------- */
  /* decide o golpe que sai mesmo (preguiça, fúria, PP) e gasta o PP (Pressure do adversário gasta 2) */
  function golpeEfetivo(a, idx, d) {
    if (hab(a) === 'truant' && a.descansa) { a.descansa = false; return { descansa: true }; }
    if (hab(a) === 'truant') { a.descansa = true; }
    if (a.preso) { idx = a.preso.idx; }
    if (!a.pp.some(function (x) { return x > 0; })) { return { g: LUTA, idx: -1 }; }
    if (a.provocado > 0 && a.golpes[idx] && a.golpes[idx].c === 'S') { return { provocado: true, g: a.golpes[idx] }; }
    if (!(a.pp[idx] > 0)) { idx = a.pp.findIndex(function (x) { return x > 0; }); }
    a.pp[idx] = Math.max(0, a.pp[idx] - (d && hab(d) === 'pressure' ? 2 : 1));
    var ge = a.golpes[idx];
    a.usos = (a.usos || 0) + 1;
    if (!PROTECAO[ge.esp] && ge.esp !== 'aguentar') { a.protUsos = 0; }
    return { g: ge, idx: idx };
  }
  /* ---------- golpes defensivos: Protect e variantes, Endure, barreiras, Substitute; Counter e afins ---------- */
  var PROTECAO = { proteger: 1, 'escudo-rei': 1, espinhos: 1, bunker: 1, seda: 1, muralha: 1, obstruir: 1 };
  var DEVOLVE = { counter: 'F', mirror: 'E', metal: '' };
  var QUEBRA_TELA = /^(Brick Break|Psychic Fangs|Raging Bull)$/;
  function ladoM(m) { var B = m && m.campo && m.campo.B; return B && B.j.time.indexOf(m) >= 0 ? 'j' : 'o'; }
  function telaDe(m) { var c = m && m.campo; return c && c.tela ? c.tela[ladoM(m)] : null; }
  /* no início de cada turno: proteções, Endure, dano recebido e "já agiu" voltam ao normal */
  function limparTurno(B) {
    ['j', 'o'].forEach(function (l) { B[l].time.forEach(function (m) { m.protegido = null; m.aguentar = false; m.recebido = null; m.agiu = false; }); });
    if (B.campo) { B.campo.arrastado = {}; B.campo.acoes = null; }
  }
  /* o alvo está protegido? (Unseen Fist atravessa com golpes físicos; algumas proteções deixam passar golpes de estado) */
  function bloqueadoPorProtecao(a, d, g, P) {
    if (!d.protegido || d.hp <= 0) { return false; }
    if (g.esp === 'finta') { d.protegido = null; P.push({ tipo: 'txt', txt: `${esc(g.nome)} furou a proteção de <b>${esc(d.p.nome)}</b>!` }); return false; }
    var estado = g.c === 'S', t = d.protegido;
    if (estado && !alvoAdversario(g)) { return false; }
    if (estado && (t === 'escudo-rei' || t === 'seda' || t === 'obstruir')) { return false; }
    if (!estado && hab(a) === 'unseen-fist' && g.c === 'F') { return false; }
    P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> protegeu-se!` });
    a.preso = null;
    if (!estado && g.c === 'F' && a.hp > 0) {
      if (t === 'espinhos') { mexerHp(a, -Math.max(1, Math.floor(a.hpMax / 8)), `<b>${esc(a.p.nome)}</b> picou-se e perdeu {x} HP.`, P); }
      if (t === 'bunker') { aplicarEstado(a, 'psn', d, P); }
      if (t === 'muralha') { aplicarEstado(a, 'brn', d, P); }
      if (t === 'escudo-rei') { alterar(a, 'atk', -1, d, P); }
      if (t === 'obstruir') { alterar(a, 'def', -2, d, P); }
      if (t === 'seda') { alterar(a, 'spe', -1, d, P); }
    }
    return true;
  }
  /* Brick Break, Psychic Fangs e Raging Bull partem as barreiras do alvo */
  function partirBarreiras(a, d, g, P) {
    var tl = telaDe(d);
    if (!QUEBRA_TELA.test(g.nome) || !tl || !(tl.reflect || tl.luz || tl.veu)) { return; }
    tl.reflect = tl.luz = tl.veu = 0; P.push({ tipo: 'txt', txt: `As barreiras de <b>${esc(d.p.nome)}</b> partiram-se!` });
  }
  /* o substituto recebe o golpe (os sonoros e Infiltrator atravessam); devolve o dano que levou */
  function noSubstituto(a, d, g, r, P) {
    if (!(d.sub > 0) || hab(a) === 'infiltrator' || SOM.test(g.nome) || r.erro || r.ef === 0) { return -1; }
    var x = Math.min(r.dano, d.sub); d.sub -= x; r.sub = true;
    P.push({ tipo: 'txt', txt: `O substituto de <b>${esc(d.p.nome)}</b> recebeu o golpe (${x}).` });
    if (d.sub <= 0) { d.sub = 0; P.push({ tipo: 'txt', txt: `O substituto de <b>${esc(d.p.nome)}</b> partiu-se!` }); }
    return x;
  }
  /* Counter (físico ×2), Mirror Coat (especial ×2), Metal Burst/Comeuppance (qualquer ×1,5): dano recebido neste turno */
  function danoDevolvido(a, g) {
    var rec = a.recebido; if (!rec || !rec.dano) { return 0; }
    var cat = DEVOLVE[g.esp];
    if (cat && rec.c !== cat) { return 0; }
    return Math.floor(rec.dano * (cat ? 2 : 1.5));
  }
  /* fim do turno: as barreiras perdem um turno */
  function fimTurnoBarreiras(B, lados) {
    var P = [], c = B.campo; if (!c || !c.tela) { return P; }
    var nomes = { reflect: 'O Reflect', luz: 'O Light Screen', veu: 'O Aurora Veil' };
    lados.forEach(function (l) {
      var tl = c.tela[l];
      Object.keys(nomes).forEach(function (k) { if (tl[k] > 0) { tl[k]--; if (tl[k] === 0) { P.push({ tipo: 'txt', txt: `${nomes[k]} ${l === 'j' ? 'do teu lado' : 'do oponente'} acabou.` }); } } });
    });
    return P;
  }

  /* ---------- controlo e armadilhas: Haze, Taunt, Roar/Whirlwind, Leech Seed; Stealth Rock, Spikes, Toxic Spikes, Sticky Web ---------- */
  var ALVO_ESP = { taunt: 1, roar: 1, semente: 1 };
  var RISCO = { rochas: 1, picos: 1, 'picos-toxicos': 1, teia: 1 };
  function riscoDe(m) { var c = m && m.campo; return c && c.risco ? c.risco[ladoM(m)] : null; }
  function temRisco(rk) { return !!(rk && (rk.rochas || rk.picos || rk.toxicos || rk.teia)); }
  function reservasDe(m) {
    var B = m && m.campo && m.campo.B; if (!B) { return []; }
    var l = B[ladoM(m)], out = []; l.time.forEach(function (x, i) { if (x.hp > 0 && i !== l.ativo) { out.push(i); } }); return out;
  }
  function somaSubidas(m) { return Object.keys(m.est || {}).reduce(function (t, k) { return t + Math.max(0, m.est[k]); }, 0); }
  /* obriga d a trocar por um Pokémon ao acaso do time (Roar, Whirlwind, Dragon Tail...) */
  function arrastarAlvo(d, P) {
    var res = reservasDe(d);
    if (!res.length || hab(d) === 'suction-cups' || hab(d) === 'guard-dog' || d.gmax > 0) { return false; }
    var idx = res[Math.floor(rng() * res.length)];
    P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> foi obrigado a voltar!` }); P.push({ tipo: 'troca', m: d, idx: idx });
    return true;
  }
  function extrairTroca(P) { var i = P.findIndex(function (x) { return x.tipo === 'troca'; }); return i >= 0 ? P.splice(i, 1)[0] : null; }
  /* ao entrar: as armadilhas do lado de m (nunca derrubam) */
  function aplicarRiscos(m, foe, P) {
    var rk = riscoDe(m), nome = `<b>${esc(m.p.nome)}</b>`;
    if (!temRisco(rk) || m.hp <= 0) { return; }
    if (hab(m) !== 'magic-guard') {
      if (rk.rochas) { mexerHp(m, -Math.max(1, Math.floor(m.hpMax * K.efTotal('rock', tiposDe(m)) / 8)), nome + ' foi ferido pelas pedras afiadas ({x}).', P); }
      if (rk.picos && noChao(m)) { mexerHp(m, -Math.max(1, Math.floor(m.hpMax * [0, 1 / 8, 1 / 6, 1 / 4][rk.picos])), nome + ' foi ferido pelos picos ({x}).', P); }
    }
    if (rk.toxicos && noChao(m)) {
      if (tiposDe(m).indexOf('poison') >= 0) { rk.toxicos = 0; P.push({ tipo: 'txt', txt: nome + ' absorveu os picos venenosos!' }); }
      else { aplicarEstado(m, rk.toxicos >= 2 ? 'tox' : 'psn', null, P); }
    }
    if (rk.teia && noChao(m)) { P.push({ tipo: 'txt', txt: nome + ' ficou preso na teia!' }); alterar(m, 'spe', -1, foe, P); }
  }
  function limparRiscos(rk) { if (rk) { rk.rochas = rk.picos = rk.toxicos = rk.teia = 0; } }

  /* ---------- golpes de estado e de reforço ---------- */
  var POS = /^(Spore|Sleep Powder|Stun Spore|Poison Powder|Cotton Spore)$/;
  function alvoAdversario(g) { return !!((g.ef && g.ef[0] === 'a') || g.st || ALVO_ESP[g.esp]); }
  /* porque é que um golpe de estado no adversário não teria efeito ('' = funciona) */
  function falhaEstado(a, d, g) {
    if (!alvoAdversario(g)) { return ''; }
    var hd = habAlvo(a, d);
    if (hab(a) === 'prankster' && tiposDe(d).indexOf('dark') >= 0) { return 'tipo'; }
    if (hd === 'good-as-gold') { return 'hab'; }
    if (g.nome === 'Thunder Wave' && efetividade(a, d, g, 'electric') === 0) { return 'tipo'; }
    if (POS.test(g.nome) && (tiposDe(d).indexOf('grass') >= 0 || hd === 'overcoat')) { return hd === 'overcoat' ? 'hab' : 'tipo'; }
    if (prioGolpe(a, g) > 0 && ((terreno(d) === 'psiquico' && noChao(d)) || hd === 'dazzling' || hd === 'queenly-majesty' || hd === 'armor-tail')) { return 'terreno'; }
    return '';
  }
  function podeDormirRest(m) { var e = m.estado; m.estado = null; var ok = podeTerEstado(m, 'slp', null); m.estado = e; return ok; }
  function usarEstado(a, d, g, P) {
    // Roar e Whirlwind atravessam o Protect e o substituto; Taunt atravessa o substituto
    if (alvoAdversario(g) && g.esp !== 'roar' && bloqueadoPorProtecao(a, d, g, P)) { return; }
    if (alvoAdversario(g) && g.esp !== 'roar' && g.esp !== 'taunt' && d.sub > 0 && hab(a) !== 'infiltrator' && !SOM.test(g.nome)) { P.push({ tipo: 'txt', txt: 'Mas falhou! (o substituto protegeu-o)' }); return; }
    if (alvoAdversario(g)) {
      if (habAlvo(a, d) === 'magic-bounce' && d.hp > 0) { anunciar(d, P); P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> devolveu o golpe!` }); var t = a; a = d; d = t; }
      var f = falhaEstado(a, d, g);
      if (f) { if (f === 'hab') { anunciar(d, P); } P.push({ tipo: 'txt', txt: `Não afeta <b>${esc(d.p.nome)}</b>.` }); return; }
      var ac = precisaoDe(a, d, g);
      if (!(ac === 0 || rng() * 100 < ac)) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); return; }
      var alvoNome = `<b>${esc(d.p.nome)}</b>`;
      if (g.esp === 'roar') { if (!arrastarAlvo(d, P)) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); } return; }
      if (g.esp === 'taunt') {
        if (d.provocado > 0 || hab(d) === 'oblivious' || hab(d) === 'aroma-veil') { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); return; }
        d.provocado = 3; P.push({ tipo: 'txt', txt: alvoNome + ' foi provocado: só pode usar golpes de dano (3 turnos)!' }); return;
      }
      if (g.esp === 'semente') {
        if (d.semente || tiposDe(d).indexOf('grass') >= 0) { P.push({ tipo: 'txt', txt: `Não afeta ${alvoNome}.` }); return; }
        d.semente = true; P.push({ tipo: 'txt', txt: alvoNome + ' foi semeado!' }); return;
      }
      if (g.ef) { g.ef[2].forEach(function (x) { alterar(d, x[0], x[1], a, P); }); }
      if (g.st && !aplicarEstado(d, g.st[0], a, P) && !g.ef) { P.push({ tipo: 'txt', txt: `Não teve efeito em <b>${esc(d.p.nome)}</b>.` }); }
      return;
    }
    var nome = `<b>${esc(a.p.nome)}</b>`, falhou = false;
    if (PROTECAO[g.esp] || g.esp === 'aguentar') {
      // falha se o adversário já agiu neste turno; usado seguido, só 1/3 de chance (1/9, ...)
      var n = a.protUsos || 0, ok = !d.agiu && (n === 0 || rng() < Math.pow(1 / 3, n));
      if (!ok) { a.protUsos = 0; P.push({ tipo: 'txt', txt: 'Mas falhou!' }); return; }
      a.protUsos = n + 1;
      if (g.esp === 'aguentar') { a.aguentar = true; P.push({ tipo: 'txt', txt: nome + ' prepara-se para aguentar!' }); }
      else { a.protegido = g.esp; P.push({ tipo: 'txt', txt: nome + ' protegeu-se!' }); }
      return;
    }
    if (g.esp === 'reflect' || g.esp === 'light-screen' || g.esp === 'aurora') {
      var tl = telaDe(a), k = g.esp === 'reflect' ? 'reflect' : g.esp === 'light-screen' ? 'luz' : 'veu';
      if (!tl || tl[k] > 0 || (k === 'veu' && clima(a) !== 'neve')) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); return; }
      tl[k] = 5;
      P.push({ tipo: 'txt', txt: { reflect: 'Reflect: os golpes físicos fazem metade do dano', luz: 'Light Screen: os golpes especiais fazem metade do dano', veu: 'Aurora Veil: todos os golpes fazem metade do dano' }[k] + ` ao lado de ${nome} (5 turnos).` });
      return;
    }
    if (g.esp === 'haze') { a.est = zeroEst(); d.est = zeroEst(); P.push({ tipo: 'txt', txt: 'Todas as mudanças de atributos foram eliminadas!' }); return; }
    if (RISCO[g.esp]) {
      var rk = riscoDe(d), quem = `à volta de <b>${esc(d.p.nome)}</b>`;
      if (!rk) { return; }
      if (g.esp === 'rochas') { if (rk.rochas) { falhou = true; } else { rk.rochas = 1; P.push({ tipo: 'txt', txt: `Pedras afiadas espalharam-se ${quem}!` }); } }
      if (g.esp === 'picos') { if (rk.picos >= 3) { falhou = true; } else { rk.picos++; P.push({ tipo: 'txt', txt: `Picos espalharam-se ${quem} (×${rk.picos})!` }); } }
      if (g.esp === 'picos-toxicos') { if (rk.toxicos >= 2) { falhou = true; } else { rk.toxicos++; P.push({ tipo: 'txt', txt: `Picos venenosos espalharam-se ${quem} (×${rk.toxicos})!` }); } }
      if (g.esp === 'teia') { if (rk.teia) { falhou = true; } else { rk.teia = 1; P.push({ tipo: 'txt', txt: `Uma teia pegajosa espalhou-se ${quem}!` }); } }
      if (falhou) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); }
      return;
    }
    if (g.esp === 'defog' || g.esp === 'limpar') {
      var algo = temRisco(riscoDe(a)) || temRisco(riscoDe(d));
      limparRiscos(riscoDe(a)); limparRiscos(riscoDe(d));
      if (g.esp === 'defog') {
        var td = telaDe(d); if (td && (td.reflect || td.luz || td.veu)) { td.reflect = td.luz = td.veu = 0; algo = true; }
        if (a.campo && a.campo.terreno) { a.campo.terreno = null; a.campo.tturnos = 0; algo = true; }
      } else { if (a.sub || d.sub) { algo = true; } a.sub = 0; d.sub = 0; }
      P.push({ tipo: 'txt', txt: algo ? (g.esp === 'defog' ? 'O vento levou as armadilhas e as barreiras!' : 'O campo ficou arrumado!') : 'Não havia nada para limpar.' });
      return;
    }
    if (g.esp === 'substituto') {
      var custo = Math.floor(a.hpMax / 4);
      if (a.sub > 0 || a.hp <= custo) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); return; }
      a.hp -= custo; a.sub = custo; P.push({ tipo: 'hp', m: a, d: -custo, txt: nome + ' criou um substituto!' });
      return;
    }
    if (g.ef) { g.ef[2].forEach(function (x) { alterar(a, x[0], x[1], null, P); }); }
    var cura = g.cura;
    if (g.esp === 'cura-sol') { cura = clima(a) === 'sol' ? 66.7 : clima(a) ? 25 : 50; }
    if (g.esp === 'cura-areia') { cura = clima(a) === 'areia' ? 66.7 : 50; }
    if (cura && !mexerHp(a, Math.max(1, Math.floor(a.hpMax * cura / 100)), nome + ' recuperou {x} HP.', P)) { P.push({ tipo: 'txt', txt: nome + ' já tem o HP cheio.' }); }
    if (g.esp === 'rest') {
      if (a.hp === a.hpMax || a.estado === 'slp' || !podeDormirRest(a)) { falhou = true; }
      else { a.hp = a.hpMax; a.estado = 'slp'; a.sono = 3; a.toxN = 0; P.push({ tipo: 'hp', m: a, d: 0, txt: nome + ' adormeceu e recuperou toda a saúde!' }); }
    }
    if (g.esp === 'sol' || g.esp === 'chuva' || g.esp === 'areia' || g.esp === 'neve') { falhou = !mudarClima(a, g.esp, P); }
    if (g.esp && g.esp.indexOf('t-') === 0) { falhou = !mudarTerreno(a, g.esp.slice(2), P); }
    if (falhou) { P.push({ tipo: 'txt', txt: 'Mas falhou!' }); }
  }
  function melhorEsperadoCat(d, a, cat) {
    var v = 0; d.golpes.forEach(function (g, i) { if (g.c === cat && d.pp[i] > 0) { v = Math.max(v, esperado(d, a, g)); } }); return v;
  }
  /* IA: Counter/Mirror Coat/Metal Burst valem se aguentar o golpe do adversário */
  function valorDevolve(a, d, g) {
    var cat = DEVOLVE[g.esp], inc = cat ? melhorEsperadoCat(d, a, cat) : melhorEsperado(d, a);
    if (inc <= 0 || inc >= a.hp || efetividade(a, d, g, tipoDe(a, g)) === 0) { return 0; }
    if (!cat && velocidade(a) > velocidade(d)) { return 0; }
    return Math.min(d.hp, inc * (cat ? 2 : 1.5)) * 0.6;
  }
  /* IA: quanto vale usar um golpe de estado agora (na mesma escala do dano esperado) */
  function valorEstadoIA(a, d, g, melhor) {
    if (melhor >= d.hp || falhaEstado(a, d, g)) { return 0; }
    var ameaca = melhorEsperado(d, a), aguenta = a.hp > ameaca * 2.2, v = 0, pk = a.st.atk >= a.st.spa ? 'atk' : 'spa';
    if (g.ef && g.ef[0] === 'u' && aguenta) {
      var ganho = 0;
      g.ef[2].forEach(function (x) {
        if (x[1] > 0 && a.est[x[0]] >= 4) { return; }
        ganho += x[1] * (x[0] === pk ? 0.5 : x[0] === 'spe' ? (velocidade(a) < velocidade(d) ? 0.4 : 0.05) : x[0] === 'def' || x[0] === 'spd' ? 0.15 : 0);
      });
      if (ganho > 0) { v += melhor * ganho * 1.6; }
    }
    if (g.ef && g.ef[0] === 'a' && aguenta) {
      var fk = d.st.atk >= d.st.spa ? 'atk' : 'spa';
      g.ef[2].forEach(function (x) { if (d.est[x[0]] > -3) { v += melhor * -x[1] * (x[0] === fk ? 0.3 : x[0] === 'def' || x[0] === 'spd' ? 0.2 : x[0] === 'spe' ? 0.15 : 0.05); } });
    }
    if (g.st && podeTerEstado(d, g.st[0], a)) {
      var f = { brn: d.st.atk > d.st.spa ? 1.0 : 0.5, par: velocidade(d) > velocidade(a) ? 0.9 : 0.5, psn: 0.6, tox: 0.8, slp: 1.3, frz: 0.6, conf: 0.5 }[g.st[0]] || 0;
      v += melhor * f;
    }
    if (PROTECAO[g.esp]) {
      if (a.protUsos > 0) { return 0; }
      var tick = (d.estado === 'brn' ? d.hpMax / 16 : 0) + (d.estado === 'psn' ? d.hpMax / 8 : 0) + (d.estado === 'tox' ? d.hpMax * ((d.toxN || 0) + 1) / 16 : 0) +
        (clima(a) === 'areia' && !imuneAreia(d) ? d.hpMax / 16 : 0);
      v += tick + (hab(a) === 'speed-boost' && a.est.spe < 6 ? melhor * 0.5 : 0) + (d.gmax > 0 ? melhor * 0.8 : 0) + (d.preso ? melhor * 0.4 : 0) +
        (g.esp !== 'proteger' && d.st.atk > d.st.spa ? melhor * 0.15 : 0);
      return v;
    }
    if (g.esp === 'aguentar') { return a.protUsos === 0 && ameaca >= a.hp && a.hp > 1 && a.golpes.some(function (x) { return x.esp in DEVOLVE || x.pr > 0; }) ? melhor * 0.5 : 0; }
    if (g.esp === 'reflect' || g.esp === 'light-screen' || g.esp === 'aurora') {
      var tl = telaDe(a), fis = melhorEsperadoCat(d, a, 'F'), esp = melhorEsperadoCat(d, a, 'E');
      if (!tl || !aguenta) { return 0; }
      if (g.esp === 'reflect') { return tl.reflect || tl.veu ? 0 : fis * 1.2; }
      if (g.esp === 'light-screen') { return tl.luz || tl.veu ? 0 : esp * 1.2; }
      return clima(a) !== 'neve' || tl.veu ? 0 : Math.max(fis, esp) * 1.3;
    }
    var resD = reservasDe(d).length, resA = reservasDe(a).length;
    if (RISCO[g.esp]) {
      var rk = riscoDe(d); if (!rk || !resD || !aguenta) { return 0; }
      if (g.esp === 'rochas') { return rk.rochas ? 0 : melhor * 0.3 * resD; }
      if (g.esp === 'picos') { return rk.picos >= 3 ? 0 : melhor * 0.18 * resD; }
      if (g.esp === 'picos-toxicos') { return rk.toxicos >= 2 ? 0 : melhor * 0.15 * resD; }
      return rk.teia ? 0 : melhor * 0.12 * resD;
    }
    if (g.esp === 'defog' || g.esp === 'limpar') {
      var td = telaDe(d);
      v += (temRisco(riscoDe(a)) && resA ? melhor * 0.5 : 0) + (g.esp === 'defog' && td && (td.reflect || td.luz || td.veu) ? melhor * 0.4 : 0) - (temRisco(riscoDe(d)) ? melhor * 0.2 : 0);
      return Math.max(0, v);
    }
    if (g.esp === 'haze') { var dif = somaSubidas(d) - somaSubidas(a); return dif >= 2 ? melhor * 0.35 * dif : 0; }
    if (g.esp === 'taunt') { return !(d.provocado > 0) && hab(d) !== 'oblivious' && d.golpes.some(function (x) { return x.c === 'S'; }) ? melhor * 0.5 : 0; }
    if (g.esp === 'roar') { return resD && !d.gmax ? melhor * (0.35 * somaSubidas(d) + (d.sub > 0 ? 0.5 : 0) + (temRisco(riscoDe(d)) ? 0.25 : 0)) : 0; }
    if (g.esp === 'semente') { return d.semente || tiposDe(d).indexOf('grass') >= 0 || d.sub > 0 || !aguenta ? 0 : d.hpMax / 8 * 3; }
    if (g.esp === 'substituto') {
      if (a.sub > 0 || a.hp <= a.hpMax / 2) { return 0; }
      return (ameaca < a.hpMax / 4 ? melhor * 0.6 : 0) + (d.golpes.some(function (x) { return x.c === 'S' && alvoAdversario(x); }) ? melhor * 0.4 : 0);
    }
    var falta = 1 - a.hp / a.hpMax, cura = g.esp === 'cura-sol' || g.esp === 'cura-areia' ? 50 : g.cura;
    if (cura && falta > 0.45) { v += melhor * falta * 2.2 * cura / 50; }
    if (g.esp === 'rest' && a.hp / a.hpMax < 0.4 && !a.estado && podeDormirRest(a)) { v += melhor * 1.4; }
    var alvo = { sol: 'fire', chuva: 'water', areia: 'rock', neve: 'ice', 't-eletrico': 'electric', 't-planta': 'grass', 't-psiquico': 'psychic' }[g.esp];
    var ativoJa = g.esp && (a.campo && (a.campo.clima === g.esp || 't-' + a.campo.terreno === g.esp));
    if (alvo && !ativoJa && a.golpes.some(function (x) { return x.c !== 'S' && x.t === alvo; })) { v += melhor * 0.6; }
    return v * (g.ac ? g.ac / 100 : 1);
  }
  /* o alvo absorveu o golpe com a habilidade */
  function absorver(d, slug, P) {
    if (slug === 'terreno') { P.push({ tipo: 'txt', txt: `O terreno psíquico protegeu <b>${esc(d.p.nome)}</b>!` }); return; }
    anunciar(d, P);
    var cura = function () { if (!mexerHp(d, Math.floor(d.hpMax / 4), `<b>${esc(d.p.nome)}</b> recuperou {x} HP.`, P)) { P.push({ tipo: 'txt', txt: `Não afeta <b>${esc(d.p.nome)}</b>.` }); } };
    switch (slug) {
      case 'flash-fire': d.flash = true; P.push({ tipo: 'txt', txt: `O Fogo de <b>${esc(d.p.nome)}</b> ficou mais forte!` }); break;
      case 'water-absorb': case 'volt-absorb': case 'dry-skin': case 'earth-eater': cura(); break;
      case 'lightning-rod': case 'storm-drain': alterar(d, 'spa', 1, null, P); break;
      case 'motor-drive': alterar(d, 'spe', 1, null, P); break;
      case 'sap-sipper': alterar(d, 'atk', 1, null, P); break;
      case 'well-baked-body': alterar(d, 'def', 2, null, P); break;
      default: P.push({ tipo: 'txt', txt: `Não afeta <b>${esc(d.p.nome)}</b>.` });
    }
  }
  /* reações de quem foi atingido (Rough Skin, Justified, Stamina...) */
  function reacoes(a, d, g, r, causado, P) {
    var hd = hab(d), t = r.t, antes = d.hp + causado, meio = d.hpMax / 2;
    if (d.estado === 'frz' && t === 'fire' && d.hp > 0) { d.estado = null; P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> descongelou!` }); }
    // contacto (golpes físicos): Static, Flame Body, Poison Point, Effect Spore; Poison Touch de quem ataca
    if (a.hp > 0 && g.c === 'F') {
      var cont = { static: 'par', 'flame-body': 'brn', 'poison-point': 'psn' }[hd];
      if (cont && rng() < 0.3 && podeTerEstado(a, cont, null)) { anunciar(d, P); aplicarEstado(a, cont, d, P); }
      if (hd === 'effect-spore' && tiposDe(a).indexOf('grass') < 0 && hab(a) !== 'overcoat' && rng() < 0.3) {
        var esp = ['psn', 'par', 'slp'][Math.floor(rng() * 3)];
        if (podeTerEstado(a, esp, null)) { anunciar(d, P); aplicarEstado(a, esp, d, P); }
      }
      if (hab(a) === 'poison-touch' && d.hp > 0 && rng() < 0.3 && podeTerEstado(d, 'psn', a)) { anunciar(a, P); aplicarEstado(d, 'psn', a, P); }
    }
    if (d.hp > 0) {
      if (hd === 'justified' && t === 'dark') { anunciar(d, P); alterar(d, 'atk', 1, null, P); }
      if (hd === 'weak-armor' && g.c === 'F') { anunciar(d, P); alterar(d, 'def', -1, null, P); alterar(d, 'spe', 2, null, P); }
      if (hd === 'stamina') { anunciar(d, P); alterar(d, 'def', 1, null, P); }
      if (hd === 'rattled' && (t === 'bug' || t === 'ghost' || t === 'dark')) { anunciar(d, P); alterar(d, 'spe', 1, null, P); }
      if (hd === 'steam-engine' && (t === 'fire' || t === 'water')) { anunciar(d, P); alterar(d, 'spe', 6, null, P); }
      if (hd === 'thermal-exchange' && t === 'fire') { anunciar(d, P); alterar(d, 'atk', 1, null, P); }
      if (antes > meio && d.hp <= meio) {
        if (hd === 'berserk') { anunciar(d, P); alterar(d, 'spa', 1, null, P); }
        if (hd === 'anger-shell') { anunciar(d, P); ['atk', 'spa', 'spe'].forEach(function (k) { alterar(d, k, 1, null, P); }); alterar(d, 'def', -1, null, P); alterar(d, 'spd', -1, null, P); }
      }
      if (hd === 'anger-point' && r.crit) { anunciar(d, P); alterar(d, 'atk', 12, null, P); }
      if (hd === 'cotton-down' && a.hp > 0) { anunciar(d, P); alterar(a, 'spe', -1, d, P); }
    }
    if (hd === 'sand-spit' && d.campo && d.campo.clima !== 'areia') { anunciar(d, P); mudarClima(d, 'areia', P); }
    if (hd === 'seed-sower' && d.campo && d.campo.terreno !== 'planta') { anunciar(d, P); mudarTerreno(d, 'planta', P); }
    if (a.hp > 0 && hab(a) !== 'magic-guard') {
      if (g.c === 'F' && (hd === 'rough-skin' || hd === 'iron-barbs')) { anunciar(d, P); mexerHp(a, -Math.max(1, Math.floor(a.hpMax / 8)), `<b>${esc(a.p.nome)}</b> magoou-se e perdeu {x} HP.`, P); }
      if (d.hp <= 0 && g.c === 'F' && hd === 'aftermath') { anunciar(d, P); mexerHp(a, -Math.max(1, Math.floor(a.hpMax / 4)), `<b>${esc(a.p.nome)}</b> perdeu {x} HP.`, P); }
      if (d.hp <= 0 && hd === 'innards-out') { anunciar(d, P); mexerHp(a, -causado, `<b>${esc(a.p.nome)}</b> perdeu {x} HP.`, P); }
    }
    if (d.hp > 0 && a.hp > 0 && g.c === 'F' && (hd === 'gooey' || hd === 'tangling-hair')) { anunciar(d, P); alterar(a, 'spe', -1, d, P); }
  }
  /* derrubou um adversário: Moxie, Beast Boost... */
  function aoDerrubar(a, P) {
    var h = hab(a);
    if (a.hp <= 0) { return; }
    if (h === 'moxie' || h === 'chilling-neigh' || h === 'as-one-glastrier') { anunciar(a, P); alterar(a, 'atk', 1, null, P); }
    if (h === 'grim-neigh' || h === 'as-one-spectrier') { anunciar(a, P); alterar(a, 'spa', 1, null, P); }
    if (h === 'beast-boost') {
      var k = ['atk', 'def', 'spa', 'spd', 'spe'].reduce(function (x, y) { return a.st[y] > a.st[x] ? y : x; }, 'atk');
      anunciar(a, P); alterar(a, k, 1, null, P);
    }
  }
  /* depois do golpe: dreno/recuo, Struggle, efeitos nos atributos, habilidades e fúria; devolve os passos */
  function efeitosDepois(a, d, g, r, causado, idx) {
    var ev = { passos: [] }, P = ev.passos;
    if (r.bloq) { absorver(d, r.bloq, P); }
    else if (!r.erro && r.ef !== 0) {
      if (r.disfarce) { d.disfarce = true; anunciar(d, P); P.push({ tipo: 'txt', txt: `O disfarce de <b>${esc(d.p.nome)}</b> protegeu-o!` }); }
      if (r.aguentou) { anunciar(d, P); P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> aguentou o golpe!` }); }
      if (r.endure) { P.push({ tipo: 'txt', txt: `<b>${esc(d.p.nome)}</b> aguentou o golpe!` }); }
      if (g.luta) {
        if (hab(a) !== 'magic-guard') { mexerHp(a, -Math.max(1, Math.floor(a.hpMax / 4)), `<b>${esc(a.p.nome)}</b> sofreu {x} de recuo.`, P); }
      } else { efeitoDreno(a, d, g, causado, P); }
      if (g.ef && !(secundario(g) && hab(a) === 'sheer-force')) {
        var alvo = g.ef[0] === 'u' ? a : d;
        var protegido = alvo === d && (r.sub || (secundario(g) && habAlvo(a, d) === 'shield-dust'));
        var chance = g.ef[1] * (hab(a) === 'serene-grace' ? 2 : 1);
        if (alvo.hp > 0 && !protegido && (g.ef[1] >= 100 || rng() * 100 < chance)) {
          g.ef[2].forEach(function (x) { alterar(alvo, x[0], x[1], alvo === d ? a : null, P); });
        }
      }
      // estados e recuo como efeito secundário
      if (!r.sub && causado > 0 && d.hp > 0 && !(hab(a) === 'sheer-force' && secundario(g)) && habAlvo(a, d) !== 'shield-dust') {
        var mult = hab(a) === 'serene-grace' ? 2 : 1;
        if (g.st && (g.st[1] >= 100 || rng() * 100 < g.st[1] * mult)) {
          var est = g.st[0] === 'tri' ? ['brn', 'par', 'frz'][Math.floor(rng() * 3)] : g.st[0] === 'dire' ? ['psn', 'par', 'slp'][Math.floor(rng() * 3)] : g.st[0];
          aplicarEstado(d, est, a, P);
        }
        var fl = g.fl || (hab(a) === 'stench' ? 10 : 0);
        if (fl && rng() * 100 < fl * mult && habAlvo(a, d) !== 'inner-focus') { d.recuar = true; }
      }
      if (causado > 0 && !r.sub) { d.recebido = { c: g.c, dano: causado }; reacoes(a, d, g, r, causado, P); }
      if (d.hp <= 0) { aoDerrubar(a, P); }
      if (g.esp === 'giro' && a.hp > 0 && (temRisco(riscoDe(a)) || a.semente)) { limparRiscos(riscoDe(a)); a.semente = false; P.push({ tipo: 'txt', txt: `<b>${esc(a.p.nome)}</b> livrou-se das armadilhas!` }); }
      if (g.esp === 'arrastar' && !r.sub && d.hp > 0 && a.hp > 0) { arrastarAlvo(d, P); }
    }
    if (g.esp === 'furia') {
      if (r.erro || r.ef === 0) { a.preso = null; }
      else if (!a.preso) { a.preso = { idx: idx, resta: rng() < 0.5 ? 1 : 2 }; }
      else { a.preso.resta--; if (a.preso.resta <= 0) { a.preso = null; ev.cansou = true; } }
    }
    a.golpeAtual = null;
    return ev;
  }
  /* derrubou um adversário: evolui (nível a meio caminho entre o atual e o equilibrado da evolução) */
  function evoluir(m) {
    if (m.hp <= 0 || m.base || m.gmax) { return null; }
    var nova = evolucaoDe(m.p); if (!nova) { return null; }
    var razao = m.hp / m.hpMax, antes = m.p;
    var lv = habsDe(antes), hv = lv[m.habPos] || { slug: m.habBase, oculta: false }, normais = lv.filter(function (h) { return !h.oculta; });
    m.nv = Math.round((m.nv + nivelDe(nova)) / 2);
    m.p = nova; m.st = statusDe(nova.b, m.nv, m.nat); m.hpMax = m.st.hp; m.hp = Math.max(1, Math.round(razao * m.hpMax));
    var copiada = m.hab !== m.habBase;
    m.habBase = habEvolucao(nova, { slug: m.habBase, oculta: hv.oculta, pos: Math.max(0, normais.indexOf(hv)) }) || m.habBase;
    m.habPos = Math.max(0, habsDe(nova).findIndex(function (h) { return h.slug === m.habBase; }));
    if (!copiada) { m.hab = m.habBase; }
    return antes;
  }
  /* fim do turno: conta os turnos em campo (Slow Start), Speed Boost e Moody */
  function fimTurnoLado(l) {
    var m = ativo(l), P = [];
    if (m.hp <= 0) { return P; }
    m.turnos++;
    var h = hab(m);
    if (h === 'speed-boost' && !m.novo && m.est.spe < 6) { anunciar(m, P); alterar(m, 'spe', 1, null, P); }
    if (h === 'moody') {
      var ks = ['atk', 'def', 'spa', 'spd', 'spe'], sobe = ks.filter(function (k) { return m.est[k] < 6; });
      if (sobe.length) {
        var k1 = sobe[Math.floor(rng() * sobe.length)], desce = ks.filter(function (k) { return k !== k1 && m.est[k] > -6; });
        anunciar(m, P); alterar(m, k1, 2, null, P);
        if (desce.length) { alterar(m, desce[Math.floor(rng() * desce.length)], -1, null, P); }
      }
    }
    m.novo = false;
    return P;
  }
  function prioridade(m, ac) {
    if (ac.tipo === 'troca') { return 10; }
    if (!m.pp.some(function (x) { return x > 0; })) { return 0; }
    var g = m.golpes[m.preso ? m.preso.idx : ac.idx];
    return g ? prioGolpe(m, g) : 0;
  }

  /* ---------- IA ---------- */
  function golpesDisponiveis(a) {
    if (a.preso) { return [a.preso.idx]; }
    var l = []; a.pp.forEach(function (x, i) { if (x > 0 && !(a.provocado > 0 && a.golpes[i].c === 'S')) { l.push(i); } });
    return l.length ? l : [0];
  }
  function melhorEsperado(a, d) {
    var gs = golpesDisponiveis(a);
    return Math.max.apply(null, gs.map(function (i) { return a.pp.some(function (x) { return x > 0; }) ? esperado(a, d, a.golpes[i]) : esperado(a, d, LUTA); }));
  }
  function iaGolpe(a, d) {
    var rapido = velocidade(a) >= velocidade(d), melhor = golpesDisponiveis(a)[0], nota = -1;
    var melhorDano = Math.max.apply(null, golpesDisponiveis(a).map(function (i) { return esperado(a, d, a.golpes[i]); }).concat([0]));
    golpesDisponiveis(a).forEach(function (i) {
      var g = a.golpes[i], v = g.c === 'S' ? valorEstadoIA(a, d, g, melhorDano) : g.esp in DEVOLVE ? valorDevolve(a, d, g) : esperado(a, d, g);
      if (g.esp === 'giro' && temRisco(riscoDe(a)) && reservasDe(a).length) { v += melhorDano * 0.3; }
      if (g.esp === 'primeiro' && g.fl && !(a.usos > 0) && hab(d) !== 'inner-focus' && v > 0) { v += melhorDano * 0.6; }
      if (g.esp === 'arrastar' && reservasDe(d).length) { v += melhorDano * 0.3 * somaSubidas(d); }
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
  function simular(idsJ, idsO, mvJ, mvO, exJ, exO) {
    var B = ligarCampo({ j: novoLado(idsJ, mvJ || S.mv.j, null, exJ || (mvJ ? null : extrasDo('j'))), o: novoLado(idsO, mvO || S.mv.o, null, exO || (mvO ? null : extrasDo('o'))) }), turnos = 0;
    aoEntrar(ativo(B.j), ativo(B.o), []); aoEntrar(ativo(B.o), ativo(B.j), []);
    while (vivos(B.j).length && vivos(B.o).length && turnos < 300) {
      turnos++;
      limparTurno(B);
      var aJ = iaAcao(B.j, B.o), aO = iaAcao(B.o, B.j);
      B.campo.acoes = { j: aJ, o: aO };
      var acoes = ordem(B, aJ, aO);
      for (var k = 0; k < acoes.length; k++) {
        var lado = acoes[k].lado, foe = lado === 'j' ? 'o' : 'j', ac = acoes[k].a;
        if (ac.tipo === 'troca') { sairDeCampo(ativo(B[lado])); B[lado].ativo = ac.idx; ativo(B[lado]).agiu = true; aoEntrar(ativo(B[lado]), ativo(B[foe]), []); continue; }
        var a = ativo(B[lado]), d = ativo(B[foe]);
        if (a.hp <= 0 || B.campo.arrastado[lado]) { continue; }
        a.agiu = true;
        if (!antesDeAgir(a, [])) {
          if (a.hp <= 0) { var r0 = iaMelhorReserva(B[lado], d); if (r0 >= 0) { sairDeCampo(a); B[lado].ativo = r0; aoEntrar(ativo(B[lado]), d, []); } break; }
          continue;
        }
        var uso = golpeEfetivo(a, ac.idx, d);
        if (uso.descansa || uso.provocado) { continue; }
        if (uso.g.c === 'S') {
          var P1 = []; usarEstado(a, d, uso.g, P1); var t1 = extrairTroca(P1);
          if (t1) { sairDeCampo(d); B[foe].ativo = t1.idx; B.campo.arrastado[foe] = true; aoEntrar(ativo(B[foe]), a, []); }
          continue;
        }
        if (bloqueadoPorProtecao(a, d, uso.g, [])) { continue; }
        partirBarreiras(a, d, uso.g, []);
        var r = calcular(a, d, uso.g), antes = d.hp, ns = noSubstituto(a, d, uso.g, r, []);
        if (ns < 0) { d.hp = Math.max(0, d.hp - r.dano); }
        var t2 = extrairTroca(efeitosDepois(a, d, uso.g, r, ns < 0 ? antes - d.hp : ns, uso.idx).passos);
        if (t2 && d.hp > 0) { sairDeCampo(d); B[foe].ativo = t2.idx; B.campo.arrastado[foe] = true; aoEntrar(ativo(B[foe]), a, []); }
        if (d.hp <= 0) {
          evoluir(a);
          var rs = iaMelhorReserva(B[foe], a);
          if (rs >= 0) { sairDeCampo(d); B[foe].ativo = rs; aoEntrar(ativo(B[foe]), a, []); }
          break;
        }
      }
      fimTurnoClima(B, ['j', 'o']); fimTurnoTerreno(B, ['j', 'o']); fimTurnoBarreiras(B, ['j', 'o']); fimTurnoEstado(B, ['j', 'o']); fimTurnoLado(B.j); fimTurnoLado(B.o);
      ['j', 'o'].forEach(function (l) {
        var m = ativo(B[l]);
        if (m.hp <= 0 && vivos(B[l]).length) { var rr = iaMelhorReserva(B[l], ativo(B[l === 'j' ? 'o' : 'j'])); if (rr >= 0) { sairDeCampo(m); B[l].ativo = rr; aoEntrar(ativo(B[l]), ativo(B[l === 'j' ? 'o' : 'j']), []); } }
      });
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
    return { fv: 3, pid: m.p.id, bid: m.base ? m.base.id : null, forma: m.forma || null, hp: m.hp, hpMax: m.hpMax, gmax: m.gmax || 0, golpes: m.golpes, golpesBase: m.golpesBase || null,
      nv: m.nv, pp: m.pp, est: m.est, item: m.item, preso: m.preso, descansa: m.descansa, turnos: m.turnos,
      nat: m.nat, hab: m.hab, habBase: m.habBase, habPos: m.habPos, novo: m.novo, flash: m.flash, disfarce: m.disfarce, usouEntrada: m.usouEntrada,
      estado: m.estado, sono: m.sono, toxN: m.toxN, conf: m.conf, recuar: m.recuar, sub: m.sub || 0, protUsos: m.protUsos || 0, semente: !!m.semente, provocado: m.provocado || 0, usos: m.usos || 0 };
  }
  function lutadorDaFoto(f) {
    var p = P[f.pid]; if (!p || f.fv !== 3 || !f.nv || !f.pp || f.nat == null || f.hab == null) { return null; }
    return { p: p, nv: f.nv, nat: f.nat, st: statusDe(p.b, f.nv, f.nat), hp: f.hp, hpMax: f.hpMax, golpes: f.golpes, golpesBase: f.golpesBase, base: f.bid ? P[f.bid] : null, forma: f.forma, gmax: f.gmax,
      pp: f.pp, est: f.est || zeroEst(), item: f.item || null, preso: f.preso || null, descansa: !!f.descansa, turnos: f.turnos || 0,
      hab: f.hab, habBase: f.habBase || f.hab, habPos: f.habPos || 0, novo: !!f.novo, flash: !!f.flash, disfarce: !!f.disfarce, usouEntrada: !!f.usouEntrada,
      estado: f.estado || null, sono: f.sono || 0, toxN: f.toxN || 0, conf: f.conf || 0, recuar: !!f.recuar, sub: f.sub || 0, protUsos: f.protUsos || 0, semente: !!f.semente, provocado: f.provocado || 0, usos: f.usos || 0 };
  }
  function fotoBatalha(B) {
    var lado = function (l) { return { ativo: l.ativo, transformou: !!l.transformou, time: l.time.map(fotoLutador) }; };
    return { j: lado(B.j), o: lado(B.o), campo: B.campo ? { clima: B.campo.clima, turnos: B.campo.turnos, terreno: B.campo.terreno, tturnos: B.campo.tturnos, tela: B.campo.tela, risco: B.campo.risco } : null };
  }
  function batalhaDaFoto(f) {
    var lado = function (l) { return { ativo: l.ativo, transformou: l.transformou, time: l.time.map(lutadorDaFoto) }; };
    var B = { j: lado(f.j), o: lado(f.o) };
    return B.j.time.every(Boolean) && B.o.time.every(Boolean) ? ligarCampo(B, f.campo) : null;
  }
  if (!window.__arena) {
    var salvo = K.restaurar('arena', 72);
    if (salvo && salvo.versao === D.v) {
      salvo.mv = { j: converterMv(salvo.mv && salvo.mv.j), o: converterMv(salvo.mv && salvo.mv.o) };
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
    return { turno: 0, minhas: {}, deles: {}, trocas: {}, minhasTrocas: {}, koSeq: {}, syncEu: {}, syncEle: {}, forma: null, revEu: false, revEle: false, esperaTroca: null, resolverTroca: null };
  }
  if (!S.on) {
    S.online = false;
    S.on = { pronto: false, opPronto: false, opQtd: 0, opTime: [], codigo: '', aviso: '', host: false, p: novaPartida() };
  }
  if (!S.mv) { S.mv = { j: {}, o: {} }; }
  if (!S.itens) { S.itens = { j: {}, o: {} }; }
  if (!S.nat) { S.nat = { j: {}, o: {} }; }
  if (!S.hab) { S.hab = { j: {}, o: {} }; }
  /* nature e habilidade escolhidas no editor: { [id]: { nat, hab } } (o que não foi escolhido fica automático) */
  function extrasDo(l) {
    var out = {};
    S.time[l].forEach(function (id) { var n = S.nat[l][id], h = S.hab[l][id]; if (n != null || h != null) { out[id] = { nat: n, hab: h }; } });
    return out;
  }
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
      <div class='sl-info'><b title='${esc(p.nome)}'>${esc(p.nome)}</b><div class='sl-tipos'>${p.t.map(K.chip).join('')}</div><span class='sl-nv'>Nv. ${nivelDe(p)} · ${resumoNatHab(l, id)}</span></div>
        ${itemHtml(l, p)}<div class='sl-gps' data-acao='editarGolpes' data-lado='${l}' data-id='${id}' title='Escolher golpes, nature e habilidade'>${golpesDe(p, S.mv[l][id]).map(function (g) { return icone(g.t, 14); }).join('')}<em>✎ Editar</em>${S.mv[l][id] || S.nat[l][id] != null || S.hab[l][id] != null ? '' : '<small>auto</small>'}</div>
      <i data-acao='tirar' data-lado='${l}' data-i='${i}'>×</i></div>`;
  }
  /* nature e habilidade em vigor para um Pokémon do time (escolhidas ou automáticas) */
  function natEm(l, id) { var n = S.nat[l][id]; return NATURES[n] ? n : natAuto(P[id], golpesDe(P[id], S.mv[l][id])); }
  function habEm(l, id) { var hl = habsDe(P[id]), h = S.hab[l][id]; return hl[h] ? hl[h] : hl[habAuto(P[id])]; }
  function resumoNatHab(l, id) {
    var n = natEm(l, id), c = classeNat(n, P[id], golpesDe(P[id], S.mv[l][id])), h = habEm(l, id);
    return `<i class='nat-pt ${c}'></i>${NATURES[n].nome}${h ? ' · ' + esc(h.nome) : ''}`;
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
    if (!cheio) { return `<span class='pv-dica'>Clique num lado e escolha os Pokémon na grade · níveis equilibrados · toca em ✎ Editar para golpes, nature e habilidade</span>`; }
    var chave = S.modo + ':' + S.time.j.join(',') + 'x' + S.time.o.join(',') + ':' + JSON.stringify(S.mv) + JSON.stringify(S.itens) + JSON.stringify(S.nat) + JSON.stringify(S.hab);
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
      !cheio ? 'Monta o teu time e carrega em PRONTO · níveis equilibrados · toca em ✎ Editar para golpes, nature e habilidade' :
      S.on.pronto ? (S.on.opPronto ? 'A começar...' : 'À espera que o adversário fique pronto...') : 'Time completo! Carrega em PRONTO';
    return `<span class='pv-dica'>${dica}</span>
      <div class='bt bt-go${ligado && cheio ? '' : ' off'}${S.on.pronto ? ' pronto' : ''}' data-acao='pronto'>${S.on.pronto ? '✓ PRONTO · cancelar' : '⚔ PRONTO'}</div>`;
  }


  /* ================= EDITOR DE GOLPES ================= */
  function extrasHtml(p, g) {
    var x = [];
    if (p.t.indexOf(g.t) >= 0 && g.c !== 'S') { x.push("<i class='ge-stab'>STAB</i>"); }
    if (g.pr > 0) { x.push(`<i>⚡ prioridade +${g.pr}</i>`); }
    if (g.hmax > 1) { x.push(`<i>${g.hmin === g.hmax ? g.hmin : g.hmin + '–' + g.hmax} acertos</i>`); }
    if (g.dr > 0) { x.push(`<i>drena ${g.dr}%</i>`); }
    if (g.dr < 0) { x.push(`<i>recuo ${-g.dr}%</i>`); }
    if (g.ca === 1) { x.push('<i>crítico alto</i>'); }
    if (g.ca === 2) { x.push('<i>sempre crítico</i>'); }
    if (g.st) { x.push(`<i class='ge-st'>${g.st[1] >= 100 ? '' : g.st[1] + '% '}${VERBO_EST[g.st[0]]}</i>`); }
    if (g.fl) { x.push(`<i>${g.fl}% recuar</i>`); }
    if (g.c !== 'S' && TXT_ESP[g.esp]) { x.push(`<i>${TXT_ESP[g.esp].slice(3)}</i>`); }
    if (g.c === 'S') {
      if (g.ef) { x.push(`<i>${(g.ef[0] === 'u' ? 'em si: ' : 'no alvo: ') + g.ef[2].map(function (y) { return CURTO_ATR[y[0]] + ' ' + (y[1] > 0 ? '+' : '') + y[1]; }).join(' ')}</i>`); }
      if (g.cura) { x.push(`<i>recupera ${g.cura}%</i>`); }
      if (TXT_ESP[g.esp]) { x.push(`<i>${TXT_ESP[g.esp].slice(3)}</i>`); }
    }
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
        ${icone(g.t, 22)}<b>${esc(g.nome)}</b><span class='ge-cat'>${g.c === 'F' ? 'Físico' : g.c === 'E' ? 'Especial' : 'Estado'}</span>
        <span class='ge-num'>${g.c === 'S' || g.esp in DEVOLVE ? '—' : PODER_VAR[g.esp] ? 'var.' : g.pw}</span><span class='ge-num'>${g.ac ? g.ac + '%' : '—'}</span><em>${extrasHtml(p, g)}</em></div>`;
    }).join('');
  }
  function editorHtml() {
    var p = P[S.ge.id], todos = aprende(p), tipos = [];
    todos.forEach(function (g) { if (tipos.indexOf(g.t) < 0) { tipos.push(g.t); } });
    tipos.sort(function (a, b) { return K.TIPOS.indexOf(a) - K.TIPOS.indexOf(b); });
    var slots = [0, 1, 2, 3].map(function (i) {
      var g = GR[S.ge.ids[i]];
      return g ? `<div class='ge-sl' data-acao='geToggle' data-g='${g.id}' style='--c:${corTipo(g.t)}'>${icone(g.t, 20)}<b>${esc(g.nome)}</b><span>${g.c === 'F' ? 'Físico · ' + g.pw : g.c === 'E' ? 'Especial · ' + g.pw : 'Estado'}</span><i>×</i></div>`
        : `<div class='ge-sl vazio'><span>Golpe ${i + 1}</span></div>`;
    }).join('');
    var chips = `<span class='gc${S.ge.tipo ? '' : ' on'}' data-acao='geTipo' data-t=''>Todos</span>` + tipos.map(function (t) {
      return `<span class='tc${S.ge.tipo === t ? ' on' : ''}' data-acao='geTipo' data-t='${t}' title='${nomeTipo(t)}' style='--c:${corTipo(t)}'>${icone(t, 20)}</span>`;
    }).join('');
    var cats = [['', 'Todos'], ['F', 'Físicos'], ['E', 'Especiais'], ['S', 'Estado']].map(function (c) {
      return `<span class='gc${S.ge.cat === c[0] ? ' on' : ''}' data-acao='geCat' data-c='${c[0]}'>${c[1]}</span>`;
    }).join('');
    var aba = S.ge.aba === 'nat';
    var abas = `<div class='ge-abas'><span class='${aba ? '' : 'on'}' data-acao='geAba' data-a='golpes'>⚔ Golpes</span><span class='${aba ? 'on' : ''}' data-acao='geAba' data-a='nat'>✦ Nature e habilidade</span></div>`;
    var topo = `<div class='ge-topo'><div class='ge-arte'>${K.img([K.URL.home(p.id), K.URL.sprite(p.id)])}</div>
        <div class='ge-tit'><b>${esc(p.nome)}</b><div class='sl-tipos'>${p.t.map(K.chip).join('')}</div>
        <span>Nv. ${nivelDe(p)} · Ataque ${p.b.atk} · Atq. Esp. ${p.b.spa} · ${todos.length} golpes</span></div>
        ${abas}<div class='bt bt-sec ge-x' data-acao='geFechar'>✕</div></div>`;
    if (aba) {
      return `<div class='ge'><div class='ge-box' style='--c:${corTipo(p.t[0])}'>${topo}${natHabHtml(p)}
      <div class='ge-rodape'><span class='pv-dica'>Verde = benéfica para este Pokémon · cinzento = neutra · vermelho = prejudicial</span>
        <div class='bt bt-sec' data-acao='geNatAuto'>🎲 Escolha automática</div>
        <div class='bt bt-go${S.ge.ids.length ? '' : ' off'}' data-acao='geOk'>✓ Concluir</div></div>
    </div></div>`;
    }
    return `<div class='ge'><div class='ge-box' style='--c:${corTipo(p.t[0])}'>${topo}
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
  function natHabHtml(p) {
    var gs = S.ge.ids.map(function (i) { return GR[i]; }).filter(Boolean);
    if (!gs.length) { gs = golpesDe(p); }
    var auto = S.ge.nat == null, n = auto ? natAuto(p, gs) : S.ge.nat, nv = nivelDe(p);
    var cab = `<span></span>` + ORDEM_NAT.map(function (k) { return `<span class='gn-cab'>▼ ${CURTO_ATR[k]}</span>`; }).join('');
    var linhas = ORDEM_NAT.map(function (ks, r) {
      return `<span class='gn-cab gn-lin'>▲ ${CURTO_ATR[ks]}</span>` + ORDEM_NAT.map(function (kd, c) {
        var i = r * 5 + c;
        return `<div class='gn-c ${classeNat(i, p, gs)}${i === n ? ' on' : ''}' data-acao='geNat' data-n='${i}'>${NATURES[i].nome}</div>`;
      }).join('');
    }).join('');
    var stN = statusDe(p.b, nv, n), st0 = statusDe(p.b, nv, 0);
    var stats = [['hp', 'Vida'], ['atk', 'Ataque'], ['def', 'Defesa'], ['spa', 'Atq. Esp.'], ['spd', 'Def. Esp.'], ['spe', 'Velocidade']].map(function (x) {
      var k = x[0], seta = NATURES[n].sobe === k ? "<i class='nat-up'>▲</i>" : NATURES[n].desce === k ? "<i class='nat-dn'>▼</i>" : '<i></i>';
      var dif = stN[k] - st0[k];
      return `<div class='gn-st'><span>${x[1]}</span><em>${p.b[k]}</em><b class='${dif > 0 ? 'up' : dif < 0 ? 'dn' : ''}'>${stN[k]}</b>${seta}</div>`;
    }).join('');
    var cls = classeNat(n, p, gs), hl = habsDe(p), hAt = S.ge.hab != null && hl[S.ge.hab] ? S.ge.hab : habAuto(p);
    var habs = hl.length ? hl.map(function (h, i) {
      var info = HAB_INFO[h.slug];
      return `<div class='gh-c${i === hAt ? ' on' : ''}${info ? '' : ' sem'}' data-acao='geHab' data-h='${i}'><b>${esc(h.nome)}${h.oculta ? ' <i>oculta</i>' : ''}</b>
        <span>${info ? esc(info[1]) : 'Sem efeito na Arena (depende de clima, estados ou terrenos, que aqui não existem)'}</span></div>`;
    }).join('') : `<div class='cd-mais'>Sem habilidades conhecidas</div>`;
    return `<div class='gn'>
      <div class='gn-esq'><div class='gn-tit'>NATURE <span>a linha sobe 10% · a coluna desce 10%</span></div><div class='gn-grade'>${cab}${linhas}</div></div>
      <div class='gn-dir'><div class='gn-tit'>ATRIBUTOS NO NÍVEL ${nv}</div>
        <div class='gn-nome'><b>${NATURES[n].nome}</b><span class='gn-rot ${cls}'>${ROTULO_NAT[cls]}</span>${auto ? '<small>automática</small>' : ''}</div>
        <div class='gn-sts'><div class='gn-st gn-st-cab'><span></span><em>base</em><b>final</b><i></i></div>${stats}</div></div>
    </div>
    <div class='gn-tit'>HABILIDADE ${S.ge.hab == null ? '<span>automática: a mais útil na Arena</span>' : ''}</div>
    <div class='gh'>${habs}</div>`;
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
    var h = hab(m);
    if (h === 'truant') { out.push(`<i class='hab'>${m.descansa ? '😴 vai preguiçar' : '😴 Truant'}</i>`); }
    else if (h === 'slow-start') { out.push(`<i class='hab'>${lentoAtivo(m) ? '🐢 Slow Start ' + m.turnos + '/5' : '🐢 em força'}</i>`); }
    else if (h) { out.push(`<i class='hab${HAB_INFO[h] ? '' : ' sem'}' title='${esc(HAB_INFO[h] ? HAB_INFO[h][1] : 'sem efeito na Arena')}'>✦ ${esc(nomeHab(h))}${m.flash ? ' 🔥' : ''}</i>`); }
    if (m.preso) { out.push(`<i class='hab'>🔒 ${esc(m.golpes[m.preso.idx].nome)}</i>`); }
    if (m.estado) { out.push(`<i class='st st-${m.estado}'>${NOME_EST[m.estado]}</i>`); }
    if (m.conf > 0) { out.push(`<i class='st st-conf'>💫 Confuso</i>`); }
    if (m.sub > 0) { out.push(`<i class='hab'>🧸 Substituto ${m.sub}</i>`); }
    if (m.semente) { out.push(`<i class='st st-semente'>🌱 Semente</i>`); }
    if (m.provocado > 0) { out.push(`<i class='st st-conf'>😤 Provocado ${m.provocado}</i>`); }
    var rk = riscoDe(m);
    if (rk) {
      if (rk.rochas) { out.push(`<i class='risco'>🪨 Pedras</i>`); }
      if (rk.picos) { out.push(`<i class='risco'>📌 Spikes ×${rk.picos}</i>`); }
      if (rk.toxicos) { out.push(`<i class='risco'>☠️ Picos venenosos ×${rk.toxicos}</i>`); }
      if (rk.teia) { out.push(`<i class='risco'>🕸️ Teia</i>`); }
    }
    var tl = telaDe(m);
    if (tl) { if (tl.reflect) { out.push(`<i class='tela'>🧱 Reflect ${tl.reflect}</i>`); } if (tl.luz) { out.push(`<i class='tela'>✨ Light Screen ${tl.luz}</i>`); } if (tl.veu) { out.push(`<i class='tela'>🌌 Aurora Veil ${tl.veu}</i>`); } }
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
          <img src='${K.URL.sprite(x.p.id)}'/><div><b>${esc(x.p.nome)}${x.estado && x.hp > 0 ? ` <em class='st-mini st-${x.estado}'>${CURTO_EST[x.estado]}</em>` : ''}</b><div class='hp mini'><div class='hp-f ${hpClasse(x)}' style='width:${100 * x.hp / x.hpMax}%'></div></div></div></div>`;
      }).join('');
    }
    return `<div class='carta carta-${lado}' style='--c:${corTipo(p.t[0])}'>
      <div class='carta-rot'>${lado === 'j' ? 'VOCÊ' : 'OPONENTE'}</div>
      <div class='carta-arte'><div class='holo'></div>${K.img([K.URL.arte(p.id), K.URL.home(p.id)])}</div>
      <div class='carta-nome'>${esc(p.nome)}</div><div class='carta-tipos'>${p.t.map(K.chip).join('')}</div>
      <div class='carta-nh'>${lado === 'j' || !emOnline() ? `<i class='nat-pt ${classeNat(m.nat, m.base || p, m.golpesBase || m.golpes)}'></i>${NATURES[m.nat].nome} · ` : ''}✦ ${esc(nomeHab(hab(m)) || '—')}</div>
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
      var semPP = !(eu.pp[i] > 0), bloqueado = (eu.preso && eu.preso.idx !== i) || (eu.provocado > 0 && g.c === 'S');
      var e = efTotal(g.t, foe.p);
      var tag = g.c === 'S' ? (falhaEstado(eu, foe, g) ? ['nul', 'sem efeito'] : ['est', alvoAdversario(g) || RISCO[g.esp] ? 'no adversário' : g.esp === 'haze' || g.esp === 'defog' || g.esp === 'limpar' ? 'no campo' : 'em si']) :
        e === 0 ? ['nul', 'sem efeito'] : e >= 2 ? ['sup', 'super efetivo ×' + e] : e < 1 ? ['pou', 'pouco efetivo ×' + K.fmtEf(e)] : ['nor', 'normal'];
      var desc = g.c === 'S' ? `Estado · ${g.ac ? g.ac + '%' : 'nunca falha'}${prioGolpe(eu, g) > 0 ? ' · ⚡ prioridade' : ''}${efeitoTexto(g)}` : null;
      return `<div class='gp${trava || semPP || bloqueado ? ' off' : ''}${eu.preso && !bloqueado ? ' preso' : ''}' data-acao='golpe' data-i='${i}' style='--c:${corTipo(g.t)}'>
        <div class='gp-ico'>${icone(g.t, 30)}</div><small class='gp-pp${eu.pp[i] <= 2 ? ' pouco' : ''}'>PP ${eu.pp[i]}/${g.pp || 10}</small>
        <div class='gp-tx'><b>${eu.preso && !bloqueado ? '🔒 ' : ''}${esc(g.nome)}</b><span>${desc != null ? desc : `${g.c === 'F' ? 'Físico' : 'Especial'} · Poder ${g.esp === 'hp' ? poderDe(eu, g) + ' (cai com o HP)' : g.esp in DEVOLVE ? '—' : PODER_VAR[g.esp] ? poderDe(eu, g, foe) + ' (agora)' : g.pw}`}${desc != null ? '' : `${g.hmax > 1 ? ' ×' + (g.hmin === g.hmax ? g.hmin : g.hmin + '–' + g.hmax) : ''} · ${g.ac ? g.ac + '%' : 'nunca erra'}${g.pr > 0 ? ' · ⚡ prioridade' : ''}${g.dr > 0 ? ' · drena' : g.dr < 0 ? ' · recuo' : ''}${efeitoTexto(g)}${g.esp === 'furia' ? ' · prende 2-3 turnos' : ''}`}</span></div>
        <em class='ef ef-${tag[0]}'>${tag[1]}</em></div>`;
    }).join('');
  }
  var TXT_ESP = { sol: ' · sol por 5 turnos', chuva: ' · chuva por 5 turnos', areia: ' · tempestade de areia por 5 turnos', neve: ' · neve por 5 turnos',
    't-eletrico': ' · terreno Elétrico', 't-planta': ' · terreno de Planta', 't-psiquico': ' · terreno Psíquico', 't-nevoa': ' · terreno de Névoa',
    rest: ' · dorme 2 turnos e recupera tudo', proteger: ' · protege-se neste turno', 'escudo-rei': ' · protege-se; quem lhe toca: ATQ -1',
    espinhos: ' · protege-se; quem lhe toca perde 1/8', bunker: ' · protege-se; quem lhe toca fica envenenado', seda: ' · protege-se; quem lhe toca: VEL -1',
    muralha: ' · protege-se; quem lhe toca fica queimado', obstruir: ' · protege-se; quem lhe toca: DEF -2', aguentar: ' · aguenta qualquer golpe com 1 HP',
    reflect: ' · físicos a metade no teu lado (5 turnos)', 'light-screen': ' · especiais a metade no teu lado (5 turnos)',
    aurora: ' · tudo a metade no teu lado (5 turnos, só com neve)', substituto: ' · gasta 1/4 do HP num substituto',
    haze: ' · apaga as mudanças de atributos dos dois', taunt: ' · o alvo só pode usar golpes de dano (3 turnos)',
    roar: ' · obriga o adversário a trocar', semente: ' · rouba 1/8 do HP do alvo por turno',
    rochas: ' · pedras que ferem quem entra do lado do adversário', picos: ' · picos que ferem quem entra (até 3 camadas)',
    'picos-toxicos': ' · envenena quem entra (2 camadas: tóxico)', teia: ' · quem entra perde Velocidade',
    defog: ' · limpa armadilhas, barreiras do adversário e terreno', limpar: ' · limpa armadilhas e substitutos',
    giro: ' · livra-se das armadilhas do seu lado', arrastar: ' · obriga o alvo a trocar',
    resposta: ' · só resulta se o alvo for atacar', mao: ' · só resulta se o alvo for usar um golpe com prioridade', primeiro: ' · só no 1.º turno em campo',
    finta: ' · fura o Protect', psyshock: ' · atinge a Defesa física', 'body-press': ' · usa a Defesa de quem ataca', 'foul-play': ' · usa o Ataque do alvo',
    'ignora-est': ' · ignora as subidas de defesa do alvo', quebra: ' · ignora as habilidades do alvo', 'giro-bola': ' · mais forte se for mais lento',
    'electro-bola': ' · mais forte se for mais rápido', 'peso-alvo': ' · mais forte contra Pokémon pesados', 'peso-razao': ' · mais forte se pesar mais que o alvo',
    reversal: ' · mais forte com pouco HP', 'hp-alvo': ' · mais forte com o alvo de HP cheio', subidas: ' · +20 de poder por cada subida de atributo',
    castigo: ' · mais forte contra quem subiu atributos',
    counter: ' · devolve a dobrar o dano físico recebido', mirror: ' · devolve a dobrar o dano especial recebido', metal: ' · devolve ×1,5 o dano recebido', 'cura-sol': ' · recupera 50% (mais com sol)', 'cura-areia': ' · recupera 50% (mais com areia)' };
  function efeitoTexto(g) {
    if (g.c === 'S') {
      return (g.ef ? efeitoEstagios(g).replace(' (100%)', '') : '') + (g.st ? ` · ${VERBO_EST[g.st[0]]}` : '') + (g.cura ? ` · recupera ${g.cura}% do HP` : '') + (TXT_ESP[g.esp] || '');
    }
    if (g.esp in DEVOLVE) { return TXT_ESP[g.esp]; }
    var extra = (g.c !== 'S' && TXT_ESP[g.esp] ? TXT_ESP[g.esp] : '') + (g.st ? ` · ${g.st[1] >= 100 ? '' : g.st[1] + '% '}${VERBO_EST[g.st[0]]}` : '') + (g.fl ? ` · ${g.fl}% recuar` : '') +
      (g.nome === 'Facade' ? ' · ×2 com estado próprio' : '') + (g.nome === 'Hex' || g.nome === 'Infernal Parade' ? ' · ×2 se o alvo tiver estado' : '') +
      (g.nome === 'Venoshock' || g.nome === 'Barb Barrage' ? ' · ×2 se o alvo estiver envenenado' : '');
    if (!g.ef) { return extra; }
    return efeitoEstagios(g) + extra;
  }
  function efeitoEstagios(g) {
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
      <div class='campo-luz'></div><div class='terreno-fx ${B.campo && B.campo.terreno ? B.campo.terreno : ''}' id='ar-terreno-fx'></div><div class='clima-fx ${B.campo && B.campo.clima ? B.campo.clima : ''}' id='ar-clima-fx'></div><div class='diag'></div>
      <div class='clima-tag' id='ar-clima'>${climaHtml()}</div>
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
    a.agiu = true;
    var P0 = [], pode = antesDeAgir(a, P0);
    await mostrarPassos(P0);
    if (!pode) { if (a.hp <= 0) { await desmaiar(lado); return 'eu'; } await esperar(300); return false; }
    var uso = golpeEfetivo(a, idx, d);
    if (uso.provocado) {
      mensagem(`<b>${quem}</b> está provocado e não pode usar ${esc(uso.g.nome)}!`); registrar(`<b>${esc(a.p.nome)}</b> não pode usar ${esc(uso.g.nome)} (provocado).`);
      await esperar(900); return false;
    }
    if (uso.descansa) {
      mensagem(`<b>${quem}</b> está a preguiçar...`); registrar(`<b>${esc(a.p.nome)}</b> está a preguiçar (Truant).`);
      await esperar(900); return false;
    }
    var g = uso.g;
    if (g.luta) { registrar(`<b>${esc(a.p.nome)}</b> já não tem PP!`); }
    mensagem(`<b>${quem}</b> usou <span style='color:${corTipo(g.t)}'>${esc(g.nome)}</span>!`);
    registrar(`<b>${esc(a.p.nome)}</b> usou <span style='color:${corTipo(g.t)}'>${esc(g.nome)}</span>`);
    await esperar(350);
    if (g.c === 'S') {
      if (alvoAdversario(g)) { await animarAtaque(lado, foe, g); } else { var eu0 = $('mon-' + lado); if (eu0) { eu0.classList.remove('entra'); void eu0.offsetWidth; eu0.classList.add('entra'); } await esperar(400); }
      var PE = []; usarEstado(a, d, g, PE); var trE = extrairTroca(PE); await mostrarPassos(PE); atualizarHud(); await esperar(300);
      if (trE) { await arrastar(foe, trE.idx); }
      return false;
    }
    var PB = [];
    if (bloqueadoPorProtecao(a, d, g, PB)) { await mostrarPassos(PB); atualizarHud(); return false; }
    partirBarreiras(a, d, g, PB); await mostrarPassos(PB);
    await animarAtaque(lado, foe, g);
    var r = calcular(a, d, g);
    if (r.erro || r.ef === 0) {
      var ev0 = efeitosDepois(a, d, g, r, 0, uso.idx);
      if (r.falhou) { mensagem('Mas falhou!'); registrar('Mas falhou!'); await esperar(650); }
      else if (r.erro) { textoFx('ERROU!', 'erro', foe); mensagem('Mas errou!'); registrar('Errou!'); await esperar(650); }
      else if (r.bloq) { await mostrarPassos(ev0.passos); }
      else { bannerFx('NÃO AFETA', 'nul'); mensagem(`Não afeta ${esc(d.p.nome)}...`); registrar('Não afetou.'); await esperar(800); }
      return false;
    }
    var PS = [], ns = noSubstituto(a, d, g, r, PS);
    if (ns >= 0) {
      textoFx('-' + ns, 'num', foe); await mostrarPassos(PS);
      var evs = efeitosDepois(a, d, g, r, ns, uso.idx); await mostrarPassos(evs.passos); atualizarHud();
      if (evs.cansou) { registrar(`<b>${esc(a.p.nome)}</b> acalmou-se.`); }
      return false;
    }
    impacto(foe, g.t, r.ef >= 2 || r.crit);
    var hpAntes = d.hp;
    d.hp = Math.max(0, d.hp - r.dano);
    var mon = $('mon-' + foe); if (mon) { mon.classList.remove('dano'); void mon.offsetWidth; mon.classList.add('dano'); }
    textoFx('-' + r.dano, 'num' + (r.ef >= 2 ? ' sup' : ''), foe);
    if (r.crit) { setTimeout(function () { textoFx('CRÍTICO!', 'crit', foe); }, 150); registrar(`<i class='crit'>Golpe crítico!</i>`); }
    if (r.fixo) { /* dano devolvido: sem efetividade */ }
    else if (r.ef >= 2) { bannerFx('SUPER EFETIVO!', 'sup'); registrar(`<i class='sup'>Foi super efetivo! (×${r.ef})</i>`); }
    else if (r.ef < 1) { bannerFx('pouco efetivo...', 'pou'); registrar(`<i class='pou'>Não foi muito efetivo...</i>`); }
    await animarHp(foe, d);
    if (r.acertos > 1) { registrar(`Acertou ${r.acertos} vezes!`); }
    var ev = efeitosDepois(a, d, g, r, hpAntes - d.hp, uso.idx), trD = extrairTroca(ev.passos);
    await mostrarPassos(ev.passos);
    if (ev.cansou) { registrar(`<b>${esc(a.p.nome)}</b> acalmou-se.`); }
    if (d.hp <= 0) {
      await desmaiar(foe);
      var antes = evoluir(a);
      if (antes) { await animarEvolucao(lado, antes, a); }
      return 'alvo';
    }
    if (trD) { await arrastar(foe, trD.idx); }
    return false;
  }
  /* Roar, Whirlwind, Dragon Tail: o alvo é trocado e o novo não age neste turno */
  async function arrastar(lado, idx) {
    var sai = $('mon-' + lado); if (sai) { sai.classList.add('sai'); }
    await esperar(400);
    S.B.campo.arrastado[lado] = true;
    await entrar(lado, idx);
  }
  async function desmaiar(lado) {
    var m = ativo(S.B[lado]), mon = $('mon-' + lado);
    if (mon) { mon.classList.add('desmaio'); }
    mensagem(`<b>${esc(m.p.nome)}</b> desmaiou!`); registrar(`<b>${esc(m.p.nome)}</b> desmaiou!`);
    await esperar(1000);
  }
  /* mostra os passos das regras (habilidades, atributos, HP) um a um */
  function ladoDe(m) { return S.B.j.time.indexOf(m) >= 0 ? 'j' : 'o'; }
  function climaHtml() {
    var c = S.B && S.B.campo; if (!c) { return ''; }
    var t = function (n) { return n + ' ' + (n === 1 ? 'turno' : 'turnos'); };
    return (c.clima ? `<span>${NOME_CLIMA[c.clima]} · ${t(c.turnos)}${clima(ativo(S.B.j)) ? '' : ' · anulado'}</span>` : '') +
      (c.terreno ? `<span class='terreno-tag ${c.terreno}'>${NOME_TERRENO[c.terreno]} · ${t(c.tturnos)}</span>` : '');
  }
  function atualizarHud() {
    var cx = $('ar-clima'), fx = $('ar-clima-fx');
    if (cx) { cx.innerHTML = climaHtml(); }
    if (fx) { fx.className = 'clima-fx ' + ((S.B.campo && S.B.campo.clima) || ''); }
    var tf = $('ar-terreno-fx'); if (tf) { tf.className = 'terreno-fx ' + ((S.B.campo && S.B.campo.terreno) || ''); }
    var h = $('ar-palco'); if (!h) { return; }
    var est = h.querySelectorAll('.hud-est');
    if (est[0]) { est[0].innerHTML = estHtml(ativo(S.B.j)); } if (est[1]) { est[1].innerHTML = estHtml(ativo(S.B.o)); }
  }
  function estTexto(x) {
    var nome = esc(x.m.p.nome), atr = NOME_ATR[x.k];
    if (!x.d) { return `${atr} de <b>${nome}</b> não pode ${x.pedido > 0 ? 'subir' : 'baixar'} mais.`; }
    return `${atr} de <b>${nome}</b>${x.d > 0 ? ' subiu' : ' baixou'}${Math.abs(x.d) >= 2 ? ' muito' : ''}!`;
  }
  async function mostrarPassos(P) {
    for (var i = 0; i < P.length; i++) {
      var x = P[i], lado = x.m ? ladoDe(x.m) : 'j';
      if (x.tipo === 'hab') {
        textoFx(x.nome, 'hab', lado); registrar(`<i class='hab-tx'>✦ ${esc(x.nome)}</i> de <b>${esc(x.m.p.nome)}</b>`);
        mensagem(`✦ <b>${esc(x.nome)}</b> de ${esc(x.m.p.nome)}`); await esperar(650);
      } else if (x.tipo === 'est') {
        var t = estTexto(x); registrar(t); mensagem(t);
        if (x.d) { textoFx(CURTO_ATR[x.k] + (x.d > 0 ? ' ↑' : ' ↓'), x.d > 0 ? 'num cura' : 'num', lado); }
        atualizarHud(); await esperar(550);
      } else if (x.tipo === 'hp') {
        textoFx((x.d > 0 ? '+' : '') + x.d, x.d > 0 ? 'num cura' : 'num', lado); registrar(x.txt); mensagem(x.txt);
        if (ativo(S.B[lado]) === x.m) { await animarHp(lado, x.m); } else { await esperar(500); }
      } else { registrar(x.txt); mensagem(x.txt); atualizarHud(); await esperar(600); }
    }
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
    var saida = []; sairDeCampo(velho, saida);
    if (saida.length) { await mostrarPassos(saida); }
    B[lado].ativo = idx;
    var nome = esc(ativo(B[lado]).p.nome);
    S.msg = lado === 'j' ? `Vai, <b>${nome}</b>!` : `O oponente enviou <b>${nome}</b>!`;
    registrar(S.msg);
    render();
    var mon = $('mon-' + lado); if (mon) { mon.classList.add('entra'); }
    await esperar(700);
    await mostrarPassos(aoEntrar(ativo(B[lado]), ativo(B[lado === 'j' ? 'o' : 'j']), []));
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
    limparTurno(B);
    var acaoO = iaAcao(B.o, B.j);
    B.campo.acoes = { j: acaoJ, o: acaoO };
    var acoes = ordem(B, acaoJ, acaoO);
    for (var k = 0; k < acoes.length; k++) {
      var lado = acoes[k].lado, ac = acoes[k].a;
      if (ac.tipo === 'troca') {
        mensagem(lado === 'j' ? `<b>${esc(ativo(B.j).p.nome)}</b>, volte!` : `O oponente recolheu <b>${esc(ativo(B.o).p.nome)}</b>.`);
        var sai = $('mon-' + lado); if (sai) { sai.classList.add('sai'); }
        await esperar(450);
        await entrar(lado, ac.idx); ativo(B[lado]).agiu = true; continue;
      }
      if (ativo(B[lado]).hp <= 0 || B.campo.arrastado[lado]) { continue; }
      var ko = await usarGolpe(lado, ac.idx);
      if (ko) { if (await aposDesmaio(ko === 'eu' ? lado : lado === 'j' ? 'o' : 'j')) { return; } break; }
    }
    await mostrarPassos(fimTurnoClima(B, ['j', 'o']));
    await mostrarPassos(fimTurnoTerreno(B, ['j', 'o']));
    await mostrarPassos(fimTurnoBarreiras(B, ['j', 'o']));
    await mostrarPassos(fimTurnoEstado(B, ['j', 'o']));
    for (var lg of ['j', 'o']) {
      var mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      await mostrarPassos(fimTurnoLado(B[lg]));
    }
    // quem desmaiou com a queimadura ou o veneno (o oponente troca primeiro)
    for (var lk of ['o', 'j']) {
      if (ativo(B[lk]).hp <= 0) { await desmaiar(lk); if (await aposDesmaio(lk)) { return; } }
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
    S.B = ligarCampo({ j: novoLado(S.time.j, S.mv.j, itensDoTime('j'), extrasDo('j')), o: novoLado(S.time.o, S.mv.o, itensDoTime('o'), extrasDo('o')) });
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
    // habilidades de entrada (online pela ordem canónica: anfitrião primeiro)
    var ordemEntrada = online ? (online.host ? ['j', 'o'] : ['o', 'j']) : ['j', 'o'];
    for (var oe = 0; oe < 2; oe++) { var le = ordemEntrada[oe]; await mostrarPassos(aoEntrar(ativo(S.B[le]), ativo(S.B[le === 'j' ? 'o' : 'j']), [])); }
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
    limparTurno(B);
    B.campo.acoes = { j: aj, o: ao };
    var acoes = ordem(B, aj, ao);
    for (var k = 0; k < acoes.length; k++) {
      var lado = acoes[k].lado, ac = acoes[k].a;
      if (ac.tipo === 'troca') {
        mensagem(lado === 'j' ? `<b>${esc(ativo(B.j).p.nome)}</b>, volte!` : `O oponente recolheu <b>${esc(ativo(B.o).p.nome)}</b>.`);
        var sai = $('mon-' + lado); if (sai) { sai.classList.add('sai'); }
        await esperar(450);
        await entrar(lado, ac.idx); ativo(B[lado]).agiu = true; continue;
      }
      if (ativo(B[lado]).hp <= 0 || B.campo.arrastado[lado]) { continue; }
      var ko = await usarGolpe(lado, ac.idx);
      if (ko) { if (await aposDesmaioOnline(ko === 'eu' ? lado : lado === 'j' ? 'o' : 'j', n)) { fecharTurno(n); return; } break; }
    }
    await mostrarPassos(fimTurnoClima(B, lados));
    await mostrarPassos(fimTurnoTerreno(B, lados));
    await mostrarPassos(fimTurnoBarreiras(B, lados));
    await mostrarPassos(fimTurnoEstado(B, lados));
    for (var g = 0; g < 2; g++) {
      var lg = lados[g], mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      await mostrarPassos(fimTurnoLado(B[lg]));
    }
    for (var gk = 0; gk < 2; gk++) {
      var lk = lados[gk];
      if (ativo(B[lk]).hp <= 0) { await desmaiar(lk); if (await aposDesmaioOnline(lk, n)) { fecharTurno(n); return; } }
    }
    fecharTurno(n);
    S.ocupado = false; S.msg = p.deles[p.turno] ? msgVez() + ' <i>(o adversário já escolheu)</i>' : msgVez(); render();
    return resolverOnline();
  }
  /* fim do turno: avança o contador e compara o estado com o do outro lado */
  function fecharTurno(n) {
    var p = S.on.p, B = S.B, resumo = ladosCanonicos().map(function (l) {
      return B[l].ativo + ':' + B[l].time.map(function (m) { return m.hp + '/' + m.pp.join('.') + '/' + m.p.id + '/' + m.nat + '/' + (m.estado || '-'); }).join(',') + ':' + JSON.stringify(ativo(B[l]).est) + ':' + hab(ativo(B[l])) + ':' + ativo(B[l]).conf + ':' + (ativo(B[l]).sub || 0) + ':' + JSON.stringify(B.campo.tela[l]) + ':' + JSON.stringify(B.campo.risco[l]) + ':' + (ativo(B[l]).semente ? 1 : 0) + (ativo(B[l]).provocado || 0);
    }).join('|') + '|' + (B.campo.clima || '-') + B.campo.turnos + '|' + (B.campo.terreno || '-') + B.campo.tturnos;
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
    var pp = S.on.p, seq = pp.koSeq[n] = (pp.koSeq[n] || 0) + 1;
    n = n * 8 + seq - 1;
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
      mv: { host: golpesDoTime(S.time.j, S.mv.j), conv: S.on.opMv || {} }, itens: { host: itensDoTime('j'), conv: S.on.opItens || {} },
      nat: { host: doTime('j', S.nat), conv: S.on.opNat || {} }, hab: { host: doTime('j', S.hab), conv: S.on.opHab || {} } };
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
    var na = cfg.nat || {}, hb = cfg.hab || {};
    S.nat.j = limparNat(host ? na.host : na.conv); S.nat.o = limparNat(host ? na.conv : na.host);
    S.hab.j = limparHab(host ? hb.host : hb.conv); S.hab.o = limparHab(host ? hb.conv : hb.host);
    S.ge = null;
    S.on.host = host; S.on.pronto = S.on.opPronto = false; S.on.p = novaPartida();
    rng = mulberry32(cfg.semente);
    S.auto = false; S.sim = null;
  }
  function voltarSala(avisarOutro) {
    if (avisarOutro && emOnline()) { NET.enviar({ t: 'sala' }); }
    rng = Math.random;
    S.tela = 'selecao'; S.B = null; S.fim = null; S.escolha = null; S.ocupado = false; S.auto = false;
    S.time.o = []; S.mv.o = {}; S.itens.o = {}; S.nat.o = {}; S.hab.o = {}; S.on.pronto = S.on.opPronto = false; S.on.p = novaPartida();
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
      S.time.j = S.time.j.slice(); S.on.opTime = S.time.o.slice(); S.on.opMv = golpesDoTime(S.time.o, S.mv.o); S.on.opItens = itensDoTime('o'); S.on.opNat = doTime('o', S.nat); S.on.opHab = doTime('o', S.hab);
      comecarOnline();
    }
  }

  /* ================= ONLINE: SALA ================= */
  function golpesDoTime(ids, mv) {
    var out = {};
    ids.forEach(function (id) { if (mv[id]) { out[id] = mv[id].slice(0, 4); } });
    return out;
  }
  /* golpes recebidos do outro lado: nomes válidos (números de versões antigas são convertidos) */
  function limparGolpes(mv) { return converterMv(mv); }
  function ligadoOuAusente() { return NET && (NET.estado === 'ligado' || NET.estado === 'ausente'); }
  function caiu() { return NET && (NET.estado === 'caiu' || NET.estado === 'erro' || NET.estado === 'off'); }
  function limparItens(it) {
    var out = {}, n = 0;
    Object.keys(it || {}).forEach(function (id) { if (n < 1 && P[id] && (it[id] === 'mega' || it[id] === 'gmax') && itensPossiveis(P[id]).indexOf(it[id]) >= 0) { out[id] = it[id]; n++; } });
    return out;
  }
  /* nature e habilidade só de quem está no time; o que vem do outro lado é validado */
  function doTime(l, mapa) { var out = {}; S.time[l].forEach(function (id) { if (mapa[l][id] != null) { out[id] = mapa[l][id]; } }); return out; }
  function limparNat(x) { var out = {}; Object.keys(x || {}).forEach(function (id) { if (P[id] && typeof x[id] === 'number' && NATURES[x[id]]) { out[id] = x[id]; } }); return out; }
  function limparHab(x) { var out = {}; Object.keys(x || {}).forEach(function (id) { if (P[id] && typeof x[id] === 'number' && habsDe(P[id])[x[id]]) { out[id] = x[id]; } }); return out; }
  function enviarTime() {
    if (!S.online || !ligadoOuAusente()) { return; }
    NET.enviar({ t: 'time', ids: S.time.j.slice(), mv: golpesDoTime(S.time.j, S.mv.j), itens: itensDoTime('j'), nat: doTime('j', S.nat), hab: doTime('j', S.hab), pronto: S.on.pronto });
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
        S.on.opTime = m.ids || []; S.on.opMv = limparGolpes(m.mv); S.on.opItens = limparItens(m.itens); S.on.opNat = limparNat(m.nat); S.on.opHab = limparHab(m.hab); S.on.opQtd = S.on.opTime.length; S.on.opPronto = !!m.pronto;
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
        S.ge = { lado: l, id: eid, ids: golpesDe(P[eid], S.mv[l][eid]).filter(function (g) { return g.id != null; }).map(function (g) { return g.id; }), busca: '', tipo: '', cat: '',
          aba: 'golpes', nat: S.nat[l][eid] != null ? S.nat[l][eid] : null, hab: S.hab[l][eid] != null ? S.hab[l][eid] : null };
        render(); break;
      case 'geToggle':
        var gid = +el.getAttribute('data-g'), pos = S.ge.ids.indexOf(gid);
        if (pos >= 0) { S.ge.ids.splice(pos, 1); } else if (S.ge.ids.length < 4) { S.ge.ids.push(gid); }
        geAtualizar(); break;
      case 'geTipo': S.ge.tipo = el.getAttribute('data-t'); geAtualizar(); break;
      case 'geCat': S.ge.cat = el.getAttribute('data-c'); geAtualizar(); break;
      case 'geAuto': S.ge.ids = golpesAuto(P[S.ge.id]) || []; geAtualizar(); break;
      case 'geFechar': S.ge = null; render(); break;
      case 'geAba': S.ge.aba = el.getAttribute('data-a'); render(); break;
      case 'geNat': var ni = +el.getAttribute('data-n'); S.ge.nat = S.ge.nat === ni ? null : ni; render(); break;
      case 'geHab': S.ge.hab = +el.getAttribute('data-h'); render(); break;
      case 'geNatAuto': S.ge.nat = null; S.ge.hab = null; render(); break;
      case 'geOk':
        if (S.ge.ids.length) { S.mv[S.ge.lado][S.ge.id] = S.ge.ids.map(function (i) { return GR[i].nome; }); }
        if (S.ge.nat != null) { S.nat[S.ge.lado][S.ge.id] = S.ge.nat; } else { delete S.nat[S.ge.lado][S.ge.id]; }
        if (S.ge.hab != null) { S.hab[S.ge.lado][S.ge.id] = S.ge.hab; } else { delete S.hab[S.ge.lado][S.ge.id]; }
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

  window.__arenaApi = { calibrar: calibrar, nivelDe: nivelDe, nivelFormula: nivelFormula, ehFormaEspecial: ehFormaEspecial, simular: simular, golpesDe: golpesDe, statusDe: statusDe, NATURES: NATURES, natAuto: natAuto, classeNat: classeNat, habsDe: habsDe, habAuto: habAuto, HAB_INFO: HAB_INFO, calcular: calcular, lutador: lutador, ligarCampo: ligarCampo, aoEntrar: aoEntrar, fimTurnoClima: fimTurnoClima, fimTurnoTerreno: fimTurnoTerreno, fimTurnoEstado: fimTurnoEstado, fimTurnoBarreiras: fimTurnoBarreiras, poderDe: poderDe, respostaFalha: respostaFalha, danoBase: danoBase, limparTurno: limparTurno, aplicarRiscos: aplicarRiscos, riscoDe: riscoDe, reservasDe: reservasDe, extrairTroca: extrairTroca, bloqueadoPorProtecao: bloqueadoPorProtecao, noSubstituto: noSubstituto, valorDevolve: valorDevolve, usarEstado: usarEstado, valorEstadoIA: valorEstadoIA, golpesAuto: golpesAuto, converterMv: converterMv, GR_NOME: GR_NOME, aplicarEstado: aplicarEstado, antesDeAgir: antesDeAgir, efeitosDepois: efeitosDepois, tiposDe: tiposDe, prioGolpe: prioGolpe, atributo: atributo, esperado: esperado, clima: clima, opcoesTransformar: opcoesTransformar, aplicarForma: aplicarForma, desfazerGmax: desfazerGmax, novoLado: novoLado };
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
        mv: s.online ? { j: s.mv.j, o: {} } : s.mv, itens: s.online ? { j: s.itens.j, o: {} } : s.itens,
        nat: s.online ? { j: s.nat.j, o: {} } : s.nat, hab: s.online ? { j: s.hab.j, o: {} } : s.hab, busca: s.busca, tipo: s.tipo, gen: s.gen, log: local ? fotoEstavel.log : [],
        msg: local ? fotoEstavel.msg : '', escolha: local ? fotoEstavel.escolha : null, fim: local ? fotoEstavel.fim : null, foto: local ? fotoEstavel.B : null });
    });
  }
  render();
  if (S.auto && S.tela === 'batalha' && !S.ocupado) { proximoAuto(); }
})();
