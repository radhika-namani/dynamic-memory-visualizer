/* Dynamic Memory Management Visualizer
   Supports: Paging (FIFO, LRU), Segmentation, Virtual Memory
*/

// ---------- State ----------
const state = {
  module: 'paging',
  // paging state
  capacity: 3,
  frames: [],
  refs: [],
  index: 0,
  faults: 0,
  hits: 0,
  processed: 0,
  algo: 'FIFO',
  fifoPointer: 0,
  lruTime: [],
  timer: null,
  running: false,
  // segmentation state
  segments: {}, // {name:{base,limit}}
  // virtual memory state
  pageSize: 100,
  pageTable: {}, // map pageNum -> frame or -1
  physFrames: [],
  physCapacity: 3
};

// ---------- DOM ----------
const $module = document.getElementById('module');
const $algo = document.getElementById('algo');
const $framesArea = document.getElementById('framesArea');
const $timeline = document.getElementById('timeline');
const $log = document.getElementById('log');
const $tableArea = document.getElementById('tableArea');

const $framesInput = document.getElementById('frames');
const $refStr = document.getElementById('refstr');

const $segmentsInput = document.getElementById('segments');
const $segAddr = document.getElementById('segAddr');

const $pageSizeInput = document.getElementById('pageSize');
const $virtRef = document.getElementById('virtRef');

const $processed = document.getElementById('processed');
const $faults = document.getElementById('faults');
const $hits = document.getElementById('hits');
const $frameCount = document.getElementById('frameCount');
const $totalRefs = document.getElementById('totalRefs');
const $totalFaults = document.getElementById('totalFaults');
const $totalHits = document.getElementById('totalHits');
const $faultRate = document.getElementById('faultRate');
const $visualTitle = document.getElementById('visualTitle');

// ---------- Utility ----------
function now(){ return new Date().toLocaleTimeString(); }
function appendLog(msg){ $log.innerHTML = `[${now()}] ${msg}\n` + $log.innerHTML; }
function parseRefs(raw){
  if(!raw) return [];
  return raw.split(/[, \t]+/).map(s=>s.trim()).filter(s=>s!=="").map(s=>{
    const n=Number(s); return Number.isNaN(n)?s:n;
  });
}

// ---------- UI Switch ----------
function showModuleInputs(){
  document.getElementById('pagingInputs').style.display = (state.module==='paging')?'block':'none';
  document.getElementById('segInputs').style.display = (state.module==='segmentation')?'block':'none';
  document.getElementById('virtInputs').style.display = (state.module==='virtual')?'block':'none';
  if(state.module === 'paging'){ $visualTitle.textContent = 'Frames (physical memory)'; }
  if(state.module === 'segmentation'){ $visualTitle.textContent = 'Segments / Memory Map'; }
  if(state.module === 'virtual'){ $visualTitle.textContent = 'Physical Frames (for pages)'; }
}

// ---------- RESET / LOAD ----------
function resetCommon(){
  state.faults = state.hits = state.processed = state.index = 0;
  if(state.timer){ clearInterval(state.timer); state.timer = null; state.running=false; }
  state.fifoPointer = 0;
  appendLog('State reset.');
}

function load(){
  state.module = $module.value;
  state.algo = $algo.value;
  showModuleInputs();

  resetCommon();

  if(state.module === 'paging'){
    state.capacity = Number($framesInput.value) || 3;
    state.frames = Array(state.capacity).fill(null);
    state.lruTime = Array(state.capacity).fill(0);
    state.refs = parseRefs($refStr.value);
    renderTimeline();
    appendLog(`Paging loaded. Frames=${state.capacity}, refs=${state.refs.length}, algo=${state.algo}`);
  }

  if(state.module === 'segmentation'){
    // parse segments input "name:base:limit,..." (base & limit parse to numbers)
    const raw = $segmentsInput.value || '';
    const parts = raw.split(',').map(s=>s.trim()).filter(s=>s.length);
    state.segments = {};
    for(const p of parts){
      const [name,b,l] = p.split(':').map(x=>x.trim());
      const base = Number(b); const limit = Number(l);
      if(!name || Number.isNaN(base) || Number.isNaN(limit)) continue;
      state.segments[name] = {base, limit};
    }
    appendLog(`Segments loaded: ${Object.keys(state.segments).join(', ')}`);
    renderSegmentsTable();
  }

  if(state.module === 'virtual'){
    state.pageSize = Number($pageSizeInput.value) || 100;
    // simple physical frames count reuse frames input
    state.physCapacity = Number($framesInput.value) || 3;
    state.physFrames = Array(state.physCapacity).fill(null);
    state.pageTable = {}; // empty map page->frame
    // parse refs either single number or list
    state.refs = parseRefs($virtRef.value);
    renderTimeline();
    appendLog(`Virtual memory loaded. pageSize=${state.pageSize}, physFrames=${state.physCapacity}, refs=${state.refs.length}`);
  }

  renderAll();
}

