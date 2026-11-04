const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../docs',name),'utf8');
const context={window:{}};
vm.createContext(context);vm.runInContext(read('gamma-math.js'),context);
const math=context.window.GamaMath;
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} versus ${b}`);
test('CDF matches exponential and integer shape closed forms',()=>{
  for(const x of [.01,1,10,30,100]){
    const z=x/15;
    close(math.gammaCDF(x,1,15),1-Math.exp(-z));
    close(math.gammaCDF(x,2,15),1-Math.exp(-z)*(1+z));
    close(math.gammaCDF(x,3,15),1-Math.exp(-z)*(1+z+z*z/2));
  }
  close(math.gammaTail(30,.8,15),.0943,.0001);
});
test('quantiles invert CDF across permitted shape/scale ranges',()=>{
  for(const a of [.2,.8,1,2,8])for(const theta of [.0625,15,500])for(const q of [.01,.5,.997]){
    close(math.gammaCDF(math.gammaQuantile(q,a,theta),a,theta),q,1e-8);
  }
});
test('samples are positive and approach expected moments with a seeded RNG',()=>{
  let seed=5231;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(const a of [.8,2,3]){
    const n=60000, samples=Array.from({length:n},()=>math.gammaSample(a,15,rng));
    assert.ok(samples.every(x=>x>0&&Number.isFinite(x)));
    const mean=samples.reduce((a,b)=>a+b,0)/n;
    const variance=samples.reduce((sum,x)=>sum+(x-mean)**2,0)/n;
    assert.ok(Math.abs(mean-a*15)/(a*15)<.025);
    assert.ok(Math.abs(variance-a*225)/(a*225)<.05);
  }
});
function harness(){
  const elements=new Map();
  function element(){return {value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',children:[],listeners:{},checkValidity(){return true;},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  get('compare-limit').value='30';get('show-tail').checked=true;get('sample-size').value='100';
  const ctx={window:{GamaMath:math},document:{getElementById:get,createElement:element,querySelectorAll:()=>[]}};
  vm.runInNewContext(read('comparison.js'),ctx);
  return {get,fire:(id,type='input',event={})=>get(id).listeners[type](event)};
}
test('comparison renders three scenarios, modes, simulation, visibility and escaped labels',()=>{
  const {get,fire}=harness();
  assert.equal(get('compare-stats').children.length,3);
  assert.match(get('compare-chart').innerHTML,/stroke-dasharray="10 5"/);
  for(const mode of ['alpha','theta','mean','free']){
    get('compare-mode').value=mode;fire('compare-mode','change');
    const rows=get('compare-stats').children;
    if(mode==='mean')rows.forEach(row=>assert.equal(row.children[1].textContent,'12'));
    assert.ok(!/NaN|Infinity/.test(get('compare-chart').innerHTML));
  }
  fire('simulate-comparison','click');
  get('compare-stats').children.forEach(row=>assert.equal(row.children[6].textContent,'100'));
  get('sample-size').value='5000';fire('simulate-comparison','click');
  get('compare-stats').children.forEach(row=>assert.equal(row.children[6].textContent,'5000'));
  fire('scenario-controls','input',{target:{dataset:{field:'name',i:'0'},value:'<img src=x>'}});
  assert.ok(!get('compare-legend').innerHTML.includes('<img'));
  for(const i of ['0','1','2'])fire('scenario-controls','input',{target:{dataset:{field:'visible',i},checked:false}});
  assert.equal(get('compare-stats').children.length,0);
  assert.ok(!/NaN|Infinity/.test(get('compare-chart').innerHTML));
  fire('load-presets','click');assert.equal(get('compare-stats').children.length,3);
});
test('rain responds immediately to a batch and resets after the effect',()=>{
  const source=read('app.js'),start=source.indexOf('  let rainTimer;');
  const scene={dataset:{},removeAttribute(){delete this.dataset.intensity;}},label={textContent:''};
  let callback;
  const ctx={$:id=>id==='weather-scene'?scene:label,clearTimeout(){},setTimeout(fn){callback=fn;return 1;}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,source.indexOf('  function setupRain()',start)),ctx);
  for(const n of [1,10,50]){
    vm.runInContext(`animateRain(${n})`,ctx);assert.equal(scene.dataset.intensity,String(n));
    callback();assert.equal(scene.dataset.intensity,undefined);
  }
  const submit=source.slice(source.indexOf('  async function submitBatch'),source.indexOf('  function leave()'));
  assert.ok(submit.indexOf('animateRain(n)')<submit.indexOf('supabaseClient.rpc'));
  assert.match(submit,/catch\(e\)\{resetRain\(\)/);
});
test('collective loads shared mathematics before app and comparison does not load Supabase',()=>{
  const collective=read('index.html'),comparison=read('comparison.html');
  assert.ok(collective.indexOf('src="gamma-math.js"')<collective.indexOf('src="app.js"'));
  assert.ok(!comparison.includes('src="app.js"')&&!comparison.includes('supabase'));
  const ids=[...collective.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
});
test('student preview builds rain, simulates all batches without network and pauses',async()=>{
  const nodes=new Map();
  function element(){
    const classes=new Set();
    return {dataset:{},hidden:false,children:[],textContent:'',style:{setProperty(){}},listeners:{},
      classList:{toggle(name,force){const value=force===undefined?!classes.has(name):force;value?classes.add(name):classes.delete(name);return value;}},
      setAttribute(){},removeAttribute(name){if(name==='data-intensity')delete this.dataset.intensity;},
      addEventListener(name,fn){this.listeners[name]=fn;},appendChild(child){this.children.push(child);}};
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const buttons=[1,10,50].map(n=>Object.assign(element(),{dataset:{n:String(n)}}));
  const timers=[];
  const ctx={window:{GamaMath:math,scrollTo(){}},document:{body:element(),getElementById:get,querySelectorAll:selector=>selector==='.simulation-button'?buttons:[],createDocumentFragment:element,createElement:element},location:{search:'?preview=aluno',href:'http://localhost/index.html?preview=aluno'},history:{replaceState(){}},URL,URLSearchParams,console,
    setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},clearInterval(){}};
  vm.runInNewContext(read('app.js'),ctx);
  assert.equal(get('student-screen').hidden,false);
  assert.equal(get('weather-rain').children[0].children.length,42);
  assert.match(get('student-status').textContent,/local/);
  for(let i=0;i<buttons.length;i++){
    await buttons[i].listeners.click();
    assert.equal(get('weather-scene').dataset.intensity,buttons[i].dataset.n);
    assert.match(get('student-feedback').textContent,/sem envio/);
    assert.match(get('student-last').textContent,/mm/);
  }
  assert.equal(get('my-count').textContent,'61');
  assert.equal(get('class-count').textContent,'61');
  get('pause-rain').listeners.click();assert.match(get('pause-rain').textContent,/Retomar/);
  get('pause-rain').listeners.click();assert.match(get('pause-rain').textContent,/Pausar/);
  timers.at(-1)();assert.equal(get('weather-scene').dataset.intensity,undefined);
  get('leave-student').listeners.click();assert.equal(get('landing').hidden,false);
});

