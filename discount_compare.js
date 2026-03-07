import { SUPPLIERS } from './suppliers.js';

let dcResults = null;
let currentSupplierId = null;

let newDiscounts = null; // Map: grp -> discount%
let currentChanges = []; // Store current dataset for filtering

export function initDiscountCompare(results) {
    dcResults = results;

    // Populate supplier selection
    const select = document.getElementById('dc-supplier-select');
    select.innerHTML = '';

    if (results.supplierIds.length === 0) {
        select.innerHTML = '<option value="">Inga leverantörer inlästa</option>';
        return;
    }

    results.supplierIds.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = SUPPLIERS[id]?.name || id;
        select.appendChild(opt);
    });

    currentSupplierId = select.value;

    select.addEventListener('change', (e) => {
        currentSupplierId = e.target.value;
        resetState();
    });

    // Setup file upload / drag-drop
    setupUploadHandlers();
}

function resetState() {
    newDiscounts = null;
    currentChanges = [];
    document.getElementById('dc-kpi-cards').style.display = 'none';
    document.getElementById('dc-controls').style.display = 'none';
    document.getElementById('dc-main').style.display = 'none';
    document.getElementById('dc-upload-feedback').innerHTML = '&nbsp;';
    document.getElementById('dc-upload-feedback').className = 'upload-feedback';

    const filterSelect = document.getElementById('dc-filter-select');
    if (filterSelect) filterSelect.value = 'all';
}

function setupUploadHandlers() {
    const dropZone = document.getElementById('dc-dropzone');
    const fileInput = document.getElementById('dc-file-input');
    const browseBtn = document.getElementById('dc-browse-btn');
    const filterSelect = document.getElementById('dc-filter-select');
    const copyBtn = document.getElementById('dc-copy-btn');

    // Remove old listeners to avoid duplicates if init is called multiple times
    const newDropZone = dropZone.cloneNode(true);
    dropZone.parentNode.replaceChild(newDropZone, dropZone);
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);
    const newBrowseBtn = browseBtn.cloneNode(true);
    browseBtn.parentNode.replaceChild(newBrowseBtn, browseBtn);
    const newFilterSelect = filterSelect.cloneNode(true);
    filterSelect.parentNode.replaceChild(newFilterSelect, filterSelect);
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

    ['dragenter', 'dragover'].forEach(evt => {
        newDropZone.addEventListener(evt, e => {
            e.preventDefault(); e.stopPropagation();
            newDropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        newDropZone.addEventListener(evt, e => {
            e.preventDefault(); e.stopPropagation();
            newDropZone.classList.remove('drag-over');
        });
    });

    newDropZone.addEventListener('drop', e => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    newBrowseBtn.addEventListener('click', () => newFileInput.click());
    newFileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
        newFileInput.value = '';
    });

    newFilterSelect.addEventListener('change', () => {
        renderTable(currentChanges);
    });

    newCopyBtn.addEventListener('click', () => {
        const rows = document.querySelectorAll('#dc-group-table .sa-group-name');
        const groups = Array.from(rows).map(row => row.textContent.trim());
        if (groups.length === 0) return;

        const text = groups.join(', ');
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = newCopyBtn.innerHTML;
            newCopyBtn.innerHTML = `✓ Kopierat!`;
            setTimeout(() => { newCopyBtn.innerHTML = originalHTML; }, 2000);
        }).catch(err => {
            console.error('Kunde inte kopiera:', err);
            alert('Misslyckades med att kopiera till urklipp.');
        });
    });
}

function showFeedback(msg, isError) {
    const el = document.getElementById('dc-upload-feedback');
    el.textContent = msg;
    el.className = 'upload-feedback ' + (isError ? 'error' : 'success');
}

function handleFile(file) {
    if (!currentSupplierId) {
        showFeedback('Välj en leverantör först.', true);
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const buffer = reader.result;
        const text = new TextDecoder('iso-8859-1').decode(buffer);
        try {
            const supplierDef = SUPPLIERS[currentSupplierId];
            newDiscounts = supplierDef.parseAgreement(text);
            showFeedback(`Laddade in ${newDiscounts.size} rabattgrupper från ${file.name}`, false);
            compareAndRender();
        } catch (err) {
            console.error(err);
            showFeedback('Fel vid tolkning av rabattbrev: ' + err.message, true);
        }
    };
    reader.onerror = () => showFeedback('Kunde inte läsa filen', true);
    reader.readAsArrayBuffer(file);
}