// ---------- RENDER HELPERS ----------
function renderFrames(highlightIndex=-1, isFault=false){
  $framesArea.innerHTML = '';
  if(state.module === 'segmentation'){
    // show memory map: display each segment as a pill showing base-limit
    for(const [name,seg] of Object.entries(state.segments)){
      const d = document.createElement('div');
      d.className = 'frame';
      d.style.width = '170px';
      d.textContent = `${name}: ${seg.base}-${seg.limit}`;
      $framesArea.appendChild(d);
    }
    return;
  }

  // paging or virtual frames
  const arr = (state.module==='paging')?state.frames:state.physFrames;
  for(let i=0;i<arr.length;i++){
    const d = document.createElement('div');
    d.className = 'frame' + (arr[i]===null ? ' empty':'');
    if(i===highlightIndex && isFault) d.classList.add('fault');
    if(i===highlightIndex && !isFault) d.classList.add('updated');
    d.textContent = arr[i]===null ? '-' : arr[i];
    $framesArea.appendChild(d);
  }
}

function renderTimeline(){
  $timeline.innerHTML = '';
  const refs = state.refs || [];
  refs.forEach((r, idx)=>{
    const t = document.createElement('div');
    t.className = 'tick' + (idx===state.index?' current':'');
    t.dataset.idx = idx;
    t.textContent = r;
    $timeline.appendChild(t);
  });
}

function renderSegmentsTable(){
  let txt = 'Segment Table:\n';
  for(const [n,s] of Object.entries(state.segments)){
    txt += `${n} → base: ${s.base}, limit: ${s.limit}\n`;
  }
  $tableArea.textContent = txt;
}

function renderPageTable(){
  let txt = 'Page Table (page → frame or -1):\n';
  for(const [p,f] of Object.entries(state.pageTable)){
    txt += `page ${p} → frame ${f}\n`;
  }
  $tableArea.textContent = txt;
}

function renderStats(){
  $processed.textContent = state.processed;
  $faults.textContent = state.faults;
  $hits.textContent = state.hits;
  $frameCount.textContent = (state.module==='segmentation')?Object.keys(state.segments).length:(state.module==='paging'?state.capacity:state.physCapacity);
  $totalRefs.textContent = state.refs.length || 0;
  $totalFaults.textContent = state.faults;
  $totalHits.textContent = state.hits;
  $faultRate.textContent = ((state.faults/Math.max(1,state.processed))*100).toFixed(1) + '%';
}

function renderAll(){
  renderFrames();
  renderTimeline();
  if(state.module === 'segmentation') renderSegmentsTable();
  if(state.module === 'virtual') renderPageTable();
  renderStats();
}

// ---------- STEP LOGIC ----------

function stepOnce(){
  if(state.module === 'paging') return stepPaging();
  if(state.module === 'segmentation') return stepSegmentation();
  if(state.module === 'virtual') return stepVirtual();
}

/* ---------- Paging: FIFO & LRU ---------- */
function stepPaging(){
  if(state.index >= state.refs.length){ appendLog('All references processed.'); stopAuto(); return; }
  const ref = state.refs[state.index];
  state.processed++;
  appendLog(`Paging access ${state.index}: ${ref}`);

  const fIndex = state.frames.indexOf(ref);
  if(fIndex !== -1){
    // hit
    state.hits++;
    appendLog(`Hit in frame ${fIndex}`);
    if(state.algo === 'LRU') state.lruTime[fIndex] = state.processed;
    renderFrames(fIndex,false);
    markTimeline(state.index,false);
  } else {
    // fault
    state.faults++;
    appendLog('Page fault');
    if(state.frames.includes(null)){
      const free = state.frames.indexOf(null);
      state.frames[free] = ref;
      appendLog(`Placed in free frame ${free}`);
      if(state.algo === 'LRU') state.lruTime[free] = state.processed;
      renderFrames(free,true);
      markTimeline(state.index,true);
    } else {
      let replaceIndex = 0;
      if(state.algo === 'FIFO'){
        replaceIndex = state.fifoPointer % state.capacity;
        state.fifoPointer = (state.fifoPointer+1) % state.capacity;
      } else {
        // LRU: smallest timestamp
        let min = Infinity;
        for(let i=0;i<state.capacity;i++){
          if(state.lruTime[i] < min){ min = state.lruTime[i]; replaceIndex = i; }
        }
      }
      appendLog(`Replacing frame ${replaceIndex} (was ${state.frames[replaceIndex]})`);
      state.frames[replaceIndex] = ref;
      if(state.algo === 'LRU') state.lruTime[replaceIndex] = state.processed;
      renderFrames(replaceIndex,true);
      markTimeline(state.index,true);
    }
  }

  state.index++;
  renderPageTable();
  renderStats();
  renderTimeline();
  if(state.index >= state.refs.length){ appendLog('Finished paging sequence'); stopAuto(); }
}

function renderPageTable(){ // reused for paging too: show mapping
  if(state.module === 'paging'){
    let txt = 'Frame Table:\n';
    for(let i=0;i<state.frames.length;i++){
      txt += `Frame ${i}: ${state.frames[i] === null?'-':state.frames[i]}\n`;
    }
    $tableArea.textContent = txt;
  } else if(state.module === 'virtual'){
    // implemented separately above
    renderPageTable();
  }
}

