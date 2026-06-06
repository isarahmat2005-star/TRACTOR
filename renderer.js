const { ipcRenderer } = require('electron');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const btnProcess = document.getElementById('btnProcess');
const status = document.getElementById('status');
const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');

let selectedFiles = [];

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files).map(f => f.path);
    status.innerText = `${selectedFiles.length} file siap diproses.`;
    if(selectedFiles.length > 0) showPreview(selectedFiles[0]);
});

function showPreview(filepath) {
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.src = filepath;
}

btnProcess.addEventListener('click', async () => {
    if(selectedFiles.length === 0) return alert('Pilih gambar dulu!');
    
    btnProcess.disabled = true;
    for (let i = 0; i < selectedFiles.length; i++) {
        status.innerText = `Memproses [${i + 1}/${selectedFiles.length}] ...`;
        try {
            await ipcRenderer.invoke('process-image', selectedFiles[i]);
        } catch (err) {
            console.error('Error trace:', err);
        }
    }
    status.innerText = 'Selesai eksekusi batch!';
    btnProcess.disabled = false;
});
