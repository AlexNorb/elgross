// supplier_analysis.js — Leverantörsanalys: hitta fel i rabattgrupper
// Analyserar intern spridning av överpris% inom samma rabattgrupp.
// Stor spread (Max−Min) indikerar fel i GNP, att gruppen bör delas, eller
// att en konkurrerande leverantör har felaktiga priser.

import { SUPPLIERS } from './suppliers.js';
import { filterArticles } from './engine.js';

let saResults = null;       // Referens till compareSuppliers-output
let saCurrentSup = null;    // Vald leverantör-id
let saGroups = {};          // { supplierId: [groupStats] }
let saSpreadThreshold = 30; // Spread-tröskel för "misstänkt" (justerbar)
let saSortCol = 'spread';
let saSortAsc = false;
let saSelectedGroup = null; // För drill-down

// ─── Filter State ──────────────────────────────────────────────────

let saFiltersInitialized = false;
let saFavEnrSet = null;        // Set of 7-digit E-nummers
const SA_ENR_REGEX = /^\d{7}$/;

// ─── Public API ────────────────────────────────────────────────────

/**
 * Initiera screenen med resultat från compareSuppliers.
 * Anropas när användaren navigerar till screenen.
 */
function initSupplierAnalysis(results) {
    saResults = results;
    saGroups = {};
    saSelectedGroup = null;

    // Välj första leverantören som default
    saCurrentSup = results.supplierIds[0];

    // Setup filters (once)
    setupSAFilters();

    // Apply filters to compute groups from (possibly filtered) data
    applySAFilters();

    renderSupplierAnalysis();

    // Koppla checkbox (körs bara en gång per screen-visit)
    const onlyCb = document.getElementById('sa-only-suspicious');
    if (onlyCb) {
        // Klona för att rensa gamla listeners
        const fresh = onlyCb.cloneNode(true);
        onlyCb.parentNode.replaceChild(fresh, onlyCb);
        fresh.addEventListener('change', () => {
            renderGroupTable();
        });
    }
}

// ─── Beräkningslogik ───────────────────────────────────────────────

/**
 * Beräkna spread-statistik per rabattgrupp för en leverantör.
 * Använder det dataset som skickas in (kan vara filtrerat).
 */
function computeGroupStats(matched, supId) {
    // Bygg: grp → array av överpris%
    const grpMap = {};

    for (const article of matched) {
        const supData = article.suppliers[supId];
        if (!supData) continue;
        const grp = supData.grp;
        if (!grp) continue;
        if (!grpMap[grp]) grpMap[grp] = [];
        grpMap[grp].push({ markup: supData.markup, enr: article.enr, article });
    }

    const stats = [];
    for (const [grp, items] of Object.entries(grpMap)) {
        if (items.length === 0) continue;

        const markups = items.map(i => i.markup).sort((a, b) => a - b);
        const n = markups.length;
        const min = markups[0];
        const max = markups[n - 1];
        const spread = max - min;
        const sum = markups.reduce((a, b) => a + b, 0);
        const avg = sum / n;

        // Median
        const mid = Math.floor(n / 2);
        const median = n % 2 === 0 ? (markups[mid - 1] + markups[mid]) / 2 : markups[mid];

        // Rabatt% (samma för hela gruppen om avtal är korrekt, annars snitt)
        const discounts = items.map(i => i.article.suppliers[supId]?.disc ?? 0);
        const avgDisc = discounts.reduce((a, b) => a + b, 0) / discounts.length;

        stats.push({
            grp,
            count: n,
            min,
            max,
            spread,
            avg,
            median,
            avgDisc,
            items  // array av { markup, enr, article }
        });
    }

    return stats;
}

// ─── Filter Setup ──────────────────────────────────────────────────

