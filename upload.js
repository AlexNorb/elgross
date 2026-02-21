// upload.js — Drag & drop file handling, auto-detection, and progress UI

import { SUPPLIERS, detectSupplier } from './suppliers.js';
import { loadGNP, parseAgreement, computeNetPrices, compareSuppliers } from './engine.js';
import { renderDashboard, showScreen } from './dashboard.js';

// State
const uploadedFiles = {}; // supplierId → { name, content }
let isProcessing = false;

/**
 * Initialize the upload screen.
 */
function initUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const analyzeBtn = document.getElementById('analyze-btn');

    // Drag & drop events
    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        handleFiles(files);
    });

    // Browse button
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        handleFiles(e.target.files);
        fileInput.value = ''; // reset so same file can be re-selected
    });

    // Analyze button
    analyzeBtn.addEventListener('click', startAnalysis);

    updateSupplierChips();
    updateAnalyzeButton();
}

/**
 * Process dropped/selected files — auto-detect supplier for each.
 */
async function handleFiles(fileList) {
    for (const file of fileList) {
        const content = await readFileContent(file);
        const supplierId = detectSupplier(content);

        if (!supplierId) {
            showUploadError(`Kunde inte identifiera leverantör för "${file.name}". Kontrollera att filen är ett rabattavtal.`);
            continue;
        }

        if (Object.keys(uploadedFiles).length >= 2 && !uploadedFiles[supplierId]) {
            showUploadError(`Du har redan 2 filer uppladdade. Ta bort en innan du lägger till en ny.`);
            continue;
        }

        uploadedFiles[supplierId] = { name: file.name, content };
        showUploadSuccess(supplierId, file.name);
    }

    updateSupplierChips();
    updateAnalyzeButton();
}

/**
 * Read file content as text (ISO-8859-1 for Swedish encoding).
 */
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Try to decode as ISO-8859-1 (common for Swedish files)
            const buffer = reader.result;
            const text = new TextDecoder('iso-8859-1').decode(buffer);
            resolve(text);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Update the supplier chips showing upload status.
 */
function updateSupplierChips() {
    const container = document.getElementById('supplier-chips');
    container.innerHTML = '';

    for (const [id, supplier] of Object.entries(SUPPLIERS)) {
        const chip = document.createElement('div');
        chip.className = 'supplier-chip' + (uploadedFiles[id] ? ' uploaded' : '');
        chip.style.setProperty('--supplier-color', supplier.color);
        chip.style.setProperty('--supplier-light', supplier.colorLight);

        const icon = document.createElement('span');
        icon.className = 'chip-icon';
        icon.textContent = supplier.icon;

        const info = document.createElement('div');
        info.className = 'chip-info';

        const name = document.createElement('span');
        name.className = 'chip-name';
        name.textContent = supplier.name;

        const status = document.createElement('span');
        status.className = 'chip-status';

        if (uploadedFiles[id]) {
            status.textContent = uploadedFiles[id].name;
            // Add remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'chip-remove';
            removeBtn.innerHTML = '✕';
            removeBtn.title = 'Ta bort';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                delete uploadedFiles[id];
                updateSupplierChips();
                updateAnalyzeButton();
            });
            chip.appendChild(removeBtn);
        } else {
            status.textContent = 'Inte uppladdad';
        }

        info.appendChild(name);
        info.appendChild(status);
        chip.appendChild(icon);
        chip.appendChild(info);
        container.appendChild(chip);
    }
}

/**
 * Update analyze button state — enabled when ≥2 suppliers uploaded.
 */
function updateAnalyzeButton() {
    const btn = document.getElementById('analyze-btn');
    const count = Object.keys(uploadedFiles).length;
    btn.disabled = count !== 2 || isProcessing;

    if (count < 2) {
        btn.textContent = `Väntar på 2 avtal (${count}/2)`;
    } else if (count === 2) {
        btn.textContent = 'Analysera priser';
    } else {
        btn.textContent = 'För många tillagda (ta bort så du har exakt 2)';
    }
}

function showUploadError(msg) {
    const el = document.getElementById('upload-feedback');
    el.textContent = msg;
    el.className = 'upload-feedback error';
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 5000);
}

function showUploadSuccess(supplierId, filename) {
    const el = document.getElementById('upload-feedback');
    el.textContent = `✓ ${SUPPLIERS[supplierId].name}-avtal identifierat: ${filename}`;
    el.className = 'upload-feedback success';
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

/**
 * Start the full analysis pipeline.
 */
async function startAnalysis() {
    if (isProcessing) return;
    isProcessing = true;
    updateAnalyzeButton();

    showScreen('processing');

    try {
        const supplierIds = Object.keys(uploadedFiles);
        const totalSteps = supplierIds.length * 2 + 1; // load GNP + parse agreement per supplier + compare
        let currentStep = 0;

        const supplierData = {};

        for (const id of supplierIds) {
            // Step: Load GNP
            currentStep++;
            updateProgress(currentStep, totalSteps, `Laddar ${SUPPLIERS[id].name} prislista...`);
            await tick();
            const gnpArticles = await loadGNP(id);

            // Step: Parse agreement
            currentStep++;
            updateProgress(currentStep, totalSteps, `Bearbetar ${SUPPLIERS[id].name} avtal...`);
            await tick();
            const discounts = parseAgreement(id, uploadedFiles[id].content);
            supplierData[id] = computeNetPrices(gnpArticles, discounts);
        }

        // Step: Compare
        currentStep++;
        updateProgress(currentStep, totalSteps, 'Jämför priser...');
        await tick();
        const results = compareSuppliers(supplierData);

        // Small delay to show final progress
        updateProgress(totalSteps, totalSteps, 'Förbereder rapport...');
        await new Promise(r => setTimeout(r, 600));

        // Switch to results
        showScreen('results');
        renderDashboard(results);

    } catch (err) {
        console.error(err);
        showScreen('upload');
        showUploadError('Analys misslyckades: ' + err.message);
    } finally {
        isProcessing = false;
        updateAnalyzeButton();
    }
}

function updateProgress(current, total, label) {
    const pct = Math.round((current / total) * 100);
    const bar = document.getElementById('progress-bar-fill');
    const text = document.getElementById('progress-text');
    const step = document.getElementById('progress-step');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = `${pct}%`;
    if (step) step.textContent = label;
}

function tick() {
    return new Promise(r => setTimeout(r, 30));
}

export { initUpload };
