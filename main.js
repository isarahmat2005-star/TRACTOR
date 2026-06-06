'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const potrace = require('potrace');
const { createCanvas, loadImage } = require('canvas');
const { autoUpdater } = require('electron-updater');

// ─── ATURAN MUTLAK: fungsi random berbasis crypto ───────────────────────────
function R() {
  return require('crypto').randomBytes(4).readUInt32LE(0) / 0x100000000;
}

function randomSuffix(digits = 4) {
  return String(Math.floor(R() * Math.pow(10, digits))).padStart(digits, '0');
}

// ─── Window ─────────────────────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#0d0d0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── IPC: Pilih folder output ─────────────────────────────────────────────
ipcMain.handle('choose-output-dir', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Pilih Folder Output',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── IPC: Batch Convert ───────────────────────────────────────────────────
ipcMain.handle('batch-convert', async (event, { filePaths, outputDir, options }) => {
  const results = [];
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    const filePath = filePaths[i];
    const baseName = path.basename(filePath, path.extname(filePath));
    const suffix = randomSuffix(4);
    const outName = `TracTor_${suffix}`;

    event.sender.send('progress', {
      current: i + 1,
      total,
      file: path.basename(filePath),
      status: 'processing',
    });

    try {
      const result = await convertSingle(filePath, outputDir, outName, options);
      results.push({ source: filePath, ...result, error: null });
    } catch (err) {
      results.push({ source: filePath, error: err.message });
    }

    event.sender.send('progress', {
      current: i + 1,
      total,
      file: path.basename(filePath),
      status: results[i].error ? 'error' : 'done',
    });
  }

  return results;
});

// ─── Core: convert satu gambar ───────────────────────────────────────────
async function convertSingle(filePath, outputDir, outName, options = {}) {
  const {
    threshold = 128,
    turdSize = 2,
    alphaMax = 1,
    optCurve = true,
    optTolerance = 0.2,
    color = '#000000',
  } = options;

  // Baca gambar via canvas
  const img = await loadImage(filePath);
  const cvs = createCanvas(img.width, img.height);
  const ctx = cvs.getContext('2d');

  // Untuk PNG transparan: komposit di atas putih untuk potrace, tapi simpan aslinya
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);

  const pngBuffer = cvs.toBuffer('image/png');

  // ── 1. Trace via potrace ────────────────────────────────────────────────
  const svgData = await new Promise((resolve, reject) => {
    potrace.trace(pngBuffer, {
      threshold,
      turdSize,
      alphaMax,
      optCurve,
      optTolerance,
      color,
      background: 'transparent',
    }, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });

  // ── 2. Simpan SVG ───────────────────────────────────────────────────────
  const svgPath = path.join(outputDir, `${outName}.svg`);
  fs.writeFileSync(svgPath, svgData, 'utf8');

  // ── 3. Simpan PNG transparan ────────────────────────────────────────────
  const pngTransCvs = createCanvas(img.width, img.height);
  const pngTransCtx = pngTransCvs.getContext('2d');
  pngTransCtx.clearRect(0, 0, img.width, img.height);
  pngTransCtx.drawImage(img, 0, 0);
  const pngTransBuffer = pngTransCvs.toBuffer('image/png');
  const pngPath = path.join(outputDir, `${outName}.png`);
  fs.writeFileSync(pngPath, pngTransBuffer);

  // ── 4. Generate EPS dari koordinat potrace ──────────────────────────────
  const epsData = await generateEPS(pngBuffer, img.width, img.height, { threshold, turdSize, alphaMax, optCurve, optTolerance, color, outName });
  const epsPath = path.join(outputDir, `${outName}.eps`);
  fs.writeFileSync(epsPath, epsData, 'utf8');

  return { svgPath, pngPath, epsPath, outName };
}

