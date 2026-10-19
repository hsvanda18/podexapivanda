/* Ligação P2P (WebRTC via PeerJS) para a Arena online.
   Não há servidor próprio: o servidor público gratuito do PeerJS só apresenta os dois browsers;
   depois as mensagens vão direto de um para o outro.
   window.PKOnline: criarSala() · entrar(codigo) · enviar(msg) · aoReceber(fn) · aoMudarEstado(fn) · sair()
   estados: off · a-ligar · sala (à espera do convidado) · ligado · caiu · erro */
(function () {
  var URL_PEERJS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  var PREFIXO = 'pkdx-', LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var ESPERA_LIGAR = 15000, SILENCIO_MAX = 30000, TOLERANCIA_ICE = 8000;
  /* TURN (Metered, plano gratuito): retransmite quando a ligação direta não abre (algumas redes 4G/5G).
     Sem resposta da Metered em 4 s, segue só com a ligação direta, como antes. */
  var TURN_APP = 'pokedex', TURN_CHAVE = '533fda93247b4db8870af29d8f4bed9a8245';
  var STUN_PUBLICO = [{ urls: 'stun:stun.l.google.com:19302' }];
  var iceGuardado = null;
  var peer = null, conn = null, ouvintes = [], estadoFns = [], timerPing = null, timerLigar = null, ultimo = 0;
  var O = window.PKOnline = { estado: 'off', papel: null, codigo: null, erro: '' };

  function avisar(estado, erro) {
    O.estado = estado; O.erro = erro || '';
    estadoFns.forEach(function (f) { f(estado, O.erro); });
  }
  function carregar() {
    return new Promise(function (ok, falha) {
      if (window.Peer) { ok(); return; }
      var s = document.createElement('script');
      s.src = URL_PEERJS;
      s.onload = ok;
      s.onerror = function () { falha(new Error('Não foi possível carregar o modo online. Verifica a ligação à internet.')); };
      document.head.appendChild(s);
    });
  }
  function obterIce() {
    if (!TURN_APP || !TURN_CHAVE || !window.fetch) { return Promise.resolve(null); }
    if (iceGuardado && Date.now() - iceGuardado.em < 3600000) { return Promise.resolve(iceGuardado.lista); }
    var ctrl = window.AbortController ? new AbortController() : null;
    if (ctrl) { setTimeout(function () { ctrl.abort(); }, 4000); }
    return fetch('https://' + TURN_APP + '.metered.live/api/v1/turn/credentials?apiKey=' + TURN_CHAVE, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (lista) {
        if (!Array.isArray(lista) || !lista.length) { return null; }
        iceGuardado = { em: Date.now(), lista: lista };
        return lista;
      })
      .catch(function () { return null; });
  }
  function opcoesPeer(ice) { return { debug: 0, config: { iceServers: STUN_PUBLICO.concat(ice || []) } }; }
  function gerarCodigo() {
    var c = '';
    for (var i = 0; i < 6; i++) { c += LETRAS[Math.floor(Math.random() * LETRAS.length)]; }
    return c;
  }
  function textoErro(e) {
    var t = e && e.type;
    if (t === 'peer-unavailable') { return 'Sala não encontrada. Confirma o código: a sala só existe enquanto quem a criou tiver a página aberta.'; }
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') { return 'Sem ligação ao servidor de salas. Verifica a internet e tenta de novo.'; }
    if (t === 'browser-incompatible') { return 'Este browser não suporta o modo online. Experimenta o Chrome, o Safari ou o Firefox atualizados.'; }
    return 'A ligação falhou. Tenta de novo ou experimenta outra rede (por exemplo o Wi-Fi).';
  }
  function pararTimers() { clearInterval(timerPing); clearTimeout(timerLigar); timerPing = timerLigar = null; }
  function caiu(msg) {
    if (!conn && O.estado !== 'ligado') { return; }
    pararTimers();
    var c = conn; conn = null;
    if (c) { try { c.close(); } catch (e) { /* já fechada */ } }
    if (O.estado === 'ligado') { avisar('caiu', msg); }
  }
  function usarConexao(c) {
    conn = c;
    c.on('open', function () {
      clearTimeout(timerLigar);
      ultimo = Date.now();
      avisar('ligado');
      timerPing = setInterval(function () {
        if (!conn || !conn.open) { return; }
        conn.send({ t: 'ping' });
        if (Date.now() - ultimo > SILENCIO_MAX) { caiu('O adversário deixou de responder.'); }
      }, 5000);
      // o WebRTC demora a dar a ligação por fechada; o estado ICE avisa mais cedo
      var pc = c.peerConnection, timerIce = null;
      if (pc && pc.addEventListener) {
        pc.addEventListener('iceconnectionstatechange', function () {
          var st = pc.iceConnectionState;
          clearTimeout(timerIce);
          if (st === 'failed' || st === 'closed') { caiu('A ligação caiu.'); }
          else if (st === 'disconnected') { timerIce = setTimeout(function () { if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') { caiu('A ligação caiu.'); } }, TOLERANCIA_ICE); }
        });
      }
    });
    c.on('data', function (m) {
      ultimo = Date.now();
      if (!m || m.t === 'ping') { return; }
      if (m.t === 'tchau') { caiu('O adversário saiu.'); return; }
      if (m.t === 'cheia') { avisar('erro', 'Esta sala já tem dois jogadores.'); return; }
      ouvintes.forEach(function (f) { f(m); });
    });
    c.on('close', function () { if (conn === c) { caiu('O adversário saiu.'); } });
    c.on('error', function () { if (conn === c) { caiu('A ligação caiu.'); } });
  }
  function limpar() {
    pararTimers();
    if (conn) { try { if (conn.open) { conn.send({ t: 'tchau' }); } conn.close(); } catch (e) { /* já fechada */ } }
    if (peer) { try { peer.destroy(); } catch (e) { /* já destruído */ } }
    conn = peer = null;
  }

  O.criarSala = function (tentativa) {
    limpar(); O.papel = 'host'; O.codigo = null; avisar('a-ligar');
    carregar().then(obterIce).then(function (ice) {
      var codigo = gerarCodigo();
      O.turn = !!ice;
      peer = new window.Peer(PREFIXO + codigo, opcoesPeer(ice));
      peer.on('open', function () { O.codigo = codigo; avisar('sala'); });
      peer.on('connection', function (c) {
        if (conn && conn.open) { c.on('open', function () { c.send({ t: 'cheia' }); setTimeout(function () { c.close(); }, 500); }); return; }
        usarConexao(c);
      });
      // perder o servidor de salas não derruba uma partida já ligada
      peer.on('disconnected', function () { if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* tenta depois */ } } });
      peer.on('error', function (e) {
        if (e.type === 'unavailable-id' && (tentativa || 0) < 3) { O.criarSala((tentativa || 0) + 1); return; }
        if (O.estado !== 'ligado') { avisar('erro', textoErro(e)); }
      });
    }).catch(function (e) { avisar('erro', e.message); });
  };

  O.entrar = function (codigo) {
    codigo = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    limpar(); O.papel = 'conv'; O.codigo = codigo; avisar('a-ligar');
    if (codigo.length !== 6) { avisar('erro', 'O código da sala tem 6 letras ou números.'); return; }
    carregar().then(obterIce).then(function (ice) {
      O.turn = !!ice;
      peer = new window.Peer(opcoesPeer(ice));
      peer.on('open', function () {
        usarConexao(peer.connect(PREFIXO + codigo, { reliable: true }));
        timerLigar = setTimeout(function () {
          if (O.estado !== 'ligado') { limpar(); avisar('erro', 'Não deu para ligar à sala. Confirma o código ou tenta outra rede (por exemplo o Wi-Fi em vez dos dados móveis).'); }
        }, ESPERA_LIGAR);
      });
      peer.on('error', function (e) { if (O.estado !== 'ligado') { limpar(); avisar('erro', textoErro(e)); } });
    }).catch(function (e) { avisar('erro', e.message); });
  };

  O.enviar = function (m) { if (conn && conn.open) { conn.send(m); return true; } return false; };
  O.aoReceber = function (f) { ouvintes.push(f); };
  O.aoMudarEstado = function (f) { estadoFns.push(f); };
  O.sair = function () { limpar(); O.papel = O.codigo = null; avisar('off'); };
  O.link = function () { return location.origin + location.pathname + '#sala-' + O.codigo; };
  window.addEventListener('pagehide', limpar);
})();