function setupSAFilters() {
    if (saFiltersInitialized) return;
    saFiltersInitialized = true;

    // Filters setup (Category checkboxes are built below)

    // Favoritlista file input
    const favFileInput = document.getElementById('sa-fav-file-input');
    if (favFileInput) {
        favFileInput.addEventListener('change', (e) => {
            handleSAFavFiles(e.target.files);
            e.target.value = '';
        });
    }

    // Favoritlista textarea debounce
    const favTa = document.getElementById('sa-fav-enr-input');
    if (favTa) {
        let debounceTimer;
        favTa.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                parseSAFavInput();
                applySAFilters(); renderSupplierAnalysis();
            }, 500);
        });
    }

    // Fav update button
    const favUpdateBtn = document.getElementById('sa-btn-fav-update');
    if (favUpdateBtn) {
        favUpdateBtn.addEventListener('click', () => {
            parseSAFavInput();
            applySAFilters(); renderSupplierAnalysis();
        });
    }

    // Fav dropzone drag & drop
    const favDropzone = document.getElementById('sa-fav-dropzone');
    if (favDropzone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evName => {
            favDropzone.addEventListener(evName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        });
        ['dragenter', 'dragover'].forEach(evName => {
            favDropzone.addEventListener(evName, () => favDropzone.classList.add('dragover'), false);
        });
        ['dragleave', 'drop'].forEach(evName => {
            favDropzone.addEventListener(evName, () => favDropzone.classList.remove('dragover'), false);
        });
        favDropzone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSAFavFiles(e.dataTransfer.files);
            }
        }, false);
    }

    // Fav clear
    const favClearBtn = document.getElementById('sa-btn-fav-clear');
    if (favClearBtn) favClearBtn.addEventListener('click', clearSAFavList);

    // Build category checkboxes
    buildSACategoryCheckboxes();
}

// ─── Apply Filters ─────────────────────────────────────────────────

function applySAFilters() {
    if (!saResults) return;

    const filters = {
        categories: getSACheckedCategories(),
    };

    let source = saResults.matched;

    // Favoritlista filter: sök fram grupper i den aktuella leverantören
    if (saFavEnrSet && saFavEnrSet.size > 0 && saCurrentSup) {
        const currentData = saResults.supplierData[saCurrentSup];
        const targetGroups = new Set();
        if (currentData) {
            for (const enr of saFavEnrSet) {
                if (currentData.has(enr)) {
                    targetGroups.add(currentData.get(enr).grp);
                }
            }
        }
        
        // Behåll endast artiklar som i aktuell leverantör tillhör någon av de funna grupperna
        source = source.filter(a => {
            const supObj = a.suppliers[saCurrentSup];
            return supObj && targetGroups.has(supObj.grp);
        });
    }

    // Apply engine filters
    const filtered = filterArticles(source, filters);

    // Recompute group stats from filtered articles
    saGroups = {};
    for (const supId of saResults.supplierIds) {
        saGroups[supId] = computeGroupStats(filtered, supId);
    }

    // Update filter count
    const countEl = document.getElementById('sa-filter-count');
    if (countEl) {
        const totalArticles = saResults.matched.length;
        const filteredCount = filtered.length;
        if (filteredCount < totalArticles) {
            countEl.textContent = `Filtrerat: ${filteredCount.toLocaleString('sv-SE')} av ${totalArticles.toLocaleString('sv-SE')} artiklar`;
        } else {
            countEl.textContent = '';
        }
    }
}

// ─── Category Checkboxes (SA) ──────────────────────────────────────