// ─── EPS Generator dari SVG path data ───────────────────────────────────
async function generateEPS(imgBuffer, width, height, opts) {
  const { color = '#000000', outName = 'TracTor' } = opts;

  // Ambil SVG lagi dengan potrace untuk dapat path data mentah
  const svgRaw = await new Promise((resolve, reject) => {
    potrace.trace(imgBuffer, {
      threshold: opts.threshold,
      turdSize: opts.turdSize,
      alphaMax: opts.alphaMax,
      optCurve: opts.optCurve,
      optTolerance: opts.optTolerance,
      color: opts.color,
      background: 'transparent',
    }, (err, svg) => {
      if (err) reject(err); else resolve(svg);
    });
  });

  // Ekstrak path `d="..."` dari SVG
  const pathMatches = [...svgRaw.matchAll(/\bd="([^"]+)"/g)].map(m => m[1]);

  // Parse hex color ke RGB 0–1
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;

  const now = new Date().toISOString();

  let eps = `%!PS-Adobe-3.0 EPSF-3.0\n`;
  eps += `%%BoundingBox: 0 0 ${width} ${height}\n`;
  eps += `%%HiResBoundingBox: 0 0 ${width} ${height}\n`;
  eps += `%%Title: (${outName})\n`;
  eps += `%%Creator: (TracTor by IRS)\n`;
  eps += `%%CreationDate: (${now})\n`;
  eps += `%%LanguageLevel: 2\n`;
  eps += `%%EndComments\n`;
  eps += `%%BeginProlog\n`;
  eps += `/M { moveto } def\n`;
  eps += `/L { lineto } def\n`;
  eps += `/C { curveto } def\n`;
  eps += `/Z { closepath } def\n`;
  eps += `/F { fill } def\n`;
  eps += `%%EndProlog\n`;
  eps += `%%BeginSetup\n`;
  eps += `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} setrgbcolor\n`;
  eps += `%%EndSetup\n`;
  eps += `%%Page: 1 1\n`;
  eps += `gsave\n`;
  eps += `1 -1 scale\n`;                  // flip Y karena SVG Y ke bawah, PS Y ke atas
  eps += `0 ${-height} translate\n`;

  // Konversi setiap SVG path d ke PostScript
  for (const d of pathMatches) {
    eps += svgPathToPS(d);
    eps += `F\n`;
  }

  eps += `grestore\n`;
  eps += `%%EOF\n`;
  return eps;
}

// ─── SVG path d → PostScript commands ───────────────────────────────────
function svgPathToPS(d) {
  // Tokenize: pisahkan huruf dan angka
  const tokens = d.match(/[MmLlCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/g) || [];
  let ps = '';
  let i = 0;
  let cx = 0, cy = 0;

  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': { const x = num(), y = num(); cx = x; cy = y; ps += `${x} ${y} M\n`; break; }
      case 'm': { const dx = num(), dy = num(); cx += dx; cy += dy; ps += `${cx} ${cy} M\n`; break; }
      case 'L': { const x = num(), y = num(); cx = x; cy = y; ps += `${x} ${y} L\n`; break; }
      case 'l': { const dx = num(), dy = num(); cx += dx; cy += dy; ps += `${cx} ${cy} L\n`; break; }
      case 'H': { const x = num(); cx = x; ps += `${x} ${cy} L\n`; break; }
      case 'h': { const dx = num(); cx += dx; ps += `${cx} ${cy} L\n`; break; }
      case 'V': { const y = num(); cy = y; ps += `${cx} ${y} L\n`; break; }
      case 'v': { const dy = num(); cy += dy; ps += `${cx} ${cy} L\n`; break; }
      case 'C': {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        cx = x; cy = y;
        ps += `${x1} ${y1} ${x2} ${y2} ${x} ${y} C\n`; break;
      }
      case 'c': {
        const dx1 = num(), dy1 = num(), dx2 = num(), dy2 = num(), dx = num(), dy = num();
        ps += `${cx+dx1} ${cy+dy1} ${cx+dx2} ${cy+dy2} ${cx+dx} ${cy+dy} C\n`;
        cx += dx; cy += dy; break;
      }
      case 'Z':
      case 'z': { ps += `Z\n`; break; }
      default: break;
    }
  }
  return ps;
}
