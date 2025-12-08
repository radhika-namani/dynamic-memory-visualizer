/* Dynamic Memory Management Visualizer
   Supports: Paging (FIFO, LRU), Segmentation, Virtual Memory
   + Memory Access Timeline Graph (Hits vs Faults) for Paging & Virtual
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

// ---------- Graph State (Memory Access Timeline) ----------
let chartCtx = null;
let chartData = [];   // 1 = Hit, 0 = Fault (in order)
let chartPoints = []; // [{x,y,value,index}, ...] for tooltip

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

const $tooltip = document.getElementById('accessTooltip');
const $downloadGraph = document.getElementById('downloadGraph');
const $downloadLog = document.getElementById('downloadLog');

// ---------- Utility ----------
function now(){ return new Date().toLocaleTimeString(); }
function appendLog(msg){
  $log.innerHTML = `[${now()}] ${msg}\n` + $log.innerHTML;
}
function parseRefs(raw){
  if(!raw) return [];
  return raw
    .split(/[, \t]+/)
    .map(s=>s.trim())
    .filter(s=>s!=="")
    .map(s=>{
      const n = Number(s);
      return Number.isNaN(n) ? s : n;
    });
}

// ---------- UI Switch ----------
function showModuleInputs(){
  document.getElementById('pagingInputs').style.display = (state.module==='paging')?'block':'none';
  document.getElementById('segInputs').style.display    = (state.module==='segmentation')?'block':'none';
  document.getElementById('virtInputs').style.display   = (state.module==='virtual')?'block':'none';

  if(state.module === 'paging'){
    $visualTitle.textContent = 'Frames (physical memory)';
  }
  if(state.module === 'segmentation'){
    $visualTitle.textContent = 'Segments / Memory Map';
  }
  if(state.module === 'virtual'){
    $visualTitle.textContent = 'Physical Frames (for pages)';
  }
}

// ---------- RESET / LOAD ----------
function resetCommon(){
  state.faults = 0;
  state.hits = 0;
  state.processed = 0;
  state.index = 0;
  state.fifoPointer = 0;

  if(state.timer){
    clearInterval(state.timer);
    state.timer = null;
    state.running = false;
  }

  chartData = [];
  chartPoints = [];
  updateChart();

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
    const raw = $segmentsInput.value || '';
    const parts = raw.split(',').map(s=>s.trim()).filter(s=>s.length);
    state.segments = {};
    for(const p of parts){
      const [name,b,l] = p.split(':').map(x=>x.trim());
      const base = Number(b);
      const limit = Number(l);
      if(!name || Number.isNaN(base) || Number.isNaN(limit)) continue;
      state.segments[name] = { base, limit };
    }
    appendLog(`Segments loaded: ${Object.keys(state.segments).join(', ')}`);
    renderSegmentsTable();
  }

  if(state.module === 'virtual'){
    state.pageSize = Number($pageSizeInput.value) || 100;
    state.physCapacity = Number($framesInput.value) || 3;
    state.physFrames = Array(state.physCapacity).fill(null);
    state.pageTable = {};
    state.lruTime = Array(state.physCapacity).fill(0);
    state.refs = parseRefs($virtRef.value);
    renderTimeline();
    appendLog(`Virtual memory loaded. pageSize=${state.pageSize}, physFrames=${state.physCapacity}, refs=${state.refs.length}`);
  }

  chartData = [];
  chartPoints = [];
  updateChart();

  renderAll();
}

// ---------- RENDER HELPERS ----------
function renderFrames(highlightIndex=-1, isFault=false){
  $framesArea.innerHTML = '';

  if(state.module === 'segmentation'){
    for(const [name,seg] of Object.entries(state.segments)){
      const d = document.createElement('div');
      d.className = 'frame';
      d.style.width = '170px';
      d.textContent = `${name}: ${seg.base}-${seg.limit}`;
      $framesArea.appendChild(d);
    }
    return;
  }

  const arr = (state.module === 'paging') ? state.frames : state.physFrames;

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

function renderPageTableVirtual(){
  let txt = 'Page Table (page → frame or -1):\n';
  for(const [p,f] of Object.entries(state.pageTable)){
    txt += `page ${p} → frame ${f}\n`;
  }
  $tableArea.textContent = txt;
}

function renderFrameTablePaging(){
  let txt = 'Frame Table:\n';
  for(let i=0;i<state.frames.length;i++){
    txt += `Frame ${i}: ${state.frames[i] === null ? '-' : state.frames[i]}\n`;
  }
  $tableArea.textContent = txt;
}

function renderStats(){
  $processed.textContent = state.processed;
  $faults.textContent = state.faults;

  const hitRate = (state.hits / Math.max(1, state.processed)) * 100;
  $hits.textContent = hitRate.toFixed(1) + '%';

  $frameCount.textContent = (state.module==='segmentation')
    ? Object.keys(state.segments).length
    : (state.module==='paging' ? state.capacity : state.physCapacity);

  $totalRefs.textContent = state.refs.length || 0;
  $totalFaults.textContent = state.faults;
  $totalHits.textContent = state.hits;
  $faultRate.textContent = ((state.faults/Math.max(1,state.processed))*100).toFixed(1) + '%';
}

function renderAll(){
  renderFrames();
  renderTimeline();
  if(state.module === 'segmentation') renderSegmentsTable();
  if(state.module === 'virtual')      renderPageTableVirtual();
  if(state.module === 'paging')       renderFrameTablePaging();
  renderStats();
  updateChart();
}

// ---------- GRAPH RENDER (Hits vs Faults Timeline) ----------
function updateChart(){
  const canvas = document.getElementById('accessChart');
  if(!canvas) return;

  if(!chartCtx){
    chartCtx = canvas.getContext('2d');
  }

  const width  = canvas.clientWidth || 600;
  const height = canvas.height;

  canvas.width = width;

  chartCtx.clearRect(0, 0, width, height);

  const leftMargin   = 40;
  const rightMargin  = 10;
  const topMargin    = 26;
  const bottomMargin = 30;

  chartCtx.strokeStyle = "#4cc2ff55";
  chartCtx.lineWidth = 1;

  const xAxisY = height - bottomMargin;

  // X-axis
  chartCtx.beginPath();
  chartCtx.moveTo(leftMargin, xAxisY);
  chartCtx.lineTo(width - rightMargin, xAxisY);
  chartCtx.stroke();

  // Y-axis
  chartCtx.beginPath();
  chartCtx.moveTo(leftMargin, topMargin);
  chartCtx.lineTo(leftMargin, xAxisY);
  chartCtx.stroke();

  // Y labels
  chartCtx.fillStyle = "#9ca7b3";
  chartCtx.font = "12px system-ui, sans-serif";
  chartCtx.fillText("1 (Hit)", 4, topMargin + 4);
  chartCtx.fillText("0 (Fault)", 4, xAxisY - 2);

  chartPoints = [];

  if(chartData.length === 0) return;

  const usableWidth = width - leftMargin - rightMargin;
  const n = chartData.length;
  const gap = (n > 1) ? (usableWidth / (n - 1)) : 0;

  // Line
  chartCtx.beginPath();
  chartCtx.lineWidth = 2;
  chartCtx.strokeStyle = "#65a8ff";

  for(let i=0;i<n;i++){
    const x = leftMargin + gap * i;
    const y = chartData[i] === 1 ? topMargin : xAxisY;
    if(i === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  }
  chartCtx.stroke();

  // Points
  for(let i=0;i<n;i++){
    const x = leftMargin + gap * i;
    const y = chartData[i] === 1 ? topMargin : xAxisY;
    chartCtx.fillStyle = chartData[i] === 1 ? "#00ff55" : "#ff4444";
    chartCtx.beginPath();
    chartCtx.arc(x, y, 5, 0, Math.PI * 2);
    chartCtx.fill();

    chartPoints.push({
      x,
      y,
      value: chartData[i],
      index: i
    });
  }

  // X labels (access numbers)
  chartCtx.fillStyle = "#9ca7b3";
  chartCtx.font = "10px system-ui, sans-serif";
  for(let i=0;i<n;i++){
    const x = leftMargin + gap * i;
    const label = String(i+1);
    chartCtx.fillText(label, x - 3, xAxisY + 12);
  }
}

// ---------- TOOLTIP HANDLERS ----------
function handleChartHover(evt){
  if(!chartPoints.length || !$tooltip) return;
  const rect = evt.target.getBoundingClientRect();
  const mx = evt.clientX - rect.left;
  const my = evt.clientY - rect.top;

  let nearest = null;
  let minDist = Infinity;
  for(const p of chartPoints){
    const dx = mx - p.x;
    const dy = my - p.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if(d < minDist){
      minDist = d;
      nearest = p;
    }
  }

  if(!nearest || minDist > 12){
    hideTooltip();
    return;
  }

  const text = `Access ${nearest.index+1}: ${nearest.value === 1 ? 'Hit (1)' : 'Fault (0)'}`;
  $tooltip.textContent = text;
  $tooltip.style.display = 'block';
  $tooltip.style.left = (evt.clientX + 12) + 'px';
  $tooltip.style.top = (evt.clientY + 12) + 'px';
}

function hideTooltip(){
  if($tooltip){
    $tooltip.style.display = 'none';
  }
}

// ---------- STEP LOGIC ----------
function stepOnce(){
  if(state.module === 'paging')       return stepPaging();
  if(state.module === 'segmentation') return stepSegmentation();
  if(state.module === 'virtual')      return stepVirtual();
}

/* ---------- Paging: FIFO & LRU ---------- */
function stepPaging(){
  if(state.index >= state.refs.length){
    appendLog('All references processed.');
    stopAuto();
    return;
  }

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

    chartData.push(1); // Hit
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
        let min = Infinity;
        for(let i=0;i<state.capacity;i++){
          if(state.lruTime[i] < min){
            min = state.lruTime[i];
            replaceIndex = i;
          }
        }
      }
      appendLog(`Replacing frame ${replaceIndex} (was ${state.frames[replaceIndex]})`);
      state.frames[replaceIndex] = ref;
      if(state.algo === 'LRU') state.lruTime[replaceIndex] = state.processed;
      renderFrames(replaceIndex,true);
      markTimeline(state.index,true);
    }

    chartData.push(0); // Fault
  }

  state.index++;

  renderFrameTablePaging();
  renderStats();
  renderTimeline();
  updateChart();

  if(state.index >= state.refs.length){
    appendLog('Finished paging sequence');
    stopAuto();
  }
}