function buildSACategoryCheckboxes() {
    const container = document.getElementById('sa-cat-checkboxes');
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < 100; i += 10) {
        const from = String(i).padStart(2, '0');
        const to = String(i + 9).padStart(2, '0');

        const group = document.createElement('div');
        group.className = 'cat-group';

        // L1 parent checkbox
        const l1Label = document.createElement('label');
        l1Label.className = 'cat-l1';
        const l1Cb = document.createElement('input');
        l1Cb.type = 'checkbox';
        l1Cb.className = 'sa-cat-l1-cb';
        l1Cb.dataset.start = i;
        l1Label.appendChild(l1Cb);
        l1Label.appendChild(document.createTextNode(` ${from}–${to}`));

        // Toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'cat-toggle';
        toggle.textContent = '▸';
        toggle.onclick = (e) => {
            e.preventDefault();
            const children = group.querySelector('.cat-children');
            const open = children.style.display !== 'none';
            children.style.display = open ? 'none' : 'flex';
            toggle.textContent = open ? '▸' : '▾';
        };
        l1Label.prepend(toggle);
        group.appendChild(l1Label);

        // L2 children container
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'cat-children';
        childrenDiv.style.display = 'none';

        for (let j = i; j <= i + 9; j++) {
            const prefix = String(j).padStart(2, '0');
            const l2Label = document.createElement('label');
            l2Label.className = 'cat-l2';
            const l2Cb = document.createElement('input');
            l2Cb.type = 'checkbox';
            l2Cb.className = 'sa-cat-l2-cb';
            l2Cb.value = prefix;
            l2Cb.addEventListener('change', () => {
                const siblings = childrenDiv.querySelectorAll('.sa-cat-l2-cb');
                const allChecked = [...siblings].every(s => s.checked);
                const someChecked = [...siblings].some(s => s.checked);
                l1Cb.checked = allChecked;
                l1Cb.indeterminate = someChecked && !allChecked;
                applySAFilters(); renderSupplierAnalysis();
            });
            l2Label.appendChild(l2Cb);
            l2Label.appendChild(document.createTextNode(` ${prefix}`));
            childrenDiv.appendChild(l2Label);
        }

        // L1 click toggles all children
        l1Cb.addEventListener('change', () => {
            const children = childrenDiv.querySelectorAll('.sa-cat-l2-cb');
            children.forEach(cb => cb.checked = l1Cb.checked);
            l1Cb.indeterminate = false;
            applySAFilters(); renderSupplierAnalysis();
        });

        group.appendChild(childrenDiv);
        container.appendChild(group);
    }
}

function getSACheckedCategories() {
    const checked = document.querySelectorAll('.sa-cat-l2-cb:checked');
    if (!checked.length) return [];
    return [...checked].map(cb => cb.value);
}

function uncheckSACategories() {
    document.querySelectorAll('.sa-cat-l1-cb, .sa-cat-l2-cb').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });
}



// ─── Favoritlista (SA) ────────────────────────────────────────────

function parseSAFavInput() {
    const ta = document.getElementById('sa-fav-enr-input');
    const countEl = document.getElementById('sa-fav-count');
    const umDetails = document.getElementById('sa-fav-unmatched-details');
    const umSummary = document.getElementById('sa-fav-unmatched-summary');
    const umList = document.getElementById('sa-fav-unmatched-list');

    if (!ta) return;

    const raw = ta.value;
    if (!raw.trim()) {
        saFavEnrSet = null;
        if (countEl) countEl.textContent = '';
        if (umDetails) umDetails.style.display = 'none';
        if (umList) umList.textContent = '';
        return;
    }

    const tokens = raw.split(/[\n\r,;\t]+/).map(s => s.trim()).filter(Boolean);
    const valid = tokens.filter(t => SA_ENR_REGEX.test(t));
    const uniqueValid = [...new Set(valid)];

    let matchedEnrs = null;
    if (saResults) {
        matchedEnrs = new Set(saResults.matched.map(a => a.enr));
        saFavEnrSet = new Set(uniqueValid.filter(e => matchedEnrs.has(e)));
    } else {
        saFavEnrSet = new Set(uniqueValid);
    }

    const skipped = tokens.length - valid.length;
    const unmatched = uniqueValid.filter(e => !saFavEnrSet.has(e));

    let label = `${saFavEnrSet.size} E-nummer laddade`;
    if (skipped > 0) label += `, ${skipped} ogiltiga (ej 7 siffror)`;
    if (unmatched.length > 0) label += `, ${unmatched.length} utan match`;
    if (countEl) countEl.textContent = label;

    if (umDetails) {
        if (unmatched.length > 0) {
            umDetails.style.display = 'block';
            if (umSummary) umSummary.textContent = `Visa ${unmatched.length} saknade`;
            if (umList) umList.textContent = unmatched.join(', ');
        } else {
            umDetails.style.display = 'none';
            if (umList) umList.textContent = '';
        }
    }
}