/* ---------- Segmentation ---------- */
function stepSegmentation(){
  // single access: parse segAddr input or do once
  const raw = document.getElementById('segAddr').value.trim();
  if(!raw){ appendLog('No segmentation address provided'); return; }
  // format segment:offset
  const [segName, offStr] = raw.split(':').map(s=>s.trim());
  const offset = Number(offStr);
  appendLog(`Segmentation access: ${segName}:${offset}`);

  if(!(segName in state.segments)){ appendLog('Segment not found → segment fault'); state.faults++; renderStats(); return; }
  const seg = state.segments[segName];
  if(offset < 0 || offset > seg.limit){ appendLog(`Offset ${offset} out of range → segment fault`); state.faults++; renderStats(); return; }
  const phys = seg.base + offset;
  appendLog(`Translated logical ${segName}:${offset} → physical address ${phys}`);
  state.processed++;
  state.hits++;
  renderFrames();
  renderSegmentsTable();
  renderStats();
}

/* ---------- Virtual Memory ---------- */
function stepVirtual(){
  if(state.index >= state.refs.length){ appendLog('All virtual refs processed'); stopAuto(); return; }
  const ref = Number(state.refs[state.index]);
  state.processed++;
  appendLog(`Virtual access ${state.index}: logical address ${ref}`);
  // compute page number and offset
  const pageNum = Math.floor(ref / state.pageSize);
  const offset = ref % state.pageSize;
  appendLog(`page=${pageNum}, offset=${offset}`);

  // page table: if exists -> hit
  if(state.pageTable.hasOwnProperty(pageNum) && state.pageTable[pageNum] !== -1){
    const frameNum = state.pageTable[pageNum];
    state.hits++;
    appendLog(`Page hit: page ${pageNum} in frame ${frameNum}`);
    // update LRU time for that frame
    state.lruTime[frameNum] = state.processed;
    renderFrames(frameNum,false);
    markTimeline(state.index,false);
  } else {
    // page fault - need to bring page into a frame
    state.faults++;
    appendLog(`Page fault for page ${pageNum}`);
    // free frame?
    if(state.physFrames.includes(null)){
      const free = state.physFrames.indexOf(null);
      state.physFrames[free] = pageNum;
      state.pageTable[pageNum] = free;
      appendLog(`Loaded page ${pageNum} into free frame ${free}`);
      state.lruTime[free] = state.processed;
      renderFrames(free,true);
      markTimeline(state.index,true);
    } else {
      // replacement algorithm: use state.algo (FIFO/LRU)
      let replaceIndex = 0;
      if(state.algo === 'FIFO'){
        replaceIndex = state.fifoPointer % state.physCapacity;
        state.fifoPointer = (state.fifoPointer+1) % state.physCapacity;
      } else {
        // LRU: smallest lruTime
        let min = Infinity;
        for(let i=0;i<state.physCapacity;i++){
          if(state.lruTime[i] < min){ min = state.lruTime[i]; replaceIndex = i; }
        }
      }
      const oldPage = state.physFrames[replaceIndex];
      // evict old page
      if(oldPage !== null && state.pageTable.hasOwnProperty(oldPage)) state.pageTable[oldPage] = -1;
      // load new page
      state.physFrames[replaceIndex] = pageNum;
      state.pageTable[pageNum] = replaceIndex;
      state.lruTime[replaceIndex] = state.processed;
      appendLog(`Replaced frame ${replaceIndex}: evicted page ${oldPage} -> loaded page ${pageNum}`);
      renderFrames(replaceIndex,true);
      markTimeline(state.index,true);
    }
    renderPageTable();
  }

  state.index++;
  renderStats();
  renderTimeline();
  if(state.index >= state.refs.length){ appendLog('Virtual ref sequence finished'); stopAuto(); }
}

/* ---------- Helpers ---------- */
function markTimeline(idx, isFault){
  const el = $timeline.querySelector(`[data-idx='${idx}']`);
  if(!el) return;
  if(isFault) el.classList.add('fault');
  el.classList.add('current');
}

function runAuto(){
  if(state.running) return;
  state.running = true;
  const ms = Math.max(50, Number(document.getElementById('speed2').value) || 700);
  state.timer = setInterval(()=>{
    stepOnce();
    if(state.index >= state.refs.length) stopAuto();
  }, ms);
  appendLog(`Autoplay started (ms=${ms})`);
}
function stopAuto(){
  if(state.timer){ clearInterval(state.timer); state.timer = null; state.running = false; appendLog('Autoplay stopped'); }
}

// ---------- Bindings ----------
document.getElementById('load').addEventListener('click', load);
document.getElementById('reset').addEventListener('click', ()=>{
  resetCommon(); renderAll();
});
document.getElementById('step').addEventListener('click', ()=>{ stepOnce(); });
document.getElementById('run').addEventListener('click', ()=>{ if(!state.running) runAuto(); else stopAuto(); });

$module.addEventListener('change', ()=>{ state.module = $module.value; showModuleInputs(); renderAll(); });

// initialize default
showModuleInputs();
load();
