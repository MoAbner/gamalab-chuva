/* Standalone local comparison; no collective state or network operations. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { gammaCDF, gammaTail, gammaQuantile, gammaSample } = window.GamaMath;
  const fmt = (n, d = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
  const pct = n => `${fmt(n * 100)}%`;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dash = ['', '10 5', '2 5'];
  let mode = 'free', shared = 15;
  let scenarios = presets();
  function presets() {
    return [0.8, 2, 3].map((alpha, i) => ({ id: 'ABC'[i], name: ['Volumes pequenos', 'Volumes intermediários', 'Volumes maiores'][i], alpha, theta: 15, visible: true, samples: [] }));
  }
  function constrain() {
    scenarios.forEach(s => {
      if (mode === 'alpha') s.theta = shared;
      if (mode === 'theta') s.alpha = shared;
      if (mode === 'mean') s.theta = shared / s.alpha;
    });
  }
  function clearSamples() {
    scenarios.forEach(s => s.samples = []);
    $('simulation-status').textContent = 'Parâmetros atualizados. Gere novas amostras para comparar com a teoria.';
  }
  function controls() {
    $('scenario-controls').innerHTML = scenarios.map((s, i) => `<fieldset class="panel scenario scenario-${i}"><legend>Cenário ${s.id} · ${['linha contínua','linha tracejada','linha pontilhada'][i]}</legend><label for="name-${i}">Identificação</label><input id="name-${i}" data-i="${i}" data-field="name" value="${escape(s.name)}" maxlength="60"><div class="field-row"><div><label for="alpha-${i}">Forma α</label><input id="alpha-${i}" data-i="${i}" data-field="alpha" type="number" min="0.2" max="8" step="any" value="${s.alpha}" ${mode === 'theta' ? 'disabled' : ''}></div><div><label for="theta-${i}">Escala θ (mm)</label><input id="theta-${i}" data-i="${i}" data-field="theta" type="number" min="0.01" max="500" step="any" value="${s.theta}" ${mode !== 'free' && mode !== 'theta' ? 'disabled' : ''}></div></div><label class="visibility"><input type="checkbox" data-i="${i}" data-field="visible" ${s.visible ? 'checked' : ''}> Exibir cenário ${s.id}</label></fieldset>`).join('');
  }
  function render() {
    const visible = scenarios.filter(s => s.visible);
    const limit = Number($('compare-limit').value);
    if (!$('compare-limit').checkValidity() || $('compare-limit').value === '') return;
    $('compare-legend').innerHTML = scenarios.map((s, i) => s.visible ? `<span class="scenario-${i}"><svg width="30" height="10" aria-hidden="true"><path d="M0 5H30" stroke="currentColor" stroke-width="3" stroke-dasharray="${dash[i]}"/></svg>${s.id} · ${escape(s.name)} · α ${fmt(s.alpha)} / θ ${fmt(s.theta)}</span>` : '').join('');
    $('compare-stats').replaceChildren();
    visible.forEach(s => {
      const row = document.createElement('tr'), n = s.samples.length;
      const values = [`${s.id} · ${s.name}`, fmt(s.alpha*s.theta), fmt(s.alpha*s.theta**2), fmt(Math.sqrt(s.alpha)*s.theta), pct(gammaCDF(limit,s.alpha,s.theta)), pct(gammaTail(limit,s.alpha,s.theta)), String(n), n ? fmt(s.samples.reduce((a,b)=>a+b,0)/n) : '—', n ? pct(s.samples.filter(x=>x>limit).length/n) : '—'];
      values.forEach(value => { const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell); });
      $('compare-stats').appendChild(row);
    });
    const differences=[];
    visible.forEach((s,i)=>visible.slice(i+1).forEach(t=>differences.push(`P${s.id} − P${t.id}: ${fmt(100*(gammaTail(limit,s.alpha,s.theta)-gammaTail(limit,t.alpha,t.theta)))} pontos percentuais`)));
    $('probability-differences').textContent=differences.join(' · ');
    $('comparison-summary').textContent = visible.length ? visible.map(s=>`${s.id}: média ${fmt(s.alpha*s.theta)} mm, desvio ${fmt(Math.sqrt(s.alpha)*s.theta)} mm e assimetria ${fmt(2/Math.sqrt(s.alpha))}.`).join(' ') : 'Nenhum cenário visível. Ative uma curva nos controles.';
    draw(visible, limit);
  }
  function draw(visible, limit) {
    const bins=100, histBins=25, left=65, right=875, top=30, bottom=345;
    const xMax=visible.length ? Math.max(...visible.map(s=>gammaQuantile(.997,s.alpha,s.theta))) * 1.05 : 100;
    const step=xMax/bins, histStep=xMax/histBins;
    const series=visible.map(s=>{
      const density=Array.from({length:bins},(_,i)=>Math.max(0,gammaCDF((i+1)*step,s.alpha,s.theta)-gammaCDF(i*step,s.alpha,s.theta))/step);
      const counts=Array(histBins).fill(0);
      s.samples.forEach(v=>{const bin=Math.floor(v/histStep);if(bin<histBins)counts[bin]++;});
      return {s,density,hist:counts.map(c=>s.samples.length?c/(s.samples.length*histStep):0)};
    });
    const histograms=$('show-histograms').checked;
    const yMax=Math.max(.001,...series.flatMap(d=>d.density),...(histograms?series.flatMap(d=>d.hist):[]))*1.1;
    const x=v=>left+v/xMax*(right-left), y=v=>bottom-v/yMax*(bottom-top);
    const parts=['<title id="compare-title">Comparação de distribuições Gama</title>',`<desc id="compare-description">${escape($('comparison-summary').textContent)} Densidades médias por intervalo em eixos comuns. Indicadores completos na tabela abaixo.</desc>`];
    for(let i=0;i<=5;i++){
      const yy=y(yMax*i/5),xx=x(xMax*i/5);
      parts.push(`<path d="M${left} ${yy}H${right}" stroke="var(--stroke)"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${fmt(yMax*i/5,4)}</text><text x="${xx}" y="365" text-anchor="middle">${fmt(xMax*i/5,1)}</text>`);
    }
    series.forEach(({s,density,hist})=>{
      const index=scenarios.indexOf(s),color=`var(--compare-${index})`;
      if($('show-tail').checked && limit<xMax){
        // Integrate only the portion of a bin above the threshold for shading.
        for(let i=0;i<bins;i++){
          const lo=Math.max(limit,i*step),hi=(i+1)*step;
          if(hi<=lo)continue;
          const d=(gammaCDF(hi,s.alpha,s.theta)-gammaCDF(lo,s.alpha,s.theta))/(hi-lo);
          parts.push(`<rect x="${x(lo)}" y="${y(d)}" width="${x(hi)-x(lo)}" height="${bottom-y(d)}" fill="${color}" opacity=".12"/>`);
        }
      }
      if(histograms && s.samples.length)hist.forEach((d,i)=>parts.push(`<rect x="${x(i*histStep)}" y="${y(d)}" width="${x(histStep)-left}" height="${bottom-y(d)}" fill="${color}" fill-opacity=".09" stroke="${color}" stroke-opacity=".6" stroke-dasharray="${dash[index]}"/>`));
      const path=density.map((d,i)=>`${i?'L':'M'}${x((i+.5)*step)} ${y(d)}`).join(' ');
      parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.8" stroke-dasharray="${dash[index]}"><title>Cenário ${s.id}: ${escape(s.name)}</title></path>`);
    });
    if(limit<=xMax)parts.push(`<path d="M${x(limit)} ${top}V${bottom}" stroke="var(--muted)" stroke-dasharray="4 5"/><text x="${Math.min(x(limit)+5,800)}" y="20">Limite: ${fmt(limit)} mm</text>`);
    parts.push('<text x="470" y="395" text-anchor="middle">Precipitação (mm)</text><text transform="translate(15 190) rotate(-90)" text-anchor="middle">Densidade de probabilidade (1/mm)</text>');
    $('compare-chart').innerHTML=parts.join('');
    const outside=visible.map(s=>`${s.id}: ${s.samples.filter(v=>v>=xMax).length} amostras fora da escala`).join(' · ');
    $('range-note').textContent=`Escala até ${fmt(xMax)} mm, baseada no quantil 99,7% dos modelos. As caudas continuam além da área desenhada; as probabilidades da tabela incluem toda a cauda. ${outside}`;
  }
  $('scenario-controls').addEventListener('input',event=>{
    const input=event.target,field=input.dataset.field;
    if(!field)return;
    const s=scenarios[Number(input.dataset.i)];
    if(field==='name')s.name=input.value;
    else if(field==='visible')s.visible=input.checked;
    else{
      if(!input.checkValidity() || input.value==='')return;
      s[field]=Number(input.value);constrain();clearSamples();
      if(mode==='mean')scenarios.forEach((s,i)=>$('theta-'+i).value=s.theta);
    }
    render();
  });
  $('compare-mode').addEventListener('change',()=>{
    mode=$('compare-mode').value;
    shared=mode==='theta'?2:mode==='mean'?12:15;
    $('shared-wrap').hidden=mode==='free';$('shared-value').value=shared;
    $('shared-value').min=mode==='theta'?.2:.5;$('shared-value').max=mode==='theta'?8:100;
    $('shared-label').textContent=mode==='theta'?'Forma α comum':mode==='mean'?'Média comum (mm)':'Escala θ comum (mm)';
    $('mode-help').textContent={free:'Ajuste cada cenário de forma independente.',alpha:'θ permanece igual: α altera formato, média e dispersão.',theta:'α permanece igual: θ muda a escala, mantendo a forma relativa.',mean:'θ = média / α: médias iguais podem ter variâncias e probabilidades diferentes.'}[mode];
    constrain();clearSamples();controls();render();
  });
  $('shared-value').addEventListener('input',()=>{const el=$('shared-value');if(!el.checkValidity()||el.value==='')return;shared=Number(el.value);constrain();clearSamples();controls();render();});
  $('load-presets').addEventListener('click',()=>{scenarios=presets();mode='free';$('compare-mode').value='free';$('shared-wrap').hidden=true;$('mode-help').textContent='Três modelos hipotéticos com θ = 15 mm. Médias: 12, 30 e 45 mm.';clearSamples();controls();render();});
  ['compare-limit','show-tail','show-histograms'].forEach(id=>$(id).addEventListener('input',render));
  $('simulate-comparison').addEventListener('click',()=>{
    // Prevent using stale valid parameters while a number field is incomplete.
    const invalid=[...document.querySelectorAll('.comparison input[type=number]')].find(el=>!el.disabled&&(!el.checkValidity()||el.value===''));
    if(invalid){invalid.focus();invalid.reportValidity();return;}
    const n=Number($('sample-size').value);
    scenarios.forEach(s=>s.samples=Array.from({length:n},()=>gammaSample(s.alpha,s.theta)));
    $('show-histograms').checked=true;render();
    $('simulation-status').textContent=`${fmt(n,0)} observações geradas para cada cenário. Histogramas normalizados por n × largura do intervalo. Novos sorteios produzem diferenças aleatórias; não se espera coincidência perfeita com a teoria.`;
  });
  controls();render();
})();