function handleSAFavFiles(files) {
    if (!files || files.length === 0) return;
    const ta = document.getElementById('sa-fav-enr-input');
    if (!ta) return;

    let filesProcessed = 0;
    let allText = ta.value;
    if (allText && !allText.endsWith('\n')) allText += '\n';

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            allText += e.target.result + '\n';
            filesProcessed++;
            if (filesProcessed === files.length) {
                ta.value = allText;
                parseSAFavInput();
                applySAFilters();
                renderSupplierAnalysis();
            }
        };
        reader.readAsText(file);
    });
}

function clearSAFavList() {
    const ta = document.getElementById('sa-fav-enr-input');
    if (ta) ta.value = '';
    saFavEnrSet = null;
    const countEl = document.getElementById('sa-fav-count');
    if (countEl) countEl.textContent = '';
    const umDetails = document.getElementById('sa-fav-unmatched-details');
    if (umDetails) umDetails.style.display = 'none';
    const umList = document.getElementById('sa-fav-unmatched-list');
    if (umList) umList.textContent = '';
    applySAFilters();
    renderSupplierAnalysis();
}
// ─── Huvud-render ──────────────────────────────────────────────────

function renderSupplierAnalysis() {
    if (!saResults) return;

    renderSupTabs();
    renderKPICards();
    renderThresholdControl();
    renderGroupTable();
    renderDrillDown(null);
}

// ─── Leverantörstabbar ─────────────────────────────────────────────

function renderSupTabs() {
    const container = document.getElementById('sa-sup-tabs');
    if (!container) return;

    container.innerHTML = '';
    for (const supId of saResults.supplierIds) {
        const sup = SUPPLIERS[supId];
        const btn = document.createElement('button');
        btn.className = 'sa-tab' + (supId === saCurrentSup ? ' active' : '');
        btn.innerHTML = `
            <span class="sa-tab-icon" style="background:${sup.color}">${sup.icon}</span>
            ${sup.name}
        `;
        btn.addEventListener('click', () => {
            saCurrentSup = supId;
            saSelectedGroup = null;
            applySAFilters();
            renderSupTabs();
            renderKPICards();
            renderGroupTable();
            renderDrillDown(null);
        });
        container.appendChild(btn);
    }
}

// ─── KPI-cards ────────────────────────────────────────────────────

function renderKPICards() {
    const el = document.getElementById('sa-kpi-cards');
    if (!el || !saCurrentSup) return;

    const groups = saGroups[saCurrentSup] || [];
    const sup = SUPPLIERS[saCurrentSup];

    const totalGroups = groups.length;
    const totalArticles = groups.reduce((s, g) => s + g.count, 0);
    const suspicious = groups.filter(g => g.spread >= saSpreadThreshold);
    const suspiciousCount = suspicious.length;
    const spreads = groups.map(g => g.spread).sort((a, b) => a - b);
    // Median spread computed from suspicious groups only (more meaningful)
    const suspSpreads = suspicious.map(g => g.spread).sort((a, b) => a - b);
    const medianSpread = suspSpreads.length > 0
        ? (suspSpreads.length % 2 === 0
            ? (suspSpreads[suspSpreads.length / 2 - 1] + suspSpreads[suspSpreads.length / 2]) / 2
            : suspSpreads[Math.floor(suspSpreads.length / 2)])
        : 0;
    const maxSpread = spreads.length > 0 ? spreads[spreads.length - 1] : 0;

    el.innerHTML = `
        <div class="sa-kpi">
            <span class="sa-kpi-label">Rabattgrupper</span>
            <span class="sa-kpi-value">${totalGroups}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Artiklar (totalt)</span>
            <span class="sa-kpi-value">${totalArticles.toLocaleString('sv-SE')}</span>
        </div>
        <div class="sa-kpi sa-kpi--warn">
            <span class="sa-kpi-label">Grupper ≥ ${saSpreadThreshold} spread</span>
            <span class="sa-kpi-value" style="color: ${suspiciousCount > 0 ? '#ef4444' : 'var(--text-primary)'}">${suspiciousCount}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Median spread (misstänkta)</span>
            <span class="sa-kpi-value">${suspSpreads.length > 0 ? Math.round(medianSpread) : '—'}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Max spread</span>
            <span class="sa-kpi-value" style="color: ${maxSpread > saSpreadThreshold ? '#ef4444' : 'inherit'}">${Math.round(maxSpread)}</span>
        </div>
    `;
}

