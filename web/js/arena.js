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
  var VERSAO = D.v + '.' + GR.length + '.r4';
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
    'transistor': [4, 'golpes Elétrico ×1,3'], 'rocky-payload': [4, 'golpes de Pedra ×1,5'], 'water-bubble': [8, 'golpes de Água ×2; Fogo recebido ×0,5'],
    'orichalcum-pulse': [7, 'ao entrar: sol por 5 turnos; com sol, Ataque ×1,33'], 'hadron-engine': [6, 'Atq. Esp. ×1,33'],
    'drought': [5, 'ao entrar: sol por 5 turnos (Fogo ×1,5, Água ×0,5)'], 'drizzle': [5, 'ao entrar: chuva por 5 turnos (Água ×1,5, Fogo ×0,5)'],
    'sand-stream': [4, 'ao entrar: tempestade de areia por 5 turnos (fere 1/16 por turno quem não é Pedra, Terra ou Aço; Pedra com Def. Esp. ×1,5)'],
    'snow-warning': [4, 'ao entrar: neve por 5 turnos (Gelo com Defesa ×1,5)'], 'sand-spit': [3, 'quando é atingido: tempestade de areia por 5 turnos'],
    'swift-swim': [2, 'com chuva, Velocidade ×2'], 'chlorophyll': [2, 'com sol, Velocidade ×2'], 'sand-rush': [2, 'com areia, Velocidade ×2; imune à areia'],
    'slush-rush': [2, 'com neve, Velocidade ×2'], 'solar-power': [2, 'com sol, Atq. Esp. ×1,5, mas perde 1/8 do HP por turno'],
    'sand-force': [2, 'com areia, golpes de Pedra, Terra e Aço ×1,3; imune à areia'], 'sand-veil': [1, 'com areia, o adversário acerta menos (precisão ×0,8); imune à areia'],
    'snow-cloak': [1, 'com neve, o adversário acerta menos (precisão ×0,8)'], 'rain-dish': [1, 'com chuva, recupera 1/16 do HP por turno'],
    'ice-body': [1, 'com neve, recupera 1/16 do HP por turno'], 'flower-gift': [2, 'com sol, Ataque e Def. Esp. ×1,5'],
    'protosynthesis': [3, 'com sol, o melhor atributo ×1,3 (Velocidade ×1,5)'], 'overcoat': [1, 'imune ao dano da areia'],
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
    'inner-focus': [1, 'imune a Intimidate'], 'oblivious': [1, 'imune a Intimidate'], 'own-tempo': [1, 'imune a Intimidate'],
    'guard-dog': [3, 'Intimidate sobe-lhe o Ataque em vez de baixar'],
    'magic-guard': [4, 'só perde HP com golpes (sem recuo nem dano de habilidades)'], 'rock-head': [3, 'sem recuo dos golpes'],
    'liquid-ooze': [2, 'quem o drena perde HP em vez de recuperar'], 'shield-dust': [2, 'protegido dos efeitos secundários'],
    'battle-armor': [2, 'não sofre golpes críticos'], 'shell-armor': [2, 'não sofre golpes críticos'],
    'levitate': [5, 'imune a golpes de Terra'], 'flash-fire': [5, 'imune a Fogo; depois disso, os golpes de Fogo dele ×1,5'],
    'water-absorb': [5, 'imune a Água e recupera 1/4 do HP'], 'volt-absorb': [5, 'imune a Elétrico e recupera 1/4 do HP'],
    'dry-skin': [3, 'imune a Água (recupera 1/4 do HP); Fogo recebido ×1,25; com chuva recupera 1/8 por turno, com sol perde 1/8'], 'earth-eater': [5, 'imune a Terra e recupera 1/4 do HP'],
    'lightning-rod': [5, 'imune a Elétrico; Atq. Esp. +1'], 'storm-drain': [5, 'imune a Água; Atq. Esp. +1'],
    'motor-drive': [5, 'imune a Elétrico; Velocidade +1'], 'sap-sipper': [5, 'imune a Planta; Ataque +1'], 'well-baked-body': [5, 'imune a Fogo; Defesa +2'],
    'wonder-guard': [8, 'só os golpes super efetivos lhe acertam'], 'bulletproof': [3, 'imune a bombas e esferas'], 'soundproof': [3, 'imune a golpes sonoros'],
    'dazzling': [3, 'imune a golpes com prioridade'], 'queenly-majesty': [3, 'imune a golpes com prioridade'], 'armor-tail': [3, 'imune a golpes com prioridade'],
    'thick-fat': [5, 'Fogo e Gelo recebidos ×0,5'], 'heatproof': [3, 'Fogo recebido ×0,5'], 'purifying-salt': [4, 'Fantasma recebido ×0,5'],
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
  function quebra(a) { var h = hab(a); return h === 'mold-breaker' || h === 'teravolt' || h === 'turboblaze'; }
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
  function secundario(g) { return !!(g.ef && g.ef[1] < 100); }

  /* ---------- clima: sol, chuva, areia e neve, 5 turnos (B.campo, partilhado pelos lutadores dos dois lados) ---------- */
  var CLIMA_DE = { drought: 'sol', 'orichalcum-pulse': 'sol', drizzle: 'chuva', 'sand-stream': 'areia', 'snow-warning': 'neve' };
  var NOME_CLIMA = { sol: '☀️ Sol forte', chuva: '🌧️ Chuva', areia: '🌪️ Tempestade de areia', neve: '❄️ Neve' };
  var TXT_CLIMA = { sol: 'O sol ficou forte!', chuva: 'Começou a chover!', areia: 'Levantou-se uma tempestade de areia!', neve: 'Começou a nevar!' };
  var FIM_CLIMA = { sol: 'O sol voltou ao normal.', chuva: 'A chuva parou.', areia: 'A tempestade de areia acalmou.', neve: 'Parou de nevar.' };
  var CORRE = { 'swift-swim': 'chuva', chlorophyll: 'sol', 'sand-rush': 'areia', 'slush-rush': 'neve' };
  var BOLA = { sol: 'fire', chuva: 'water', areia: 'rock', neve: 'ice' };
  var TEMPESTADE = /^(Thunder|Hurricane|Bleakwind Storm|Wildbolt Storm|Sandsear Storm)$/;
  function ligarCampo(B, c) {
    B.campo = { clima: (c && c.clima) || null, turnos: (c && c.turnos) || 0, B: B };
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
    return m.p.t.some(function (t) { return t === 'rock' || t === 'ground' || t === 'steel'; }) || h === 'sand-veil' || h === 'sand-rush' || h === 'sand-force' || h === 'overcoat' || h === 'magic-guard';
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
      item: item || null, preso: null, descansa: false, turnos: 0, hab: h, habBase: h, habPos: hp, novo: false, flash: false, disfarce: false, usouEntrada: false };
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
  function atributo(m, k, crit, atacando, outro) {
    var s = m.est ? m.est[k] : 0, h = hab(m);
    if (crit && ((atacando && s < 0) || (!atacando && s > 0))) { s = 0; }
    if (outro && hab(outro) === 'unaware') { s = 0; }
    var v = m.st[k] * multEst(s);
    if ((k === 'atk' || k === 'spe') && lentoAtivo(m)) { v *= 0.5; }
    var cl = clima(m);
    if (cl) {
      if (k === 'spe' && CORRE[h] === cl) { v *= 2; }
      if (!atacando && k === 'def' && cl === 'neve' && m.p.t.indexOf('ice') >= 0) { v *= 1.5; }
      if (!atacando && k === 'spd' && cl === 'areia' && m.p.t.indexOf('rock') >= 0) { v *= 1.5; }
      if (cl === 'sol' && h === 'flower-gift' && ((atacando && k === 'atk') || (!atacando && k === 'spd'))) { v *= 1.5; }
      if (cl === 'sol' && atacando && k === 'spa' && h === 'solar-power') { v *= 1.5; }
      if (cl === 'sol' && h === 'protosynthesis' && melhorAtr(m) === k) { v *= k === 'spe' ? 1.5 : 1.3; }
    }
    if (atacando) {
      if (k === 'atk' && (h === 'huge-power' || h === 'pure-power')) { v *= 2; }
      if (k === 'atk' && h === 'hustle') { v *= 1.5; }
      if ((k === 'atk' && h === 'orichalcum-pulse' && cl === 'sol') || (k === 'spa' && h === 'hadron-engine')) { v *= 4 / 3; }
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
    if (h === 'trace' && foe && foe.hp > 0 && hab(foe) && !NAO_COPIA[hab(foe)]) {
      anunciar(m, P); m.hab = hab(foe); P.push({ tipo: 'txt', txt: `<b>${esc(m.p.nome)}</b> copiou ${esc(nomeHab(m.hab))}!` }); h = m.hab;
    }
    if (CLIMA_DE[h] && m.campo && m.campo.clima !== CLIMA_DE[h]) { anunciar(m, P); mudarClima(m, CLIMA_DE[h], P); }
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
    m.est = zeroEst(); m.preso = null; m.descansa = false; m.turnos = 0; m.flash = false; m.novo = true; m.hab = m.habBase || m.hab;
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
      m.golpes = m.golpesBase.map(function (g) { return { t: g.t, c: g.c, nome: 'Max ' + nomeTipo(g.t), pw: poderMax(g), ac: 0, pr: 0, pp: g.pp, max: true }; });
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
  function poderDe(a, g) { return g.esp === 'hp' ? Math.max(1, Math.floor(150 * a.hp / a.hpMax)) : g.nome === 'Weather Ball' && clima(a) ? 100 : g.pw; }
  /* tipo do golpe depois das habilidades (Pixilate, Liquid Voice...) */
  function tipoDe(a, g) {
    if (g.semTipo || g.max) { return g.t; }
    var h = hab(a);
    if (g.nome === 'Weather Ball' && clima(a)) { return BOLA[clima(a)]; }
    if (PELE[h] && g.t === 'normal') { return PELE[h]; }
    if (h === 'liquid-voice' && SOM.test(g.nome)) { return 'water'; }
    return g.t;
  }
  function efetividade(a, d, g, t) {
    if (g.semTipo) { return 1; }
    var tipos = d.p.t;
    if (hab(a) === 'scrappy' && (t === 'normal' || t === 'fighting')) { tipos = tipos.filter(function (x) { return x !== 'ghost'; }); }
    return K.efTotal(t, tipos);
  }
  function stabDe(a, g, t) {
    if (g.semTipo) { return 1; }
    var h = hab(a);
    if (a.p.t.indexOf(t) < 0 && h !== 'protean' && h !== 'libero') { return 1; }
    return h === 'adaptability' ? 2 : 1.5;
  }
  function prioGolpe(m, g) {
    var h = hab(m), t = tipoDe(m, g);
    return (g.pr || 0) + (h === 'gale-wings' && t === 'flying' && m.hp === m.hpMax ? 1 : 0) + (h === 'triage' && g.dr > 0 ? 3 : 0);
  }
  /* imunidades por habilidade: devolve a habilidade que bloqueou */
  function bloqueio(a, d, g, t, e) {
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
    if (h === 'technician' && poderDe(a, g) <= 60) { m *= 1.5; }
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
    return m;
  }
  function danoBase(a, d, g, crit) {
    var A = atributo(a, g.c === 'F' ? 'atk' : 'spa', crit, true, d), Df = atributo(d, g.c === 'F' ? 'def' : 'spd', crit, false, a);
    return Math.floor(Math.floor(Math.floor(2 * a.nv / 5 + 2) * poderDe(a, g) * A / Df) / 50) + 2;
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
    return ac;
  }
  var CHANCE_CRIT = [1 / 24, 1 / 8, 1 / 2];
  function calcular(a, d, g) {
    var t = tipoDe(a, g), e = efetividade(a, d, g, t), bloq = e === 0 ? '' : bloqueio(a, d, g, t, e);
    if (bloq) { return { erro: false, dano: 0, ef: 0, crit: false, acertos: 0, t: t, bloq: bloq }; }
    var ac = precisaoDe(a, d, g);
    if (!(ac === 0 || rng() * 100 < ac)) { return { erro: true, dano: 0, ef: e, crit: false, acertos: 0, t: t }; }
    var stab = stabDe(a, g, t), nc = Math.min(2, (g.ca || 0) + (hab(a) === 'super-luck' ? 1 : 0));
    var crit = g.ca === 2 || rng() < CHANCE_CRIT[nc], variacao = 0.85 + rng() * 0.15;
    var hd = habAlvo(a, d);
    if (hd === 'battle-armor' || hd === 'shell-armor') { crit = false; }
    var acertos = 1;
    if (g.hmax > 1) {
      var r = rng();
      acertos = hab(a) === 'skill-link' ? g.hmax : g.hmin === 2 && g.hmax === 5 ? (r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5) : g.hmin + Math.floor(r * (g.hmax - g.hmin + 1));
    }
    var dano = e === 0 ? 0 : Math.max(1, Math.floor(danoBase(a, d, g, crit) * stab * e * (crit ? 1.5 : 1) * variacao * multHab(a, d, g, t, e, crit) * multClima(a, g, t))) * acertos;
    var res = { erro: false, dano: dano, ef: e, crit: crit, acertos: acertos, t: t };
    // Disguise / Ice Face: o primeiro golpe não faz (quase) dano; Sturdy: aguenta com 1 HP
    if (dano > 0 && !d.disfarce && (hd === 'disguise' || (hd === 'ice-face' && g.c === 'F'))) {
      res.dano = hd === 'disguise' ? Math.min(d.hp, Math.max(1, Math.floor(d.hpMax / 8))) : 0; res.disfarce = hd;
    } else if (hd === 'sturdy' && d.hp === d.hpMax && dano >= d.hp) { res.dano = d.hp - 1; res.aguentou = true; }
    return res;
  }
  function esperado(a, d, g) {
    var t = tipoDe(a, g), e = efetividade(a, d, g, t);
    if (!e || bloqueio(a, d, g, t, e)) { return 0; }
    var h = hab(a), nc = Math.min(2, (g.ca || 0) + (h === 'super-luck' ? 1 : 0)), hd = habAlvo(a, d);
    var pc = hd === 'battle-armor' || hd === 'shell-armor' ? 0 : g.ca === 2 ? 1 : CHANCE_CRIT[nc], critMedio = 1 + pc * (h === 'sniper' ? 1.25 : 0.5);
    var ac = precisaoDe(a, d, g), hits = g.hmax > 1 && h === 'skill-link' ? g.hmax : acertosMedios(g);
    return danoBase(a, d, g, false) * stabDe(a, g, t) * e * (ac === 0 ? 1 : Math.min(1, ac / 100)) * hits * critMedio * 0.925 * multHab(a, d, g, t, e, false) * multClima(a, g, t);
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
    if (!(a.pp[idx] > 0)) { idx = a.pp.findIndex(function (x) { return x > 0; }); }
    a.pp[idx] = Math.max(0, a.pp[idx] - (d && hab(d) === 'pressure' ? 2 : 1));
    return { g: a.golpes[idx], idx: idx };
  }
  /* o alvo absorveu o golpe com a habilidade */
  function absorver(d, slug, P) {
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
      if (g.luta) {
        if (hab(a) !== 'magic-guard') { mexerHp(a, -Math.max(1, Math.floor(a.hpMax / 4)), `<b>${esc(a.p.nome)}</b> sofreu {x} de recuo.`, P); }
      } else { efeitoDreno(a, d, g, causado, P); }
      if (g.ef && !(secundario(g) && hab(a) === 'sheer-force')) {
        var alvo = g.ef[0] === 'u' ? a : d;
        var protegido = alvo === d && secundario(g) && habAlvo(a, d) === 'shield-dust';
        var chance = g.ef[1] * (hab(a) === 'serene-grace' ? 2 : 1);
        if (alvo.hp > 0 && !protegido && (g.ef[1] >= 100 || rng() * 100 < chance)) {
          g.ef[2].forEach(function (x) { alterar(alvo, x[0], x[1], alvo === d ? a : null, P); });
        }
      }
      if (causado > 0) { reacoes(a, d, g, r, causado, P); }
      if (d.hp <= 0) { aoDerrubar(a, P); }
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
  function simular(idsJ, idsO, mvJ, mvO, exJ, exO) {
    var B = ligarCampo({ j: novoLado(idsJ, mvJ || S.mv.j, null, exJ || (mvJ ? null : extrasDo('j'))), o: novoLado(idsO, mvO || S.mv.o, null, exO || (mvO ? null : extrasDo('o'))) }), turnos = 0;
    aoEntrar(ativo(B.j), ativo(B.o), []); aoEntrar(ativo(B.o), ativo(B.j), []);
    while (vivos(B.j).length && vivos(B.o).length && turnos < 300) {
      turnos++;
      var acoes = ordem(B, iaAcao(B.j, B.o), iaAcao(B.o, B.j));
      for (var k = 0; k < acoes.length; k++) {
        var lado = acoes[k].lado, foe = lado === 'j' ? 'o' : 'j', ac = acoes[k].a;
        if (ac.tipo === 'troca') { sairDeCampo(ativo(B[lado])); B[lado].ativo = ac.idx; aoEntrar(ativo(B[lado]), ativo(B[foe]), []); continue; }
        var a = ativo(B[lado]), d = ativo(B[foe]);
        if (a.hp <= 0) { continue; }
        var uso = golpeEfetivo(a, ac.idx, d);
        if (uso.descansa) { continue; }
        var r = calcular(a, d, uso.g), antes = d.hp;
        d.hp = Math.max(0, d.hp - r.dano);
        efeitosDepois(a, d, uso.g, r, antes - d.hp, uso.idx);
        if (d.hp <= 0) {
          evoluir(a);
          var rs = iaMelhorReserva(B[foe], a);
          if (rs >= 0) { sairDeCampo(d); B[foe].ativo = rs; aoEntrar(ativo(B[foe]), a, []); }
          break;
        }
      }
      fimTurnoClima(B, ['j', 'o']); fimTurnoLado(B.j); fimTurnoLado(B.o);
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
      nv: m.nv, pp: m.pp, est: m.est, item: m.item, preso: m.preso, descansa: m.descansa, turnos: m.turnos,
      nat: m.nat, hab: m.hab, habBase: m.habBase, habPos: m.habPos, novo: m.novo, flash: m.flash, disfarce: m.disfarce, usouEntrada: m.usouEntrada };
  }
  function lutadorDaFoto(f) {
    var p = P[f.pid]; if (!p || !f.nv || !f.pp || f.nat == null || f.hab == null) { return null; }
    return { p: p, nv: f.nv, nat: f.nat, st: statusDe(p.b, f.nv, f.nat), hp: f.hp, hpMax: f.hpMax, golpes: f.golpes, golpesBase: f.golpesBase, base: f.bid ? P[f.bid] : null, forma: f.forma, gmax: f.gmax,
      pp: f.pp, est: f.est || zeroEst(), item: f.item || null, preso: f.preso || null, descansa: !!f.descansa, turnos: f.turnos || 0,
      hab: f.hab, habBase: f.habBase || f.hab, habPos: f.habPos || 0, novo: !!f.novo, flash: !!f.flash, disfarce: !!f.disfarce, usouEntrada: !!f.usouEntrada };
  }
  function fotoBatalha(B) {
    var lado = function (l) { return { ativo: l.ativo, transformou: !!l.transformou, time: l.time.map(fotoLutador) }; };
    return { j: lado(B.j), o: lado(B.o), campo: B.campo ? { clima: B.campo.clima, turnos: B.campo.turnos } : null };
  }
  function batalhaDaFoto(f) {
    var lado = function (l) { return { ativo: l.ativo, transformou: l.transformou, time: l.time.map(lutadorDaFoto) }; };
    var B = { j: lado(f.j), o: lado(f.o) };
    return B.j.time.every(Boolean) && B.o.time.every(Boolean) ? ligarCampo(B, f.campo) : null;
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
    var aba = S.ge.aba === 'nat';
    var abas = `<div class='ge-abas'><span class='${aba ? '' : 'on'}' data-acao='geAba' data-a='golpes'>⚔ Golpes</span><span class='${aba ? 'on' : ''}' data-acao='geAba' data-a='nat'>✦ Nature e habilidade</span></div>`;
    var topo = `<div class='ge-topo'><div class='ge-arte'>${K.img([K.URL.home(p.id), K.URL.sprite(p.id)])}</div>
        <div class='ge-tit'><b>${esc(p.nome)}</b><div class='sl-tipos'>${p.t.map(K.chip).join('')}</div>
        <span>Nv. ${nivelDe(p)} · Ataque ${p.b.atk} · Atq. Esp. ${p.b.spa} · ${todos.length} golpes de dano</span></div>
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
      <div class='campo-luz'></div><div class='clima-fx ${B.campo && B.campo.clima ? B.campo.clima : ''}' id='ar-clima-fx'></div><div class='diag'></div>
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
    var uso = golpeEfetivo(a, idx, d);
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
      var ev0 = efeitosDepois(a, d, g, r, 0, uso.idx);
      if (r.erro) { textoFx('ERROU!', 'erro', foe); mensagem('Mas errou!'); registrar('Errou!'); await esperar(650); }
      else if (r.bloq) { await mostrarPassos(ev0.passos); }
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
    await mostrarPassos(ev.passos);
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
  /* mostra os passos das regras (habilidades, atributos, HP) um a um */
  function ladoDe(m) { return S.B.j.time.indexOf(m) >= 0 ? 'j' : 'o'; }
  function climaHtml() {
    var c = S.B && S.B.campo; if (!c || !c.clima) { return ''; }
    return `<span>${NOME_CLIMA[c.clima]} · ${c.turnos} ${c.turnos === 1 ? 'turno' : 'turnos'}${clima(ativo(S.B.j)) ? '' : ' · anulado'}</span>`;
  }
  function atualizarHud() {
    var cx = $('ar-clima'), fx = $('ar-clima-fx');
    if (cx) { cx.innerHTML = climaHtml(); }
    if (fx) { fx.className = 'clima-fx ' + ((S.B.campo && S.B.campo.clima) || ''); }
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
    await mostrarPassos(fimTurnoClima(B, ['j', 'o']));
    for (var lg of ['j', 'o']) {
      var mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      await mostrarPassos(fimTurnoLado(B[lg]));
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
    await mostrarPassos(fimTurnoClima(B, lados));
    for (var g = 0; g < 2; g++) {
      var lg = lados[g], mg = ativo(B[lg]);
      if (mg.gmax > 0 && mg.hp > 0) { mg.gmax--; if (mg.gmax === 0) { await reverterGmax(lg); } }
      await mostrarPassos(fimTurnoLado(B[lg]));
    }
    fecharTurno(n);
    S.ocupado = false; S.msg = p.deles[p.turno] ? msgVez() + ' <i>(o adversário já escolheu)</i>' : msgVez(); render();
    return resolverOnline();
  }
  /* fim do turno: avança o contador e compara o estado com o do outro lado */
  function fecharTurno(n) {
    var p = S.on.p, B = S.B, resumo = ladosCanonicos().map(function (l) {
      return B[l].ativo + ':' + B[l].time.map(function (m) { return m.hp + '/' + m.pp.join('.') + '/' + m.p.id + '/' + m.nat; }).join(',') + ':' + JSON.stringify(ativo(B[l]).est) + ':' + hab(ativo(B[l]));
    }).join('|') + '|' + (B.campo.clima || '-') + B.campo.turnos;
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
        if (S.ge.ids.length) { S.mv[S.ge.lado][S.ge.id] = S.ge.ids.slice(); }
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

  window.__arenaApi = { calibrar: calibrar, nivelDe: nivelDe, nivelFormula: nivelFormula, ehFormaEspecial: ehFormaEspecial, simular: simular, golpesDe: golpesDe, statusDe: statusDe, NATURES: NATURES, natAuto: natAuto, classeNat: classeNat, habsDe: habsDe, habAuto: habAuto, HAB_INFO: HAB_INFO, calcular: calcular, lutador: lutador, ligarCampo: ligarCampo, aoEntrar: aoEntrar, fimTurnoClima: fimTurnoClima, atributo: atributo, esperado: esperado, clima: clima, opcoesTransformar: opcoesTransformar, aplicarForma: aplicarForma, desfazerGmax: desfazerGmax, novoLado: novoLado };
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