/* ---------- Segmentation ---------- */
function stepSegmentation(){
  const raw = $segAddr.value.trim();
  if(!raw){
    appendLog('No segmentation address provided');
    return;
  }

  const [segName, offStr] = raw.split(':').map(s=>s.trim());
  const offset = Number(offStr);
  appendLog(`Segmentation access: ${segName}:${offset}`);

  if(!(segName in state.segments)){
    appendLog('Segment not found → segment fault');
    state.faults++;
    renderStats();
    return;
  }

  const seg = state.segments[segName];
  if(offset < 0 || offset > seg.limit){
    appendLog(`Offset ${offset} out of range → segment fault`);
    state.faults++;
    renderStats();
    return;
  }

  const phys = seg.base + offset;
  appendLog(`Translated logical ${segName}:${offset} → physical address ${phys}`);
  state.processed++;
  state.hits++;

  renderFrames();
  renderSegmentsTable();
  renderStats();
  // Graph not updated for segmentation (per option A)
}

/* ---------- Virtual Memory ---------- */
function stepVirtual(){
  if(state.index >= state.refs.length){
    appendLog('All virtual refs processed');
    stopAuto();
    return;
  }

  const ref = Number(state.refs[state.index]);
  state.processed++;
  appendLog(`Virtual access ${state.index}: logical address ${ref}`);

  const pageNum = Math.floor(ref / state.pageSize);
  const offset  = ref % state.pageSize;
  appendLog(`page=${pageNum}, offset=${offset}`);

  if(state.pageTable.hasOwnProperty(pageNum) && state.pageTable[pageNum] !== -1){
    // hit
    const frameNum = state.pageTable[pageNum];
    state.hits++;
    appendLog(`Page hit: page ${pageNum} in frame ${frameNum}`);

    state.lruTime[frameNum] = state.processed;

    renderFrames(frameNum,false);
    markTimeline(state.index,false);

    chartData.push(1); // Hit
  } else {
    // fault
    state.faults++;
    appendLog(`Page fault for page ${pageNum}`);

    if(state.physFrames.includes(null)){
      const free = state.physFrames.indexOf(null);
      state.physFrames[free] = pageNum;
      state.pageTable[pageNum] = free;
      appendLog(`Loaded page ${pageNum} into free frame ${free}`);
      state.lruTime[free] = state.processed;
      renderFrames(free,true);
      markTimeline(state.index,true);
    } else {
      let replaceIndex = 0;
      if(state.algo === 'FIFO'){
        replaceIndex = state.fifoPointer % state.physCapacity;
        state.fifoPointer = (state.fifoPointer+1) % state.physCapacity;
      } else {
        let min = Infinity;
        for(let i=0;i<state.physCapacity;i++){
          if(state.lruTime[i] < min){
            min = state.lruTime[i];
            replaceIndex = i;
          }
        }
      }
      const oldPage = state.physFrames[replaceIndex];
      if(oldPage !== null && state.pageTable.hasOwnProperty(oldPage)){
        state.pageTable[oldPage] = -1;
      }
      state.physFrames[replaceIndex] = pageNum;
      state.pageTable[pageNum] = replaceIndex;
      state.lruTime[replaceIndex] = state.processed;
      appendLog(`Replaced frame ${replaceIndex}: evicted page ${oldPage} -> loaded page ${pageNum}`);
      renderFrames(replaceIndex,true);
      markTimeline(state.index,true);
    }

    renderPageTableVirtual();

    chartData.push(0); // Fault
  }

  state.index++;
  renderStats();
  renderTimeline();
  updateChart();

  if(state.index >= state.refs.length){
    appendLog('Virtual ref sequence finished');
    stopAuto();
  }
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
    if(state.index >= state.refs.length && state.module !== 'segmentation') stopAuto();
  }, ms);
  appendLog(`Autoplay started (ms=${ms})`);
}