// ─── Tröskelkontroll ─────────────────────────────────────────────

function renderThresholdControl() {
    const el = document.getElementById('sa-threshold-control');
    if (!el) return;

    // Lägg bara ut HTML första gången (undvik att skriva över en aktiv slider)
    if (el.dataset.initialized) return;
    el.dataset.initialized = '1';

    el.innerHTML = `
        <label class="sa-threshold-label">
            Visa misstänkta grupper med spread &gt;
            <input type="number" id="sa-threshold-input" class="sa-threshold-input"
                value="${saSpreadThreshold}" min="0" max="999" step="5">
            %
        </label>
    `;

    document.getElementById('sa-threshold-input').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= 0) {
            saSpreadThreshold = v;
            renderKPICards();
            renderGroupTable();
        }
    });
}

// ─── Rabattgruppstabell ───────────────────────────────────────────

function renderGroupTable() {
    const container = document.getElementById('sa-group-table');
    if (!container || !saCurrentSup) return;

    const allGroups = saGroups[saCurrentSup] || [];

    // Filtrera efter tröskel — visa ALLA, men markera misstänkta
    // (filtrera endast om checkbox är aktivt, annars visa allt sorterat)
    const showOnlySuspicious = document.getElementById('sa-only-suspicious')?.checked ?? false;
    const baseGroups = showOnlySuspicious
        ? allGroups.filter(g => g.spread >= saSpreadThreshold)
        : allGroups;

    // Berika med outlierPct innan sortering
    const groups = baseGroups.map(g => {
        const cutoff = g.min + saSpreadThreshold;
        const outlierCount = g.items.filter(i => i.markup >= cutoff).length;
        return { ...g, outlierPct: Math.round((outlierCount / g.count) * 100) };
    });

    // Sortera
    const sorted = [...groups].sort((a, b) => {
        let va = a[saSortCol], vb = b[saSortCol];
        if (typeof va === 'string') return saSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        return saSortAsc ? va - vb : vb - va;
    });

    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'sa-table-header';

    const cols = [
        { key: 'grp', label: 'Grupp', cls: '' },
        { key: 'count', label: 'Art.', cls: 'sa-col-num' },
        { key: 'avgDisc', label: 'Rabatt%', cls: 'sa-col-num' },
        { key: 'median', label: 'Median', cls: 'sa-col-num' },
        { key: 'spread', label: 'Spread', cls: 'sa-col-num sa-col-spread' },
        { key: 'outlierPct', label: 'Toppar', cls: 'sa-col-bar' },
    ];

    cols.forEach(({ key, label, cls }) => {
        const cell = document.createElement('span');
        cell.className = `sa-th ${cls}`;
        cell.textContent = label + (saSortCol === key ? (saSortAsc ? ' ▲' : ' ▼') : '');
        if (saSortCol === key) cell.style.fontWeight = '700';
        cell.addEventListener('click', () => {
            if (saSortCol === key) saSortAsc = !saSortAsc;
            else { saSortCol = key; saSortAsc = key === 'grp'; }
            renderGroupTable();
        });
        header.appendChild(cell);
    });
    container.appendChild(header);

    // Rader
    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sa-empty';
        empty.textContent = 'Inga grupper matchar filtret.';
        container.appendChild(empty);
        return;
    }

    sorted.forEach(g => {
        const row = document.createElement('div');
        const isSuspicious = g.spread >= saSpreadThreshold;
        const isSelected = saSelectedGroup === g.grp;
        row.className = `sa-table-row${isSuspicious ? ' sa-row--suspicious' : ''}${isSelected ? ' sa-row--selected' : ''}`;

        const spreadColor = spreadToColor(g.spread);
        const outlierPct = g.outlierPct; // redan beräknat ovan

        row.innerHTML = `
            <span class="sa-td sa-group-name">${g.grp}</span>
            <span class="sa-td sa-col-num">${g.count}</span>
            <span class="sa-td sa-col-num">${g.avgDisc.toFixed(1)}%</span>
            <span class="sa-td sa-col-num">${Math.round(g.median)}%</span>
            <span class="sa-td sa-col-num sa-col-spread">
                <span class="sa-spread-pill" style="background:${spreadColor.bg}; color:${spreadColor.fg}">
                    ${Math.round(g.spread)}
                </span>
            </span>
            <span class="sa-td sa-col-bar">
                <span class="sa-bar-wrap">
                    <span class="sa-bar-fill" style="width:${outlierPct}%"></span>
                </span>
                <span class="sa-bar-pct">${outlierPct}%</span>
            </span>
        `;

        row.addEventListener('click', () => {
            saSelectedGroup = isSelected ? null : g.grp;
            renderGroupTable();
            renderDrillDown(isSelected ? null : g);
        });

        container.appendChild(row);
    });
}

