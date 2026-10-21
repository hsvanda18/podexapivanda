/* Arena online pelo Supabase (login anónimo + base de dados + tempo real).
   A sala e todas as jogadas ficam guardadas: quem minimiza a app ou perde a rede volta e continua
   (a Arena reconstrói a batalha a partir das jogadas, porque o motor é determinístico).
   window.PKOnline: criarSala() · entrar(codigo) · enviar(msg) · aoReceber(fn) · aoMudarEstado(fn) · sair() · link()
   estados: off · a-ligar · sala (à espera do convidado) · ligado · ausente (o outro minimizou) · caiu · erro
   mensagens entregues à Arena: ola · modo · time · inicio · retomar · acao · troca · sync · revanche · sala · saiu */
(function () {
  var CFG = window.PK_CONFIG || {};
  var URL_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var CHAVE_SALA = 'pkdx:sala-online';
  var sb = null, canal = null, ouvintes = [], estadoFns = [];
  var at = null; // sala atual: { codigo, papel, uid, partida, row, vistos:{}, pendentes:[], outroTime:'', pedidoSala:false }
  var O = window.PKOnline = { estado: 'off', papel: null, codigo: null, erro: '', versao: '' };

  O.configurado = !!(CFG.supabaseUrl && CFG.supabaseChave);

  function avisar(estado, erro) {
    if (O.estado === estado && (erro || '') === O.erro) { return; }
    O.estado = estado; O.erro = erro || '';
    estadoFns.forEach(function (f) { f(estado, O.erro); });
  }
  function entregar(m) { ouvintes.forEach(function (f) { f(m); }); }
  function guardarSala(codigo) { try { if (codigo) { localStorage.setItem(CHAVE_SALA, codigo); } else { localStorage.removeItem(CHAVE_SALA); } } catch (e) { /* ignora */ } }
  O.salaGuardada = function () { try { return localStorage.getItem(CHAVE_SALA) || ''; } catch (e) { return ''; } };

  function carregarLib() {
    return new Promise(function (ok, falha) {
      if (window.supabase && window.supabase.createClient) { ok(); return; }
      var s = document.createElement('script');
      s.src = URL_LIB; s.onload = ok;
      s.onerror = function () { falha(new Error('Não foi possível carregar o modo online. Verifica a ligação à internet.')); };
      document.head.appendChild(s);
    });
  }
  function cliente() {
    if (!O.configurado) { return Promise.reject(new Error('O modo online ainda não foi configurado (falta o Supabase em js/config.js).')); }
    return carregarLib().then(function () {
      if (!sb) { sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseChave, { auth: Object.assign({ persistSession: true, autoRefreshToken: true }, CFG.chaveSessao ? { storageKey: CFG.chaveSessao } : {}) }); }
      return sb.auth.getSession();
    }).then(function (r) {
      if (r.data && r.data.session) { return r.data.session.user; }
      return sb.auth.signInAnonymously().then(function (a) {
        if (a.error) { throw new Error(/anonymous/i.test(a.error.message) ? 'O login anónimo está desligado no Supabase (Authentication → Sign In / Providers).' : a.error.message); }
        return a.data.user;
      });
    });
  }
  function textoErro(e) {
    var m = (e && e.message) || String(e || '');
    if (/sala_nao_encontrada/.test(m)) { return 'Sala não encontrada. Confirma o código.'; }
    if (/sala_cheia/.test(m)) { return 'Esta sala já tem dois jogadores.'; }
    if (/Failed to fetch|NetworkError|network/i.test(m)) { return 'Sem ligação ao servidor. Verifica a internet e tenta de novo.'; }
    return m || 'Algo correu mal. Tenta de novo.';
  }
  function gerarCodigo() { var c = ''; for (var i = 0; i < 6; i++) { c += LETRAS[Math.floor(Math.random() * LETRAS.length)]; } return c; }
  function col(base, papel) { return base + '_' + papel; }
  function outro() { return at.papel === 'host' ? 'conv' : 'host'; }

  /* ---------- estado da ligação (Presence) ---------- */
  function presentes() {
    if (!canal) { return {}; }
    var st = canal.presenceState(), out = {};
    Object.keys(st).forEach(function (k) { out[k] = (st[k] && st[k][0]) || {}; });
    return out;
  }
  function recalcularEstado() {
    if (!at) { return; }
    var r = at.row;
    if (!r.conv && at.papel === 'host') { avisar('sala'); return; }
    var pres = presentes(), outroUid = at.papel === 'host' ? r.conv : r.host, ele = pres[outroUid];
    if (ele) {
      if (O.estado !== 'ligado') { avisar('ligado'); entregar({ t: 'ola', v: ele.v || '' }); }
    } else if (O.estado === 'ligado' || O.estado === 'a-ligar' || O.estado === 'sala') { avisar('ausente'); }
  }

  /* ---------- eventos da base de dados ---------- */
  function aoMudarSala(ev) {
    if (!at) { return; }
    if (ev.eventType === 'DELETE') { sairLocal(); avisar('caiu', 'Quem criou a sala fechou-a.'); return; }
    var antes = at.row, r = ev.new;
    at.row = r;
    if (antes.conv && !r.conv) { at.outroTime = ''; entregar({ t: 'saiu' }); }
    tratarSala(antes, r);
    recalcularEstado();
  }
  /* compara a sala com a versão anterior e entrega à Arena o que mudou do lado do outro jogador */
  function tratarSala(antes, r) {
    var o = outro();
    if (at.papel === 'conv' && (!antes || antes.modo !== r.modo)) { entregar({ t: 'modo', m: r.modo }); }
    var sinal = JSON.stringify([r[col('time', o)], r[col('golpes', o)], r[col('pronto', o)]]);
    if (sinal !== at.outroTime) { at.outroTime = sinal; entregar({ t: 'time', ids: r[col('time', o)], mv: r[col('golpes', o)], pronto: r[col('pronto', o)] }); }
    if (r.estado === 'batalha' && r.inicio && r.partida > at.partida) {
      at.partida = r.partida;
      if (at.papel === 'conv' || at.precisaInicio) { at.precisaInicio = false; entregar(Object.assign({ t: 'inicio' }, r.inicio)); }
      var pend = at.pendentes.filter(function (j) { return j.partida === at.partida; });
      at.pendentes = [];
      pend.forEach(aoJogada);
    }
    if (antes && antes.estado === 'batalha' && r.estado === 'sala') {
      if (at.pedidoSala) { at.pedidoSala = false; } else { entregar({ t: 'sala' }); }
    }
  }
  function aoJogada(j) {
    if (!at || at.vistos[j.id]) { return; }
    if (j.partida > at.partida) { at.pendentes.push(j); return; }
    at.vistos[j.id] = true;
    if (j.partida !== at.partida || j.jogador === at.uid) { return; }
    var d = j.dados || {};
    if (j.tipo === 'acao') { entregar({ t: 'acao', n: j.n, a: d }); }
    else if (j.tipo === 'troca') { entregar({ t: 'troca', n: j.n, idx: d.idx }); }
    else if (j.tipo === 'sync') { entregar({ t: 'sync', n: j.n, h: d.h }); }
    else if (j.tipo === 'revanche') { entregar({ t: 'revanche' }); }
  }
  function jogadasDaPartida(partida) {
    return sb.from('jogadas').select('*').eq('codigo', at.codigo).eq('partida', partida).order('id').then(function (r) {
      if (r.error) { throw r.error; }
      return r.data || [];
    });
  }
  /* ao (re)ligar: relê a sala e as jogadas que possam ter escapado enquanto a app estava minimizada */
  function sincronizar(primeira) {
    if (!at) { return Promise.resolve(); }
    return sb.from('salas').select('*').eq('codigo', at.codigo).maybeSingle().then(function (r) {
      if (r.error) { throw r.error; }
      if (!r.data) { sairLocal(); avisar('caiu', 'Esta sala já não existe.'); return; }
      var antes = at.row, row = r.data;
      at.row = row;
      if (primeira && row.estado === 'batalha' && row.inicio) {
        // página nova (ou reaberta): a Arena reconstrói a batalha com todas as jogadas
        at.partida = row.partida;
        at.outroTime = JSON.stringify([row[col('time', outro())], row[col('golpes', outro())], row[col('pronto', outro())]]);
        return jogadasDaPartida(row.partida).then(function (js) {
          js.forEach(function (j) { at.vistos[j.id] = true; });
          entregar({ t: 'retomar', cfg: row.inicio, jogadas: js.map(function (j) { return { n: j.n, tipo: j.tipo, dados: j.dados, minha: j.jogador === at.uid }; }) });
        });
      }
      at.precisaInicio = !primeira;
      tratarSala(primeira ? null : antes, row);
      if (row.estado === 'batalha') { return jogadasDaPartida(at.partida).then(function (js) { js.forEach(aoJogada); }); }
    }).then(recalcularEstado).catch(function (e) { avisar('erro', textoErro(e)); });
  }
  function ligarCanal() {
    if (canal) { sb.removeChannel(canal); }
    canal = sb.channel('sala-' + at.codigo, { config: { presence: { key: at.uid } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salas', filter: 'codigo=eq.' + at.codigo }, aoMudarSala)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jogadas', filter: 'codigo=eq.' + at.codigo }, function (ev) { aoJogada(ev.new); })
      .on('presence', { event: 'sync' }, recalcularEstado);
    var primeira = true;
    canal.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        canal.track({ v: O.versao, papel: at.papel });
        sincronizar(primeira);
        primeira = false;
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && at) {
        avisar('ausente');
      }
    });
  }
  function ligar(row, uid) {
    at = { codigo: row.codigo, papel: row.host === uid ? 'host' : 'conv', uid: uid, partida: 0, row: row, vistos: {}, pendentes: [], outroTime: '', pedidoSala: false, precisaInicio: false };
    O.codigo = row.codigo; O.papel = at.papel;
    guardarSala(row.codigo);
    ligarCanal();
  }
  function sairLocal() {
    if (canal && sb) { sb.removeChannel(canal); }
    canal = null; at = null; guardarSala('');
  }

  /* ---------- API usada pela Arena ---------- */
  O.criarSala = function (tentativa) {
    sairLocal(); O.papel = 'host'; O.codigo = null; avisar('a-ligar');
    cliente().then(function (user) {
      return sb.from('salas').insert({ codigo: gerarCodigo(), versao: O.versao }).select().single().then(function (r) {
        if (r.error) {
          if (r.error.code === '23505' && (tentativa || 0) < 3) { O.criarSala((tentativa || 0) + 1); return; }
          throw r.error;
        }
        ligar(r.data, user.id);
        avisar('sala');
      });
    }).catch(function (e) { avisar('erro', textoErro(e)); });
  };
  O.entrar = function (codigo) {
    codigo = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    sairLocal(); O.codigo = codigo; O.papel = null; avisar('a-ligar');
    if (codigo.length !== 6) { avisar('erro', 'O código da sala tem 6 letras ou números.'); return; }
    cliente().then(function (user) {
      return sb.rpc('entrar_sala', { p_codigo: codigo }).then(function (r) {
        if (r.error) { throw r.error; }
        ligar(r.data, user.id);
      });
    }).catch(function (e) { guardarSala(''); avisar('erro', textoErro(e)); });
  };
  /* tenta de novo algumas vezes: uma jogada perdida pararia a batalha */
  function tentar(fn, tentativas) {
    return fn().then(function (r) {
      if (r && r.error) { throw r.error; }
      return r;
    }).catch(function (e) {
      if ((tentativas || 0) < 3) { return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return tentar(fn, (tentativas || 0) + 1); }); }
      console.warn('online: não gravou', e);
    });
  }
  /* as gravações saem em fila, pela ordem em que foram feitas (senão uma mais antiga pode apagar a mais nova) */
  var fila = Promise.resolve();
  function gravar(fn) { fila = fila.then(function () { return tentar(fn); }); return fila; }
  O.enviar = function (m) {
    if (!at || !sb) { return false; }
    var c = at.codigo, eu = at.papel, mud = {};
    switch (m.t) {
      case 'ola': return true; // a versão vai na Presence
      case 'modo': gravar(function () { return sb.from('salas').update({ modo: m.m }).eq('codigo', c); }); return true;
      case 'time':
        mud[col('time', eu)] = m.ids || []; mud[col('golpes', eu)] = m.mv || {}; mud[col('pronto', eu)] = !!m.pronto;
        gravar(function () { return sb.from('salas').update(mud).eq('codigo', c); }); return true;
      case 'inicio':
        at.partida = at.row.partida + 1;
        var cfg = { semente: m.semente, modo: m.modo, times: m.times, mv: m.mv };
        gravar(function () { return sb.from('salas').update({ estado: 'batalha', partida: at.partida, inicio: cfg, pronto_host: false, pronto_conv: false }).eq('codigo', c); });
        return true;
      case 'sala': at.pedidoSala = true; gravar(function () { return sb.from('salas').update({ estado: 'sala' }).eq('codigo', c); }); return true;
      case 'acao': case 'troca': case 'sync': case 'revanche':
        var dados = m.t === 'acao' ? m.a : m.t === 'troca' ? { idx: m.idx } : m.t === 'sync' ? { h: m.h } : null;
        var linha = { codigo: c, partida: at.partida, n: m.t === 'revanche' ? -1 : m.n, tipo: m.t, dados: dados };
        gravar(function () { return sb.from('jogadas').upsert(linha, { onConflict: 'codigo,partida,n,jogador,tipo', ignoreDuplicates: true }); });
        return true;
    }
    return false;
  };
  O.aoReceber = function (f) { ouvintes.push(f); };
  O.aoMudarEstado = function (f) { estadoFns.push(f); };
  O.sair = function () {
    var c = at && at.codigo;
    if (c && sb) { sb.rpc('sair_sala', { p_codigo: c }).then(function () { /* feito */ }); }
    sairLocal(); O.papel = O.codigo = null; avisar('off');
  };
  O.link = function () { return location.origin + location.pathname + '#sala-' + O.codigo; };

  // ao voltar à app depois de minimizar, apanha o que mudou entretanto
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && at && sb) {
      if (canal && canal.state !== 'joined') { ligarCanal(); } else { sincronizar(false); }
    }
  });
})();