function stopAuto(){
  if(state.timer){
    clearInterval(state.timer);
    state.timer = null;
    state.running = false;
    appendLog('Autoplay stopped');
  }
}

// ---------- EXPORT HANDLERS ----------
if($downloadGraph){
  $downloadGraph.addEventListener('click', ()=>{
    const canvas = document.getElementById('accessChart');
    if(!canvas){
      alert('Graph not available yet.');
      return;
    }
    const dataURL = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'memory-access-timeline.png';
    a.click();
  });
}

if($downloadLog){
  $downloadLog.addEventListener('click', ()=>{
    const text = $log.textContent || 'No log available.';
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memory-visualizer-log.txt';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------- Bindings ----------
document.getElementById('load').addEventListener('click', load);
document.getElementById('reset').addEventListener('click', ()=>{
  resetCommon();
  renderAll();
});
document.getElementById('step').addEventListener('click', ()=>{
  stepOnce();
});
document.getElementById('run').addEventListener('click', ()=>{
  if(!state.running) runAuto();
  else stopAuto();
});

$module.addEventListener('change', ()=>{
  state.module = $module.value;
  showModuleInputs();
  renderAll();
});

// Chart hover events
const accessCanvas = document.getElementById('accessChart');
if(accessCanvas){
  accessCanvas.addEventListener('mousemove', handleChartHover);
  accessCanvas.addEventListener('mouseleave', hideTooltip);
}

// ---------- Initialize ----------
showModuleInputs();
load();