// ─── Spridningsfärgkodning ───────────────────────────────────────

function spreadToColor(spread) {
    if (spread < 20) return { bg: '#dcfce7', fg: '#166534' };  // grön
    if (spread < 50) return { bg: '#fef9c3', fg: '#854d0e' };  // gul
    if (spread < 100) return { bg: '#fed7aa', fg: '#9a3412' };  // orange
    return { bg: '#fecaca', fg: '#7f1d1d' };                     // röd
}

// ─── Drill-down panel ────────────────────────────────────────────

function renderDrillDown(group) {
    const panel = document.getElementById('sa-drilldown');
    if (!panel) return;

    if (!group) {
        panel.innerHTML = `
            <div class="sa-drilldown-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <p>Klicka på en rabattgrupp för att se dess artiklar</p>
            </div>
        `;
        return;
    }

    const sup = SUPPLIERS[saCurrentSup];
    const cutoff = group.min + saSpreadThreshold;
    const items = [...group.items].sort((a, b) => b.markup - a.markup);

    let rowsHtml = items.map(item => {
        const s = item.article.suppliers[saCurrentSup];
        const isTopper = item.markup >= cutoff;
        const markupCls = item.markup > 0.01 ? 'sa-text-red' : 'sa-text-green';
        const markupDisplay = item.markup < 0.01 ? '0%' : '+' + item.markup.toFixed(1) + '%';
        return `
            <tr class="${isTopper ? 'sa-row-topper' : ''}">
                <td>${item.enr}</td>
                <td>${s ? s.net.toFixed(2) : '—'}</td>
                <td>${s ? s.list.toFixed(2) : '—'}</td>
                <td class="${markupCls}">${markupDisplay}</td>
                <td>${item.article.cheapest === saCurrentSup ? '✓' : item.article.cheapest === 'equal' ? '=' : ''}</td>
            </tr>
        `;
    }).join('');

    const spreadColor = spreadToColor(group.spread);

    panel.innerHTML = `
        <div class="sa-drilldown-header">
            <div class="sa-drilldown-title">
                <span class="sa-tab-icon" style="background:${sup.color}">${sup.icon}</span>
                Grupp <strong>${group.grp}</strong>
                <span class="sa-spread-pill" style="background:${spreadColor.bg}; color:${spreadColor.fg}; margin-left:8px">
                    Spread: ${group.spread.toFixed(1)} pp
                </span>
            </div>
            <div class="sa-drilldown-meta">
                ${group.count} artiklar &nbsp;·&nbsp;
                Min: <span class="${group.min > 0.01 ? 'sa-text-red' : 'sa-text-green'}">${group.min < 0.01 ? '0' : '+' + group.min.toFixed(1)}%</span> &nbsp;·&nbsp;
                Median: ${group.median.toFixed(1)}% &nbsp;·&nbsp;
                Max: <span class="sa-text-red">${group.max < 0.01 ? '0' : '+' + group.max.toFixed(1)}%</span> &nbsp;·&nbsp;
                Rabatt: ${group.avgDisc.toFixed(1)}%
            </div>
        </div>
        <div class="sa-drilldown-scroll">
            <table class="sa-article-table">
                <thead>
                    <tr>
                        <th>E-nummer</th>
                        <th>Nettopris</th>
                        <th>Listpris</th>
                        <th>Överpris%</th>
                        <th>Billigast?</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    `;
}

// ─── Export ───────────────────────────────────────────────────────

export { initSupplierAnalysis };
