const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const potrace = require('potrace');
const { createCanvas, Image } = require('canvas');

// FUNGSI WAJIB PENGGANTI Math.random()
function R() {
    return require('crypto').randomBytes(4).readUInt32LE(0) / 0x100000000;
}

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: "TracTor by IRS",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
});

ipcMain.handle('process-image', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        
        const suffix = Math.floor(R() * 10000);
        const epsPath = path.join(dir, `${baseName}_${suffix}.eps`);
        const pngPath = path.join(dir, `${baseName}_${suffix}.png`);
        
        // Buat parameter potrace
        const traceParams = { color: '#000000' };
        
        potrace.trace(filePath, traceParams, (err, svg) => {
            if (err) return reject(err);
            
            // Render Vektor ke PNG Transparan
            const img = new Image();
            img.onload = () => {
                const canvas = createCanvas(img.width, img.height);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const buffer = canvas.toBuffer('image/png');
                fs.writeFileSync(pngPath, buffer);
                
                resolve({ eps: epsPath, png: pngPath });
            };
            img.onerror = reject;
            img.src = Buffer.from(svg);
        });
    });
});
