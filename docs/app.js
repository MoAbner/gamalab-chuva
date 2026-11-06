/* GamaLab · Aula interativa de distribuição gama e chuva.
 * Site estático (GitHub Pages); sincronização opcional via Supabase.
 * Não coleta nomes, e-mails ou localização. Não coloque chaves privadas aqui.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = (number, digits = 1) => Number(number).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pc = number => `${fmt(100 * number, 2)}%`;
  const config = window.GAMA_CONFIG || {};
  const isConfigured = Boolean(config.supabaseUrl && config.supabaseKey &&
    /^https:\/\/[\w.-]+\.supabase\.co\/?$/.test(config.supabaseUrl) &&
    !config.supabaseKey.includes('COLE_'));
  const supabaseClient = isConfigured && window.supabase?.createClient
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 } }
      }) : null;
  const MAX_PER_DEVICE = 400;
  const state = { role: null, room: null, hostToken: null, participantId: null,
    demo: false, batches: [], channel: null, pollTimer: null, refreshTimer: null,
    loadingBatches: false, loadAgain: false, demoCounter: 0, busy: false, myCount: 0 };

  const { logGamma, gammaP, gammaCDF, gammaTail, gammaQuantile, gammaSample, simulateLocal } = window.GamaMath;

  function defaultRoom() {
    return { id: 'demo', code: 'DEMO', status: 'aberta', modo: 'dia', alpha: 0.8,
      theta: 15, seca: 0.45, limit_a: 30, limit_b: 50, total_samples: 0, epoch: 1,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
  }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function restore(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function uid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function baseUrl() { return location.href.split('?')[0].split('#')[0]; }
  function joinUrl(code) {
    // A loopback address belongs to each device, so phones need the public site.
    const local = location.protocol === 'file:' ||
      /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(location.hostname);
    const url = new URL(local && config.publicSiteUrl ? config.publicSiteUrl : baseUrl());
    url.search = '';
    url.hash = '';
    url.searchParams.set('s', code);
    return url.href;
  }
  let toastTimer;
  function toast(text) {
    const el = $('toast'); el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6500);
  }
  function showScreen(name) {
    setDashboardFocus(false);
    document.body.classList.toggle('student-view', name === 'student-screen');
    ['landing', 'host-screen', 'student-screen'].forEach(id => { $(id).hidden = id !== name; });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function setTop(text) { $('top-status').textContent = text; }
  function updateURL(param) {
    try { history.replaceState(null, '', param ? `${baseUrl()}?${param}` : baseUrl()); } catch (_) {}
  }
  function setBusy(flag) {
    state.busy = flag;
    document.querySelectorAll('.simulation-button').forEach(button => button.disabled = flag || state.room?.status !== 'aberta');
  }
  function available(room) {
    return Boolean(room && room.status === 'aberta' && new Date(room.expires_at).getTime() > Date.now());
  }
  function checkError(error) {
    const message = error?.message || 'Falha na comunicação com o servidor.';
    return message.replace(/^.*?ERROR:\s*/i, '').slice(0, 220);
  }

  // --- Acesso às salas e eventos Realtime ---
  async function fetchRoom(code) {
    if (!supabaseClient) throw Error('Configure o Supabase em config.js para usar uma sala online.');
    const { data, error } = await supabaseClient.from('gama_rooms').select('*')
      .eq('code', code.toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!data) throw Error('Código não encontrado. Verifique os oito caracteres.');
    return data;
  }
  async function enterHost(room, token, demo = false) {
    disconnect();
    Object.assign(state, { room, hostToken: token, role: 'host', demo, batches: [], myCount: 0 });
    showScreen('host-screen');
    $('host-demo-tag').hidden = !demo;
    $('simulate-demo-1').hidden = !demo;
    $('simulate-demo-50').hidden = !demo;
    $('copy-link').disabled = demo;
    $('qr-code').textContent = '';
    $('qr-code').setAttribute('aria-label', demo ? 'QR code indisponível no modo local' : 'QR code para entrar na sala');
    if (demo) {
      $('qr-code').textContent = 'Prévia local\nSem compartilhamento';
      updateURL('demo=1');
      setTop('Demonstração local');
    } else {
      updateURL(`painel=${room.code}`);
      renderQR(joinUrl(room.code));
      if (new URL(joinUrl(room.code)).origin !== location.origin) {
        $('link-help').textContent = 'O QR code abre o site público nos celulares. O painel continua neste computador.';
      }
      setTop('Sala conectada');
      connectRealtime();
      await refreshBatchData();
    }
    updateRoomUI();
  }
  async function enterStudent(room) {
    disconnect();
    const key = `gama_student_${room.code}`;
    let participantId = restore(key);
    if (!/^[a-f0-9-]{36}$/i.test(participantId || '')) {
      participantId = uid(); save(key, participantId);
    }
    Object.assign(state, { room, hostToken: null, participantId, role: 'student', demo: false, batches: [], myCount: 0 });
    showScreen('student-screen');
    updateURL(`s=${room.code}`);
    setTop('Participando ao vivo');
    updateRoomUI();
    connectRealtime();
    await refreshBatchData();
  }
  function enterStudentPreview() {
    disconnect();
    Object.assign(state, { room: defaultRoom(), participantId: 'preview-local', role: 'student', demo: true, batches: [], myCount: 0 });
    showScreen('student-screen');
    updateRoomUI();
    $('student-status').textContent = 'Prévia local · sem envio';
    $('student-feedback').textContent = 'Teste 1, 10 ou 50 para ver a chuva aumentar. Nenhum dado será enviado.';
    $('student-model-help').textContent = 'Esta prévia sorteia os volumes no navegador. Nas salas compartilhadas, os sorteios continuam no servidor.';
    setTop('Prévia do aluno');
    updateURL('preview=aluno');
  }
  function disconnect() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    if (state.channel && supabaseClient) supabaseClient.removeChannel(state.channel);
    state.pollTimer = null; state.channel = null; state.refreshTimer = null;
  }
  function connectRealtime() {
    if (!supabaseClient || !state.room || state.demo) return;
    const id = state.room.id;
    const channel = supabaseClient.channel(`gama-${id}-${uid().slice(0,8)}`);
    channel.on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'gama_rooms', filter: `id=eq.${id}`
    }, ({new: room}) => {
      if (state.room?.id !== id) return;
      const reset = state.room.epoch !== room.epoch;
      state.room = room;
      updateRoomUI();
      if (reset) state.myCount = 0;
      scheduleRefresh(250);
    });
    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'gama_batches', filter: `room_id=eq.${id}`
    }, () => { scheduleRefresh(350); });
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') setTop('Conectado ao experimento');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTop('Reconectando…');
    });
    state.channel = channel;
    state.pollTimer = setInterval(async () => {
      if (!state.room || state.room.id !== id) return;
      try {
        const room = await fetchRoom(state.room.code);
        const reset = state.room.epoch !== room.epoch;
        state.room = room;
        if (reset) state.myCount = 0;
        updateRoomUI();
        await refreshBatchData();
      } catch (_) { setTop('Conexão instável · tentando novamente'); }
    }, state.role === 'host' ? 7000 : 12000);
  }
  function scheduleRefresh(delay) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshBatchData, delay);
  }
  async function refreshBatchData() {
    if (state.demo || !supabaseClient || !state.room) return;
    if (state.loadingBatches) { state.loadAgain = true; return; }
    state.loadingBatches = true;
    const roomId = state.room.id;
    const epoch = state.room.epoch;
    try {
      let rows = [], offset = 0;
      do {
        const {data, error} = await supabaseClient.from('gama_batches')
          .select('id,epoch,participant_id,amostras')
          .eq('room_id', roomId).eq('epoch', epoch)
          .order('id', {ascending:true}).range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += 1000;
      } while(offset < 10000);
      if (state.room?.id !== roomId || state.room.epoch !== epoch) return;
      state.batches = rows;
      if (state.role === 'student') state.myCount = rows
        .filter(r => r.participant_id === state.participantId)
        .reduce((s,r) => s + (r.amostras?.length || 0), 0);
      renderStats();
      if (state.role === 'student') updateStudentCounters();
    } catch (e) {
      setTop('Dados em atualização');
      console.warn('Falha ao atualizar a amostra:', e);
    } finally {
      state.loadingBatches = false;
      if (state.loadAgain) { state.loadAgain = false; scheduleRefresh(200); }
    }
  }
  function renderQR(url) {
    const block = $('qr-code'); block.textContent = '';
    if (window.QRCode) {
      new window.QRCode(block, {text:url,width:168,height:168,
        colorDark:'#0b2031', colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});
    } else {
      block.textContent = 'QR indisponível; use o link de participação.';
    }
  }
  function roomDataChanged() {
    updateRoomUI(); renderStats();
  }
  function updateRoomUI() {
    const r = state.room; if (!r) return;
    const isOpen = available(r);
    if (state.role === 'host') {
      $('display-code').textContent = r.code;
      const joinLink = $('join-link');
      joinLink.textContent = state.demo ? 'Sem link público na demonstração' : joinUrl(r.code);
      joinLink.href = state.demo ? '#' : joinUrl(r.code);
      joinLink.setAttribute('aria-disabled', state.demo ? 'true' : 'false');
      $('session-state').textContent = isOpen ? 'Sala aberta' : 'Sala encerrada';
      $('session-state').className = `pill ${isOpen ? 'pill-open' : 'pill-closed'}`;
      $('toggle-room').textContent = isOpen ? 'Encerrar sala' : 'Reabrir sala';
      $('toggle-room').disabled = new Date(r.expires_at).getTime() <= Date.now();
      $('cfg-mode').value = r.modo;
      $('cfg-alpha').value = r.alpha;
      $('cfg-theta').value = r.theta;
      $('cfg-dry').value = Math.round(r.seca * 100);
      $('cfg-a').value = r.limit_a;
      $('cfg-b').value = r.limit_b;
      $('dry-field').hidden = r.modo !== 'mes';
      $('theory-legend').hidden = r.modo !== 'dia';
      $('chart-title').textContent = r.modo === 'dia' ? 'Volume de chuva em dias chuvosos' : 'Total de chuva em janeiro (31 dias)';
      $('explain-title').textContent = r.modo === 'dia' ? 'Por que a curva é assimétrica?' : 'Por que não há uma curva gama neste modo?';
      $('model-explanation').textContent = r.modo === 'dia'
        ? 'O modelo gama é contínuo e descreve volumes positivos. Quando α é menor do que 1, a curva tem densidade mais alta perto de zero e cauda à direita. Não representa dias sem chuva.'
        : 'Cada dia é seco com uma probabilidade fixa ou, quando chove, tem volume gama. A soma de 31 dias segue um modelo misto: seu total mensal não é, em geral, distribuído como uma única gama.';
    } else if (state.role === 'student') {
      $('student-code').textContent = r.code;
      $('student-status').textContent = isOpen ? 'Recebendo dados' : 'Sala encerrada';
      $('student-status').className = `pill ${isOpen ? 'pill-open' : 'pill-closed'}`;
      $('student-context').textContent = r.modo === 'dia'
        ? 'Cada experimento gera o volume de chuva de um dia chuvoso.'
        : 'Cada experimento gera o volume de chuva acumulado em um janeiro de 31 dias.';
      $('student-model-help').textContent = r.modo === 'dia'
        ? `O servidor sorteia volumes gama com forma α=${fmt(r.alpha)} e escala θ=${fmt(r.theta)} mm. A média teórica por dia chuvoso é ${fmt(r.alpha*r.theta)} mm. Não são incluídos dias secos.`
        : `Cada um dos 31 dias tem ${fmt(r.seca*100,0)}% de probabilidade de ser seco. Quando chove, o volume segue Gama(α=${fmt(r.alpha)}, θ=${fmt(r.theta)} mm). O total mensal é uma soma mista, não uma única gama.`;
      setBusy(state.busy);
      updateStudentCounters();
    }
    if (state.role === 'host') renderStats();
  }

  // --- Painel, estimativas empíricas e gráfico SVG sem dependências ---
  function aggregate() {
    const values = state.batches.flatMap(b => (b.amostras || []).map(Number).filter(Number.isFinite));
    const r = state.room || defaultRoom(), n = values.length;
    const mean = n ? values.reduce((s,v) => s + v,0)/n : 0;
    const exceedA = n ? values.filter(v => v > r.limit_a).length/n : 0;
    const exceedB = n ? values.filter(v => v > r.limit_b).length/n : 0;
    const members = new Set(state.batches.map(b => b.participant_id)).size;
    return {values, n, mean, exceedA, exceedB, members};
  }
  function renderStats() {
    if (!state.room || state.role !== 'host') return;
    const r = state.room, a = aggregate();
    const daily = r.modo === 'dia';
    const expected = daily ? r.alpha*r.theta : 31*(1-r.seca)*r.alpha*r.theta;
    $('stat-count').textContent = a.n.toLocaleString('pt-BR');
    $('stat-contributors').textContent = state.demo ? 'Apenas neste navegador' : `${a.members} dispositivo(s) contribuíram`;
    $('stat-mean').textContent = a.n ? `${fmt(a.mean)} mm` : '—';
    $('stat-theory-mean').textContent = `Média teórica: ${fmt(expected)} mm`;
    document.querySelectorAll('.stat-threshold').forEach(el => el.textContent = fmt(r.limit_a,0));
    document.querySelectorAll('.stat-threshold-b').forEach(el => el.textContent = fmt(r.limit_b,0));
    $('stat-tail').textContent = a.n ? pc(a.exceedA) : '—';
    $('stat-tail-b').textContent = a.n ? pc(a.exceedB) : '—';
    $('stat-theory-tail').textContent = daily ? `Teoria gama: ${pc(gammaTail(r.limit_a,r.alpha,r.theta))}` : 'Modelo mensal: comparar pela simulação';
    $('stat-theory-tail-b').textContent = daily ? `Teoria gama: ${pc(gammaTail(r.limit_b,r.alpha,r.theta))}` : 'Modelo mensal: sem fórmula gama simples';
    drawChart(r, a);
  }
  function drawChart(r, a) {
    const svg = $('main-chart'), n = a.n;
    const width=900,height=360,margin={left:54,right:15,top:14,bottom:46};
    const cw=width-margin.left-margin.right, ch=height-margin.top-margin.bottom;
    const bins=26;
    let predictedMax = r.modo === 'dia' ? gammaQuantile(.997,r.alpha,r.theta)
      : Math.max(1,31*(1-r.seca)*r.alpha*r.theta*1.9);
    const sorted = [...a.values].sort((x,y)=>x-y);
    const p995 = sorted.length ? sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.995))] : 0;
    const xMax = Math.max(2, predictedMax*1.06, p995*1.1);
    const step=xMax/bins;
    const counts=Array(bins).fill(0), theories=[];
    let outside = 0;
    for(const v of a.values) {
      const idx = Math.floor(v / step);
      if (idx >= bins) outside++;
      else counts[Math.max(0, idx)]++;
    }
    for(let i=0;i<bins;i++) theories.push(r.modo==='dia' ?
      Math.max(0,gammaCDF((i+1)*step,r.alpha,r.theta)-gammaCDF(i*step,r.alpha,r.theta))/step : 0);
    const densities=counts.map(c=>n?c/(n*step):0);
    let yMax=Math.max(...densities,...theories,0.000001)*1.16;
    const xScale=x=>margin.left+x/xMax*cw;
    const yScale=y=>margin.top+ch-(y/yMax)*ch;
    let parts=[];
    parts.push(`<title id="grafico-titulo">Histograma de chuva simulada</title>`);
    parts.push(`<desc id="grafico-descricao">${n} observações. Média ${n?fmt(a.mean):'ainda não calculada'} milímetros. ${r.modo==='dia'?'Linha tracejada representa a gama teórica calculada como densidade média por intervalo.':'Modo mensal misto: apenas frequências simuladas, sem curva gama teórica.'} Uma tabela acessível detalha todos os intervalos após o gráfico.</desc>`);
    for(let i=0;i<=4;i++) {
      const y=i*yMax/4, yy=yScale(y);
      parts.push(`<line x1="${margin.left}" y1="${yy.toFixed(2)}" x2="${width-margin.right}" y2="${yy.toFixed(2)}" stroke="var(--stroke)" stroke-width="1" opacity=".7" />`);
      parts.push(`<text x="${margin.left-9}" y="${(yy+4).toFixed(2)}" text-anchor="end" fill="var(--muted)" font-size="11">${fmt(y,3)}</text>`);
    }
    for(let i=0;i<=5;i++) {
      const x=i*xMax/5, xx=xScale(x);
      parts.push(`<text x="${xx.toFixed(2)}" y="${height-19}" text-anchor="middle" fill="var(--muted)" font-size="12">${fmt(x,0)}</text>`);
    }
    parts.push(`<text x="${margin.left+cw/2}" y="${height-1}" text-anchor="middle" fill="var(--muted)" font-size="12">Precipitação (milímetros)</text>`);
    parts.push(`<text transform="translate(14 ${height/2}) rotate(-90)" text-anchor="middle" fill="var(--muted)" font-size="12">Densidade relativa</text>`);
    for(let i=0;i<bins;i++) {
      const barW=Math.max(1,cw/bins-2.5),barX=margin.left+i*cw/bins+1.25,
        barH=Math.max(0,ch-(yScale(densities[i])-margin.top));
      parts.push(`<rect x="${barX.toFixed(2)}" y="${yScale(densities[i]).toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="2" fill="var(--chart-bars)" opacity=".78"><title>${fmt(i*step)} a ${fmt((i+1)*step)} mm: ${counts[i]} observações</title></rect>`);
    }
    if(r.modo==='dia') {
      // Ligação entre densidades teóricas médias dos mesmos intervalos,
      // evitando a singularidade no eixo zero para alpha menor do que 1.
      const line=theories.map((v,i)=>`${i?'L':'M'} ${xScale((i+.5)*step).toFixed(2)} ${yScale(v).toFixed(2)}`).join(' ');
      parts.push(`<path d="${line}" fill="none" stroke="var(--orange)" stroke-width="3" stroke-dasharray="7 4" stroke-linecap="round" stroke-linejoin="round" />`);
    }
    if(r.limit_a<xMax) {
      const x=xScale(r.limit_a);
      parts.push(`<line x1="${x}" x2="${x}" y1="${margin.top}" y2="${margin.top+ch}" stroke="var(--chart-limit)" stroke-width="2" stroke-dasharray="5 6" />`);
      parts.push(`<text x="${Math.min(width-20,x+6)}" y="25" fill="var(--chart-limit)" font-size="11">${fmt(r.limit_a,0)} mm</text>`);
    }
    svg.innerHTML=parts.join('');
    const tbody=$('histogram-rows'); tbody.replaceChildren();
    counts.forEach((count,i)=>{
      const tr=document.createElement('tr');
      for(const value of [`${fmt(i*step)} – ${fmt((i+1)*step)} mm`,String(count), n?pc(count/n):'—']){
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    if (outside) {
      const tr=document.createElement('tr');
      for (const value of [`Acima de ${fmt(xMax)} mm (fora do gráfico)`, String(outside), pc(outside/n)]) {
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    const note=n===0
      ? 'Nenhum experimento recebido ainda. A linha tracejada representa o modelo teórico (somente no modo diário).'
      : `${n.toLocaleString('pt-BR')} resultados de ${a.members} dispositivo(s). Média observada: ${fmt(a.mean)} mm. Acima de ${fmt(r.limit_a,0)} mm: ${pc(a.exceedA)}. ${outside ? `${outside} valor(es) extremos aparecem na tabela, fora da escala do gráfico. ` : ''}${r.modo==='dia'?'A linha tracejada é a densidade teórica média em cada intervalo do histograma.':'Não desenhamos curva gama teórica, pois o total mensal mistura dias secos e dias com chuva.'}`;
    $('chart-note').textContent=note;
  }
  function updateStudentCounters() {
    const a=aggregate();
    $('my-count').textContent=state.myCount.toLocaleString('pt-BR');
    $('class-count').textContent=Math.max(a.n,state.room?.total_samples||0).toLocaleString('pt-BR');
  }

  // --- Ações do apresentador ---
  async function createRoom(event) {
    event.preventDefault();
    if(!supabaseClient) {toast('Configure o Supabase para criar salas compartilhadas. Você pode testar a demonstração.');return;}
    const pin=$('host-pin').value;
    const button=$('create-form').querySelector('button');button.disabled=true;
    try {
      const {data,error}=await supabaseClient.rpc('gama_create_room',{p_host_pin:pin});
      if(error) throw error;
      save(`gama_host_${data.code}`,data.token);
      $('host-pin').value='';
      await enterHost(await fetchRoom(data.code),data.token);
      toast('Sala criada. Projete o QR code para os alunos.');
    }catch(e){toast(checkError(e));}finally{button.disabled=false;}
  }
  async function joinRoom(event) {
    if(event)event.preventDefault();
    const code=$('room-code').value.trim().toUpperCase();
    if(!/^[0-9A-F]{8}$/.test(code)){toast('Digite um código válido com 8 caracteres hexadecimais.');return;}
    try {await enterStudent(await fetchRoom(code));}
    catch(e){toast(checkError(e));}
  }
  function updateConfigFormForMode() {
    const monthly=$('cfg-mode').value==='mes';
    $('dry-field').hidden=!monthly;
    $('cfg-a').value=monthly?250:30;
    $('cfg-b').value=monthly?300:50;
  }
  async function applySettings(event) {
    event.preventDefault();
    const r=state.room;if(!r)return;
    const modo=$('cfg-mode').value,alpha=+$('cfg-alpha').value,theta=+$('cfg-theta').value,
      seca=+$('cfg-dry').value/100,a=+$('cfg-a').value,b=+$('cfg-b').value;
    if(!(alpha>=.2&&alpha<=8&&theta>=.5&&theta<=100&&seca>=0&&seca<=.95&&a>0&&b>a&&b<=5000)){
      toast('Revise os parâmetros. O segundo limite deve ser maior que o primeiro.');return;
    }
    if(!window.confirm('Aplicar a nova configuração e limpar todas as simulações desta rodada?'))return;
    const button=$('apply-settings');button.disabled=true;
    try{
      if(state.demo) {
        Object.assign(r,{modo,alpha,theta,seca,limit_a:a,limit_b:b,epoch:r.epoch+1,total_samples:0});
        state.batches=[];roomDataChanged();
      }else{
        const {error}=await supabaseClient.rpc('gama_update_room',{
          p_code:r.code,p_host_token:state.hostToken,p_modo:modo,p_alpha:alpha,p_theta:theta,
          p_seca:seca,p_limit_a:a,p_limit_b:b
        });
        if(error)throw error;
        state.room=await fetchRoom(r.code);
        state.batches=[];roomDataChanged();await refreshBatchData();
      }
      toast('Nova configuração aplicada. O histograma recomeçou do zero.');
    }catch(e){toast(checkError(e));}finally{button.disabled=false;}
  }
  async function roomAction(action) {
    const r=state.room;if(!r)return;
    const questions={limpar:'Apagar todas as simulações e iniciar uma nova rodada?',
      encerrar:'Encerrar a sala e bloquear novas simulações?',reabrir:'Reabrir a sala para receber simulações?'};
    if(!window.confirm(questions[action]))return;
    try{
      if(state.demo){
        if(action==='limpar'){r.epoch++;r.total_samples=0;state.batches=[];}
        else r.status=action==='encerrar'?'encerrada':'aberta';
      }else{
        const {error}=await supabaseClient.rpc('gama_room_action',{
          p_code:r.code,p_host_token:state.hostToken,p_action:action});
        if(error)throw error;
        state.room=await fetchRoom(r.code);
        if(action==='limpar')state.batches=[];
      }
      roomDataChanged();
      if(!state.demo)await refreshBatchData();
      toast(action==='limpar'?'Gráfico reiniciado.':action==='encerrar'?'Sala encerrada.':'Sala reaberta.');
    }catch(e){toast(checkError(e));}
  }
  function addDemo(n) {
    const r=state.room;if(!r||!available(r))return;
    const samples=simulateLocal(r,n);
    state.batches.push({participant_id:'demo-local',amostras:samples,id:++state.demoCounter,epoch:r.epoch});
    r.total_samples+=n;
    roomDataChanged();
  }
  let rainTimer;
  function resetRain() {
    clearTimeout(rainTimer);
    $('weather-scene').removeAttribute('data-intensity');
    $('rain-activity').textContent = 'Chuva suave · aguardando';
  }
  function animateRain(n) {
    clearTimeout(rainTimer);
    $('weather-scene').dataset.intensity = String(n);
    $('rain-activity').textContent = n === 50 ? 'Chuva intensa · 50' : n === 10 ? 'Chuva moderada · 10' : 'Chuva leve · 1';
    rainTimer = setTimeout(resetRain, n === 50 ? 6500 : 4500);
  }
  function setupRain() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const drop = document.createElement('i');
      drop.className = 'rain-drop';
      drop.style.setProperty('--x', `${15 + (i * 13.7) % 72}%`);
      drop.style.setProperty('--length', `${10 + i % 4 * 3}px`);
      drop.style.setProperty('--delay', `-${(i * .37) % 2}s`);
      fragment.appendChild(drop);
    }
    $('weather-rain').appendChild(fragment);
    $('pause-rain').addEventListener('click', () => {
      const paused = $('weather-scene').classList.toggle('is-paused');
      $('pause-rain').setAttribute('aria-pressed', String(paused));
      $('pause-rain').textContent = paused ? 'Retomar animação da chuva' : 'Pausar animação da chuva';
    });
  }
  async function submitBatch(n) {
    if(state.busy||!state.room||!available(state.room))return;
    animateRain(n);
    setBusy(true);$('student-feedback').textContent=`Gerando ${n} experimento(s) no servidor…`;
    try{
      const roomCode=state.room.code;
      let data, error;
      if (state.demo) {
        const samples = simulateLocal(state.room, n);
        data = { amostras: samples, total: state.myCount + n };
        state.batches.push({participant_id:state.participantId,amostras:samples});
        state.myCount += n;
      } else {
        ({data,error}=await supabaseClient.rpc('gama_submit',{
          p_code:roomCode,p_participant_id:state.participantId,p_request_id:uid(),p_count:n
        }));
      }
      if(error)throw error;
      animateRain(n);
      const values=data.amostras.map(Number);
      const last=values[values.length-1];
      $('student-last').textContent=`${fmt(last,1)} mm`;
      $('student-last-label').textContent=state.room.modo==='dia'?'Volume sorteado para um dia chuvoso':'Acumulado em um janeiro simulado';
      $('student-feedback').textContent=`${n} simulação(ões) ${state.demo ? 'locais, sem envio' : 'enviada(s)'}! Média deste lote: ${fmt(values.reduce((s,v)=>s+v,0)/values.length)} mm.`;
      state.room.total_samples=Math.max(state.room.total_samples,data.total);
      updateStudentCounters();
      await refreshBatchData();
    }catch(e){resetRain();$('student-feedback').textContent=checkError(e);}
    finally{setBusy(false);}
  }
  function leave() {resetRain();disconnect();state.room=null;state.role=null;state.demo=false;state.batches=[];updateURL(null);showScreen('landing');setTop('Pronto para começar');}

  function setDashboardFocus(active) {
    document.body.classList.toggle('dashboard-focus', active);
    $('focus-dashboard').setAttribute('aria-pressed', String(active));
    $('focus-dashboard').textContent = active ? 'Voltar ao painel (Esc)' : 'Enquadrar painel (PgDn)';
  }

  function hookEvents() {
    setupRain();
    $('focus-dashboard').addEventListener('click', () => {
      setDashboardFocus($('focus-dashboard').getAttribute('aria-pressed') !== 'true');
    });
    document.body.addEventListener('keydown', event => {
      if (state.role !== 'host' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.key === 'PageDown') {
        event.preventDefault();
        setDashboardFocus(true);
        $('focus-dashboard').focus({ preventScroll: true });
      } else if (event.key === 'Escape') {
        setDashboardFocus(false);
      }
    });
    $('create-form').addEventListener('submit',createRoom);
    $('join-form').addEventListener('submit',joinRoom);
    $('demo-start').addEventListener('click',()=>enterHost(defaultRoom(),null,true));
    $('student-preview').addEventListener('click',enterStudentPreview);
    $('copy-link').addEventListener('click',async()=>{
      if(state.demo)return;
      const url=joinUrl(state.room.code);
      try{await navigator.clipboard.writeText(url);toast('Link de participação copiado.');}
      catch(_){window.prompt('Copie o link dos alunos:',url);}
    });
    $('cfg-mode').addEventListener('change',updateConfigFormForMode);
    $('settings-form').addEventListener('submit',applySettings);
    $('clear-room').addEventListener('click',()=>roomAction('limpar'));
    $('toggle-room').addEventListener('click',()=>roomAction(available(state.room)?'encerrar':'reabrir'));
    $('leave-host').addEventListener('click',leave);
    $('leave-student').addEventListener('click',leave);
    $('simulate-demo-1').addEventListener('click',()=>addDemo(10));
    $('simulate-demo-50').addEventListener('click',()=>addDemo(50));
    document.querySelectorAll('.simulation-button').forEach(button=>{
      button.addEventListener('click',()=>submitBatch(Number(button.dataset.n)));
    });
  }
  async function init() {
    hookEvents();
    if(!supabaseClient){$('setup-warning').hidden=false;setTop('Configuração pendente');}
    const params=new URLSearchParams(location.search);
    if(params.get('preview')==='aluno'){enterStudentPreview();return;}
    if(params.get('demo')==='1'){await enterHost(defaultRoom(),null,true);return;}
    const s=params.get('s');
    if(s){
      $('room-code').value=s.toUpperCase();
      if(supabaseClient){try{await enterStudent(await fetchRoom(s));}catch(e){toast(checkError(e));}}
      return;
    }
    const host=params.get('painel');
    if(host&&supabaseClient){
      const token=restore(`gama_host_${host}`);
      if(token){try{await enterHost(await fetchRoom(host),token);return;}catch(e){toast(checkError(e));}}
      else toast('O acesso ao painel está disponível somente no navegador em que a sala foi criada.');
    }
  }
  init().catch(e=>{console.error(e);toast(checkError(e));});
})();
