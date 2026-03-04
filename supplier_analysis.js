// supplier_analysis.js — Leverantörsanalys: hitta fel i rabattgrupper
// Analyserar intern spridning av överpris% inom samma rabattgrupp.
// Stor spread (Max−Min) indikerar fel i GNP, att gruppen bör delas, eller
// att en konkurrerande leverantör har felaktiga priser.
//
// Läser från currentResults.matched (rådata) — INTE filtrerat urval.

import { SUPPLIERS } from './suppliers.js';

let saResults = null;       // Referens till compareSuppliers-output
let saCurrentSup = null;    // Vald leverantör-id
let saGroups = {};          // { supplierId: [groupStats] }
let saSpreadThreshold = 30; // Spread-tröskel för "misstänkt" (justerbar)
let saSortCol = 'spread';
let saSortAsc = false;
let saSelectedGroup = null; // För drill-down

// ─── Public API ────────────────────────────────────────────────────

/**
 * Initiera screenen med resultat från compareSuppliers.
 * Anropas när användaren navigerar till screenen.
 */
function initSupplierAnalysis(results) {
    saResults = results;
    saGroups = {};
    saSelectedGroup = null;

    // Beräkna statistik per leverantör och grupp
    for (const supId of results.supplierIds) {
        saGroups[supId] = computeGroupStats(results.matched, supId);
    }

    // Välj första leverantören som default
    saCurrentSup = results.supplierIds[0];

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
 * Använder ALLA matchade artiklar (currentResults.matched), ej filtrerat.
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
    const suspicious = groups.filter(g => g.spread >= saSpreadThreshold).length;
    const spreads = groups.map(g => g.spread).sort((a, b) => a - b);
    const medianSpread = spreads.length > 0
        ? (spreads.length % 2 === 0
            ? (spreads[spreads.length / 2 - 1] + spreads[spreads.length / 2]) / 2
            : spreads[Math.floor(spreads.length / 2)])
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
            <span class="sa-kpi-label">Grupper ≥ ${saSpreadThreshold}% spread</span>
            <span class="sa-kpi-value" style="color: ${suspicious > 0 ? '#ef4444' : 'var(--text-primary)'}">${suspicious}</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Median spread</span>
            <span class="sa-kpi-value">${medianSpread.toFixed(1)}%</span>
        </div>
        <div class="sa-kpi">
            <span class="sa-kpi-label">Max spread</span>
            <span class="sa-kpi-value" style="color: ${maxSpread > saSpreadThreshold ? '#ef4444' : 'inherit'}">${maxSpread.toFixed(1)}%</span>
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
    const groups = showOnlySuspicious
        ? allGroups.filter(g => g.spread >= saSpreadThreshold)
        : allGroups;

    // Sorteria
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
        { key: 'min', label: 'Min överpris', cls: 'sa-col-num' },
        { key: 'median', label: 'Median', cls: 'sa-col-num' },
        { key: 'max', label: 'Max överpris', cls: 'sa-col-num' },
        { key: 'spread', label: 'Spread', cls: 'sa-col-num sa-col-spread' },
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

        row.innerHTML = `
            <span class="sa-td sa-group-name">${g.grp}</span>
            <span class="sa-td sa-col-num">${g.count}</span>
            <span class="sa-td sa-col-num">${g.avgDisc.toFixed(1)}%</span>
            <span class="sa-td sa-col-num ${g.min > 0.01 ? 'sa-text-red' : 'sa-text-green'}">${g.min < 0.01 ? '0%' : '+' + g.min.toFixed(1) + '%'}</span>
            <span class="sa-td sa-col-num">${g.median.toFixed(1)}%</span>
            <span class="sa-td sa-col-num sa-text-red">${g.max < 0.01 ? '0%' : '+' + g.max.toFixed(1) + '%'}</span>
            <span class="sa-td sa-col-num sa-col-spread">
                <span class="sa-spread-pill" style="background:${spreadColor.bg}; color:${spreadColor.fg}">
                    ${g.spread.toFixed(1)} pp
                </span>
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
    const items = [...group.items].sort((a, b) => b.markup - a.markup);

    let rowsHtml = items.map(item => {
        const s = item.article.suppliers[saCurrentSup];
        const cls = item.markup > 0.01 ? 'sa-text-red' : 'sa-text-green';
        const markupDisplay = item.markup < 0.01 ? '0%' : '+' + item.markup.toFixed(1) + '%';
        return `
            <tr>
                <td>${item.enr}</td>
                <td>${s ? s.net.toFixed(2) : '—'}</td>
                <td>${s ? s.list.toFixed(2) : '—'}</td>
                <td class="${cls}">${markupDisplay}</td>
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