function compareAndRender() {
    if (!dcResults || !currentSupplierId || !newDiscounts) return;

    // Build map of OLD discounts directly from the uploaded file content in localStorage
    const savedData = localStorage.getItem('prisjamfor_avtal');
    let oldDiscounts = new Map();

    if (savedData) {
        try {
            const uploads = JSON.parse(savedData);
            const saved = uploads[currentSupplierId];
            if (saved && saved.content) {
                const supplierDef = SUPPLIERS[currentSupplierId];
                if (supplierDef) {
                    oldDiscounts = supplierDef.parseAgreement(saved.content);
                }
            }
        } catch (e) {
            console.error('Kunde inte läsa gamla rabatter från localStorage:', e);
        }
    }

    if (oldDiscounts.size === 0) {
        // Fallback to rebuilding from supplierData if localStorage is empty or failed
        const supplierData = dcResults.supplierData[currentSupplierId];
        if (supplierData) {
            for (const [artNo, data] of supplierData.entries()) {
                const grp = data.grp;
                const disc = data.disc;
                if (grp && disc !== null) {
                    if (!oldDiscounts.has(grp)) {
                        oldDiscounts.set(grp, disc);
                    }
                }
            }
        }
    }

    // Compare
    const changes = [];
    let sumDiff = 0;
    let maxIncrease = 0;
    let maxDecrease = 0;
    let newGroupsCount = 0;

    for (const [grp, newDisc] of newDiscounts.entries()) {
        if (oldDiscounts.has(grp)) {
            const oldDisc = oldDiscounts.get(grp);
            // We ignore very small floating point diffs
            if (Math.abs(newDisc - oldDisc) > 0.001) {
                const diff = newDisc - oldDisc; // positive = better discount (cheaper)
                changes.push({
                    grp,
                    oldDisc,
                    newDisc,
                    diff,
                    isNew: false
                });

                sumDiff += diff;
                if (diff > maxIncrease) maxIncrease = diff;
                if (diff < maxDecrease) maxDecrease = diff;
            }
        } else {
            // New group entirely
            newGroupsCount++;
            changes.push({
                grp,
                oldDisc: 0,
                newDisc: newDisc,
                diff: newDisc,
                isNew: true
            });
        }
    }

    // Sort by largest real difference (both up and down) (ignoring pure 'new' groups for sort hierarchy, sticking them at the bottom unless they are huge)
    changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    currentChanges = changes;

    // Calculate metrics excluding new groups from avg Diff
    const changedExisting = changes.filter(c => !c.isNew);
    const avgDiff = changedExisting.length > 0 ? sumDiff / changedExisting.length : 0;

    renderKPIs(changedExisting.length, avgDiff, maxIncrease, maxDecrease, newGroupsCount);
    renderTable(changes);

    document.getElementById('dc-kpi-cards').style.display = 'flex';
    document.getElementById('dc-controls').style.display = 'flex';
    document.getElementById('dc-main').style.display = 'block';
}

function renderKPIs(changedCount, avgDiff, maxInc, maxDec, newCount) {
    const el = document.getElementById('dc-kpi-cards');

    const formatPct = (v) => v > 0 ? '+' + v.toFixed(1) : v.toFixed(1);
    const colorClass = (v) => {
        if (v > 0) return 'color: #16a34a'; // Green (better)
        if (v < 0) return 'color: #ef4444'; // Red (worse)
        return 'color: var(--text-primary)';
    };

    el.innerHTML = `
        <div class="sa-kpi">
            <span class="sa-kpi-label">Ändrade grupper</span>
            <span class="sa-kpi-value">${changedCount}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Skapade grupper</span>
            <span class="sa-kpi-value" style="color: #6366f1">${newCount}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Snittförändring</span>
            <span class="sa-kpi-value" style="${colorClass(avgDiff)}">${formatPct(avgDiff)}%</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Största höjning (bättre)</span>
            <span class="sa-kpi-value" style="color: #16a34a">${formatPct(maxInc)}%</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Största sänkning (sämre)</span>
            <span class="sa-kpi-value" style="color: #ef4444">${formatPct(maxDec)}%</span>
        </div>
    `;
}

function renderTable(changes) {
    const container = document.getElementById('dc-group-table');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'sa-table-header';
    header.innerHTML = `
        <span class="sa-th">Grupp</span>
        <span class="sa-th sa-col-num">Gammal Rabatt</span>
        <span class="sa-th sa-col-num">Ny Rabatt</span>
        <span class="sa-th sa-col-num">Skillnad</span>
    `;
    container.appendChild(header);

    let filtered = changes;
    const filterSelect = document.getElementById('dc-filter-select');
    if (filterSelect) {
        const val = filterSelect.value;
        if (val === 'positive') filtered = changes.filter(c => !c.isNew && c.diff > 0);
        else if (val === 'negative') filtered = changes.filter(c => !c.isNew && c.diff < 0);
        else if (val === 'new') filtered = changes.filter(c => c.isNew);
    }

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sa-empty';
        empty.textContent = 'Inga rabattgrupper matchar filtret.';
        container.appendChild(empty);
        return;
    }

    filtered.forEach(c => {
        const row = document.createElement('div');
        row.className = 'sa-table-row';

        let diffColor = '';
        if (c.diff > 0) diffColor = 'color: #16a34a; font-weight: 600;';
        if (c.diff < 0) diffColor = 'color: #ef4444; font-weight: 600;';
        const diffSign = c.diff > 0 ? '+' : '';

        const oldDiscDisplay = c.isNew ? '<span style="color:var(--text-muted); font-size:0.8rem;">(Ny)</span>' : `${c.oldDisc.toFixed(1)}%`;

        row.innerHTML = `
            <span class="sa-td sa-group-name">${c.grp}</span>
            <span class="sa-td sa-col-num">${oldDiscDisplay}</span>
            <span class="sa-td sa-col-num">${c.newDisc.toFixed(1)}%</span>
            <span class="sa-td sa-col-num" style="${diffColor}">${diffSign}${c.diff.toFixed(1)}%</span>
        `;
        container.appendChild(row);
    });
}
