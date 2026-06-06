'use strict';

const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── State ───────────────────────────────────────────────────────────────────
let fileQueue = [];       // [{ filePath, name, status: 'pending'|'processing'|'done'|'error' }]
let outputDir = null;
let isRunning = false;
let selectedIndex = -1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('fileInput');
const btnUpload      = document.getElementById('btnUpload');
const btnClear       = document.getElementById('btnClear');
const btnDir         = document.getElementById('btnDir');
const btnExecute     = document.getElementById('btnExecute');
const fileList       = document.getElementById('fileList');
const fileCount      = document.getElementById('fileCount');
const progressFill   = document.getElementById('progressFill');
const statusMsg      = document.getElementById('statusMsg');
const statusCount    = document.getElementById('statusCount');
const outputDirLabel = document.getElementById('outputDirLabel');
const previewCanvas  = document.getElementById('previewCanvas');
const canvasEmpty    = document.getElementById('canvasEmpty');

// Options
const optThreshold   = document.getElementById('optThreshold');
const valThreshold   = document.getElementById('valThreshold');
const optTurd        = document.getElementById('optTurd');
const valTurd        = document.getElementById('valTurd');
const optTolerance   = document.getElementById('optTolerance');
const valTolerance   = document.getElementById('valTolerance');
const optColor       = document.getElementById('optColor');

// ─── Options sliders ──────────────────────────────────────────────────────────
optThreshold.addEventListener('input', () => { valThreshold.textContent = optThreshold.value; });
optTurd.addEventListener('input', () => { valTurd.textContent = optTurd.value; });
optTolerance.addEventListener('input', () => {
  valTolerance.textContent = (parseInt(optTolerance.value) / 10).toFixed(1);
});

// ─── Drag & Drop ──────────────────────────────────────────────────────────────
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('active'); });
dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('active'); });
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('active');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  addFiles(files.map(f => f.path));
});

btnUpload.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files).map(f => f.path));
  fileInput.value = '';
});

// ─── Clear ────────────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  if (isRunning) return;
  fileQueue = [];
  selectedIndex = -1;
  renderFileList();
  clearPreview();
  updateExecuteBtn();
  setStatus('Queue cleared.', '—');
  progressFill.style.width = '0%';
});

// ─── Output directory ─────────────────────────────────────────────────────────
btnDir.addEventListener('click', async () => {
  const dir = await ipcRenderer.invoke('choose-output-dir');
  if (dir) {
    outputDir = dir;
    outputDirLabel.textContent = dir;
    updateExecuteBtn();
  }
});

// ─── Execute ──────────────────────────────────────────────────────────────────
btnExecute.addEventListener('click', async () => {
  if (isRunning || fileQueue.length === 0 || !outputDir) return;

  isRunning = true;
  btnExecute.disabled = true;
  btnExecute.classList.add('running');
  btnExecute.textContent = '⟳ Memproses...';

  const filePaths = fileQueue.map(f => f.filePath);

  const options = {
    threshold:    parseInt(optThreshold.value),
    turdSize:     parseInt(optTurd.value),
    optTolerance: parseInt(optTolerance.value) / 10,
    optCurve:     true,
    alphaMax:     1,
    color:        optColor.value,
  };

  try {
    await ipcRenderer.invoke('batch-convert', { filePaths, outputDir, options });
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'FAILED');
  }

  isRunning = false;
  btnExecute.classList.remove('running');
  btnExecute.textContent = '▶ Mulai Batch Trace';
  updateExecuteBtn();

  const doneCount = fileQueue.filter(f => f.status === 'done').length;
  const errCount  = fileQueue.filter(f => f.status === 'error').length;
  setStatus(
    `Selesai. ${doneCount} berhasil, ${errCount} gagal.`,
    `${doneCount}/${fileQueue.length} OK`
  );
  progressFill.style.width = '100%';
});

// ─── IPC: progress ────────────────────────────────────────────────────────────
ipcRenderer.on('progress', (_, { current, total, file, status }) => {
  const pct = (current / total) * 100;
  progressFill.style.width = `${pct}%`;

  // Update state
  const idx = fileQueue.findIndex(f => path.basename(f.filePath) === file);
  if (idx !== -1) {
    fileQueue[idx].status = status === 'processing' ? 'processing'
      : status === 'done' ? 'done' : 'error';
  }
  renderFileList();

  setStatus(
    status === 'processing'
      ? `Memproses ${current} dari ${total}: ${file}`
      : `${status === 'done' ? '✓' : '✗'} ${file}`,
    `${current} / ${total}`
  );
});

// ─── File list helpers ────────────────────────────────────────────────────────
function addFiles(paths) {
  const existing = new Set(fileQueue.map(f => f.filePath));
  const newItems = paths
    .filter(p => !existing.has(p))
    .map(p => ({ filePath: p, name: path.basename(p), status: 'pending' }));
  fileQueue.push(...newItems);
  renderFileList();
  updateExecuteBtn();
  setStatus(`${fileQueue.length} file dalam antrian.`, `${fileQueue.length} files`);

  // Auto-select first file if none selected
  if (selectedIndex === -1 && fileQueue.length > 0) {
    selectFile(0);
  }
}

function renderFileList() {
  fileList.innerHTML = '';
  fileCount.textContent = `${fileQueue.length} File${fileQueue.length !== 1 ? 's' : ''} Loaded`;

  fileQueue.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = `file-item ${item.status} ${i === selectedIndex ? 'selected' : ''}`;
    li.innerHTML = `
      <div class="fi-dot"></div>
      <span class="fi-name" title="${item.filePath}">${item.name}</span>
      <span class="fi-status">${statusLabel(item.status)}</span>
    `;
    li.addEventListener('click', () => selectFile(i));
    fileList.appendChild(li);
  });
}

function statusLabel(s) {
  return { pending: 'PENDING', processing: 'PROC...', done: 'DONE', error: 'ERROR' }[s] || '';
}

function selectFile(i) {
  selectedIndex = i;
  renderFileList();
  loadPreview(fileQueue[i].filePath);
}

// ─── Canvas Preview ───────────────────────────────────────────────────────────
function loadPreview(filePath) {
  const img = new Image();
  img.onload = () => {
    canvasEmpty.style.display = 'none';
    previewCanvas.style.display = 'block';

    const MAX = 280;
    const scale = Math.min(MAX / img.width, MAX / img.height, 1);
    previewCanvas.width  = img.width  * scale;
    previewCanvas.height = img.height * scale;

    const ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
  };
  img.onerror = clearPreview;
  img.src = `file://${filePath}`;
}

function clearPreview() {
  canvasEmpty.style.display = 'block';
  previewCanvas.style.display = 'none';
  const ctx = previewCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateExecuteBtn() {
  const ready = fileQueue.length > 0 && outputDir && !isRunning;
  btnExecute.disabled = !ready;
}

function setStatus(msg, count) {
  statusMsg.textContent = msg;
  if (count !== undefined) statusCount.textContent = count;
}
