// dashboard.js — Results dashboard rendering with virtual scrolling

import { SUPPLIERS } from './suppliers.js';
import { filterArticles, computeStats } from './engine.js';

let currentResults = null;
let currentFiltered = null;
let sortColumn = null;
let sortAsc = true;

// ── Screen Management ──────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}

// ── Main Dashboard Render ──────────────────────────────────────────

function renderDashboard(results) {
  currentResults = results;
  const [idA, idB] = results.supplierIds;
  const supA = SUPPLIERS[idA];
  const supB = SUPPLIERS[idB];

  // Executive Summary
  renderExecutiveSummary(results, supA, supB);

  // Savings Breakdown
  renderSavingsBreakdown(results, supA, supB, idA, idB);

  // Group Analysis
  renderGroupAnalysis(results, supA, supB, idA, idB);

  // Top Opportunities
  renderTopOpportunities(results, supA, supB, idA, idB);

  // Negotiation Recommendations
  renderNegotiation(results, supA, supB, idA, idB);

  // Article Table (initial: all matched)
  setupFilters(results, idA, idB);
  applyFilters();

  // Back button
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.onclick = () => showScreen('upload');
  }
}

// ── Executive Summary ──────────────────────────────────────────────

function renderExecutiveSummary(results, supA, supB) {
  const { stats, excluded } = results;
  const totalSavings = stats.totalSavings;
  const winner = stats.avgDiffPct > 0 ? supB : supA;

  // Hero number
  document.getElementById('hero-savings').textContent =
    formatKr(totalSavings);
  document.getElementById('hero-savings-label').textContent =
    'Total besparingspotential om du alltid väljer billigast';

  // Winner badge
  const winnerEl = document.getElementById('hero-winner');
  winnerEl.textContent = winner.name;
  winnerEl.style.background = winner.color;

  // Win percentage
  const totalCompared = stats.winsA + stats.winsB + stats.equal;
  const winnerPct = stats.avgDiffPct > 0
    ? ((stats.winsB / totalCompared) * 100).toFixed(0)
    : ((stats.winsA / totalCompared) * 100).toFixed(0);
  document.getElementById('hero-insight').textContent =
    `${winner.name} är billigare på ${winnerPct}% av artiklarna`;

  // Summary stats row
  const statsRow = document.getElementById('summary-stats');
  statsRow.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.totalMatched.toLocaleString('sv-SE')}</div>
      <div class="stat-label">Matchade artiklar</div>
    </div>
    <div class="stat-card">
      <div class="stat-value ${stats.avgDiffPct > 0 ? 'text-red' : 'text-green'}">${stats.avgDiffPct.toFixed(2)}%</div>
      <div class="stat-label">Snitt prisskillnad</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${supA.color}">${stats.winsA.toLocaleString('sv-SE')}</div>
      <div class="stat-label">${supA.name} billigare</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${supB.color}">${stats.winsB.toLocaleString('sv-SE')}</div>
      <div class="stat-label">${supB.name} billigare</div>
    </div>
    <div class="stat-card">
      <div class="stat-value text-muted">${stats.equal.toLocaleString('sv-SE')}</div>
      <div class="stat-label">Samma pris</div>
    </div>
  `;

  // Excluded stats
  const exclEl = document.getElementById('excluded-stats');
  exclEl.innerHTML = `
    <span class="excl-tag">Olika enhet: ${excluded.unitMismatch}</span>
    <span class="excl-tag">Bara ${supA.name}: ${excluded.onlyA}</span>
    <span class="excl-tag">Bara ${supB.name}: ${excluded.onlyB}</span>
    <span class="excl-tag">Saknar avtal: ${excluded.missingAgreement}</span>
    <span class="excl-tag">Pris = 0: ${excluded.zeroPrice}</span>
  `;
}

// ── Savings Breakdown ──────────────────────────────────────────────

function renderSavingsBreakdown(results, supA, supB, idA, idB) {
  const container = document.getElementById('savings-cards');
  container.innerHTML = '';

  const { stats, matched } = results;
  const totalCompared = stats.winsA + stats.winsB + stats.equal;

  [{ sup: supA, id: idA, wins: stats.winsA, label: 'billigare' },
  { sup: supB, id: idB, wins: stats.winsB, label: 'billigare' }].forEach(({ sup, id, wins }) => {
    const pct = totalCompared > 0 ? (wins / totalCompared * 100).toFixed(1) : 0;
    const savingsKr = matched
      .filter(a => a.cheapest === id)
      .reduce((sum, a) => sum + Math.abs(a.diffKr), 0);

    const card = document.createElement('div');
    card.className = 'savings-card';
    card.style.borderColor = sup.color;
    card.innerHTML = `
      <div class="savings-header" style="background:${sup.color}">
        <span class="savings-icon">${sup.icon}</span>
        <span class="savings-name">${sup.name}</span>
      </div>
      <div class="savings-body">
        <div class="savings-bar-wrap">
          <div class="savings-bar" style="width:${pct}%;background:${sup.color}"></div>
          <span class="savings-bar-label">${pct}% av artiklarna</span>
        </div>
        <div class="savings-detail">
          <span class="savings-wins">${wins.toLocaleString('sv-SE')} artiklar</span>
          <span class="savings-kr">${formatKr(savingsKr)} billigare totalt</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Group Analysis ─────────────────────────────────────────────────

function renderGroupAnalysis(results, supA, supB, idA, idB) {
  const container = document.getElementById('group-cards');
  container.innerHTML = '';

  // Sort controls
  const sortBar = document.getElementById('group-sort');
  if (sortBar) {
    sortBar.innerHTML = `
      <button class="sort-btn active" data-sort="impact">Störst besparing</button>
      <button class="sort-btn" data-sort="count">Flest artiklar</button>
      <button class="sort-btn" data-sort="pct">Högst % skillnad</button>
    `;
    sortBar.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortBar.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderGroupCards(results, supA, supB, idA, idB, btn.dataset.sort);
      });
    });
  }

  renderGroupCards(results, supA, supB, idA, idB, 'impact');
}

function renderGroupCards(results, supA, supB, idA, idB, sortBy) {
  const container = document.getElementById('group-cards');
  container.innerHTML = '';

  // Merge groups from both suppliers
  const allGroups = new Map();
  for (const [grp, data] of Object.entries(results.groups[idA])) {
    allGroups.set(grp, { ...data, supplier: supA, supplierId: idA });
  }

  let entries = [...allGroups.entries()];

  // Sort
  if (sortBy === 'impact') {
    entries.sort((a, b) => Math.abs(b[1].sumDiffKr) - Math.abs(a[1].sumDiffKr));
  } else if (sortBy === 'count') {
    entries.sort((a, b) => b[1].count - a[1].count);
  } else if (sortBy === 'pct') {
    entries.sort((a, b) => Math.abs(b[1].avgPct) - Math.abs(a[1].avgPct));
  }

  // Show top 20
  entries.slice(0, 20).forEach(([grp, data]) => {
    const winner = data.avgPct > 0 ? supB : supA;
    const card = document.createElement('div');
    card.className = 'group-card';
    card.style.setProperty('--winner-color', winner.color);
    card.innerHTML = `
      <div class="group-card-header">
        <span class="group-name">${grp}</span>
        <span class="group-winner" style="background:${winner.color}">${winner.icon}</span>
      </div>
      <div class="group-card-body">
        <div class="group-stat">
          <span class="gstat-value">${data.count}</span>
          <span class="gstat-label">artiklar</span>
        </div>
        <div class="group-stat">
          <span class="gstat-value ${data.avgPct > 0 ? 'text-red' : 'text-green'}">${data.avgPct.toFixed(1)}%</span>
          <span class="gstat-label">snitt diff</span>
        </div>
        <div class="group-stat">
          <span class="gstat-value">${formatKr(Math.abs(data.sumDiffKr))}</span>
          <span class="gstat-label">total diff</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      document.getElementById('f-group').value = grp;
      applyFilters();
      document.getElementById('article-section').scrollIntoView({ behavior: 'smooth' });
    });
    container.appendChild(card);
  });
}

// ── Top Opportunities ──────────────────────────────────────────────

function renderTopOpportunities(results, supA, supB, idA, idB) {
  const container = document.getElementById('opportunities-list');
  container.innerHTML = '';

  // Top 10 groups by total savings
  const groupsA = Object.entries(results.groups[idA])
    .filter(([, d]) => d.avgPct > 0)
    .sort((a, b) => b[1].sumDiffKr - a[1].sumDiffKr)
    .slice(0, 10);

  const groupsB = Object.entries(results.groups[idB] || {})
    .filter(([, d]) => d.avgPct < 0)
    .sort((a, b) => a[1].sumDiffKr - b[1].sumDiffKr)
    .slice(0, 10);

  // Render two columns
  container.innerHTML = `
    <div class="opp-column">
      <h3 class="opp-heading" style="color:${supA.color}">Byt till ${supB.name} i dessa grupper</h3>
      <div class="opp-list" id="opp-list-a"></div>
    </div>
    <div class="opp-column">
      <h3 class="opp-heading" style="color:${supB.color}">Byt till ${supA.name} i dessa grupper</h3>
      <div class="opp-list" id="opp-list-b"></div>
    </div>
  `;

  renderOppList('opp-list-a', groupsA, supB);
  renderOppList('opp-list-b', groupsB, supA);
}

function renderOppList(containerId, groups, winnerSup) {
  const el = document.getElementById(containerId);
  groups.forEach(([grp, data], i) => {
    const row = document.createElement('div');
    row.className = 'opp-row';
    row.innerHTML = `
      <span class="opp-rank">${i + 1}</span>
      <span class="opp-group">${grp}</span>
      <span class="opp-articles">${data.count} art.</span>
      <span class="opp-diff ${data.avgPct > 0 ? 'text-red' : 'text-green'}">${data.avgPct.toFixed(1)}%</span>
      <span class="opp-kr">${formatKr(Math.abs(data.sumDiffKr))}</span>
    `;
    row.addEventListener('click', () => {
      document.getElementById('f-group').value = grp;
      applyFilters();
      document.getElementById('article-section').scrollIntoView({ behavior: 'smooth' });
    });
    el.appendChild(row);
  });
}

// ── Negotiation Recommendations ────────────────────────────────────

function renderNegotiation(results, supA, supB, idA, idB) {
  const container = document.getElementById('negotiation-content');
  container.innerHTML = '';

  [{ sup: supA, id: idA, recs: results.recommendations[idA], comp: supB },
  { sup: supB, id: idB, recs: results.recommendations[idB], comp: supA }].forEach(({ sup, recs, comp }) => {
    if (!recs || recs.length === 0) return;

    const section = document.createElement('div');
    section.className = 'neg-section';
    section.innerHTML = `
      <h3 class="neg-heading">
        <span class="neg-icon" style="background:${sup.color}">${sup.icon}</span>
        Förhandla med ${sup.name}
        <small>Där ${comp.name} är billigare</small>
      </h3>
    `;

    const table = document.createElement('div');
    table.className = 'neg-table';
    table.innerHTML = `
      <div class="neg-header">
        <span>Grupp</span>
        <span>Artiklar</span>
        <span>Nuv. rabatt</span>
        <span>Mål</span>
        <span>Total kr</span>
      </div>
    `;

    recs.slice(0, 15).forEach(rec => {
      const row = document.createElement('div');
      row.className = 'neg-row';
      row.innerHTML = `
        <span class="neg-group">${rec.group}</span>
        <span>${rec.articleCount}</span>
        <span>${rec.currentDiscount.toFixed(1)}%</span>
        <span class="text-green">${rec.targetDiscount.toFixed(1)}%</span>
        <span class="neg-impact">${formatKr(rec.totalImpactKr)}</span>
      `;
      table.appendChild(row);
    });

    section.appendChild(table);
    container.appendChild(section);
  });
}

// ── Filters & Article Table ────────────────────────────────────────

let filtersInitialized = false;

function setupFilters(results, idA, idB) {
  if (filtersInitialized) return;
  filtersInitialized = true;

  const supA = SUPPLIERS[idA];
  const supB = SUPPLIERS[idB];

  // Cheapest filter options
  const cheapestSelect = document.getElementById('f-cheapest');
  cheapestSelect.innerHTML = `
    <option value="">Alla</option>
    <option value="${idA}">${supA.name}</option>
    <option value="${idB}">${supB.name}</option>
  `;

  // Apply button
  document.getElementById('btn-apply-filters').addEventListener('click', applyFilters);

  // Enter key
  document.querySelectorAll('#filter-bar input, #filter-bar select').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
  });

  // Reset
  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    ['f-enr-search', 'f-diff-min', 'f-diff-max', 'f-group'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('f-cheapest').selectedIndex = 0;
    applyFilters();
  });

  // Update table headers
  const thA = document.getElementById('th-net-a');
  const thB = document.getElementById('th-net-b');
  const thGrpA = document.getElementById('th-grp-a');
  const thGrpB = document.getElementById('th-grp-b');
  if (thA) thA.textContent = `${supA.name} Netto`;
  if (thB) thB.textContent = `${supB.name} Netto`;
  if (thGrpA) thGrpA.textContent = `${supA.name} Grupp`;
  if (thGrpB) thGrpB.textContent = `${supB.name} Grupp`;

  // Column sorting
  document.querySelectorAll('#article-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) sortAsc = !sortAsc;
      else { sortColumn = col; sortAsc = true; }
      document.querySelectorAll('#article-table th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      applyFilters();
    });
  });
}

function applyFilters() {
  if (!currentResults) return;

  const filters = {
    searchEnr: document.getElementById('f-enr-search')?.value.trim() || '',
    diffMin: document.getElementById('f-diff-min')?.value || '',
    diffMax: document.getElementById('f-diff-max')?.value || '',
    cheapest: document.getElementById('f-cheapest')?.value || '',
    groups: (document.getElementById('f-group')?.value || '').trim()
      ? document.getElementById('f-group').value.split(',').map(g => g.trim()).filter(Boolean)
      : []
  };

  let filtered = filterArticles(currentResults.matched, filters);

  // Sort
  if (sortColumn) {
    const sortFns = {
      enr: (a, b) => a.enr.localeCompare(b.enr),
      netA: (a, b) => a.netA - b.netA,
      netB: (a, b) => a.netB - b.netB,
      diffKr: (a, b) => a.diffKr - b.diffKr,
      diffPct: (a, b) => a.diffPct - b.diffPct,
      grpA: (a, b) => a.grpA.localeCompare(b.grpA),
      grpB: (a, b) => a.grpB.localeCompare(b.grpB),
    };
    const fn = sortFns[sortColumn];
    if (fn) {
      filtered.sort((a, b) => sortAsc ? fn(a, b) : fn(b, a));
    }
  }

  currentFiltered = filtered;

  // Update filter count
  const countEl = document.getElementById('filter-count');
  if (countEl) {
    countEl.textContent = `Visar ${filtered.length.toLocaleString('sv-SE')} av ${currentResults.matched.length.toLocaleString('sv-SE')} artiklar`;
  }

  // Update filtered summary
  renderFilteredSummary(filtered);

  // Render virtual table
  renderVirtualTable(filtered);
}

function renderFilteredSummary(articles) {
  const el = document.getElementById('filtered-summary');
  if (!el) return;

  const stats = computeStats(articles);
  const [idA, idB] = currentResults.supplierIds;
  const supA = SUPPLIERS[idA];
  const supB = SUPPLIERS[idB];

  el.innerHTML = `
    <div class="fs-grid">
      <div class="fs-stat">
        <span class="fs-label">Antal</span>
        <span class="fs-value">${stats.count.toLocaleString('sv-SE')}</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">Snitt diff</span>
        <span class="fs-value ${stats.avgDiffPct > 0 ? 'text-red' : 'text-green'}">${stats.avgDiffPct.toFixed(2)}%</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">Median diff</span>
        <span class="fs-value ${stats.medianDiffPct > 0 ? 'text-red' : 'text-green'}">${stats.medianDiffPct.toFixed(2)}%</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">${supA.name} billigare</span>
        <span class="fs-value" style="color:${supA.color}">${stats.winsA.toLocaleString('sv-SE')}</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">${supB.name} billigare</span>
        <span class="fs-value" style="color:${supB.color}">${stats.winsB.toLocaleString('sv-SE')}</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">Total diff</span>
        <span class="fs-value ${stats.totalDiffKr > 0 ? 'text-red' : 'text-green'}">${formatKr(Math.abs(stats.totalDiffKr))}</span>
      </div>
    </div>
  `;
}

// ── Virtual Scrolling Table ────────────────────────────────────────

const ROW_HEIGHT = 40;
const BUFFER_ROWS = 10;
let virtualData = [];
let scrollContainer = null;
let tableBody = null;
let spacerTop = null;
let spacerBottom = null;

function renderVirtualTable(articles) {
  virtualData = articles;
  scrollContainer = document.getElementById('virtual-scroll-container');
  tableBody = document.getElementById('article-tbody');
  spacerTop = document.getElementById('spacer-top');
  spacerBottom = document.getElementById('spacer-bottom');

  if (!scrollContainer || !tableBody) return;

  // Remove old listener if any and add fresh
  scrollContainer.removeEventListener('scroll', onVirtualScroll);
  scrollContainer.addEventListener('scroll', onVirtualScroll);

  renderVisibleRows();
}

function onVirtualScroll() {
  requestAnimationFrame(renderVisibleRows);
}

function renderVisibleRows() {
  if (!scrollContainer || !virtualData.length) {
    if (tableBody) tableBody.innerHTML = '';
    if (spacerTop) spacerTop.style.height = '0px';
    if (spacerBottom) spacerBottom.style.height = '0px';
    return;
  }

  const scrollTop = scrollContainer.scrollTop;
  const viewHeight = scrollContainer.clientHeight;
  const totalRows = virtualData.length;
  const totalHeight = totalRows * ROW_HEIGHT;

  let startIdx = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS;
  startIdx = Math.max(0, startIdx);
  let endIdx = Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + BUFFER_ROWS;
  endIdx = Math.min(totalRows, endIdx);

  // Spacers
  spacerTop.style.height = (startIdx * ROW_HEIGHT) + 'px';
  spacerBottom.style.height = ((totalRows - endIdx) * ROW_HEIGHT) + 'px';

  // Render rows
  const fragment = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    const a = virtualData[i];
    const tr = document.createElement('tr');
    tr.style.height = ROW_HEIGHT + 'px';
    const cls = a.diffPct > 0.01 ? 'text-red' : (a.diffPct < -0.01 ? 'text-green' : '');
    tr.innerHTML = `
      <td>${a.enr}</td>
      <td>${a.netA.toFixed(2)}</td>
      <td>${a.netB.toFixed(2)}</td>
      <td class="${cls}">${a.diffKr.toFixed(2)}</td>
      <td class="${cls}">${a.diffPct.toFixed(2)}%</td>
      <td>${a.grpA}</td>
      <td>${a.grpB}</td>
      <td>${a.unit}</td>
    `;
    fragment.appendChild(tr);
  }
  tableBody.innerHTML = '';
  tableBody.appendChild(fragment);
}

// ── Helpers ────────────────────────────────────────────────────────

function formatKr(value) {
  return Math.round(value).toLocaleString('sv-SE') + ' kr';
}

function getResults() {
  return currentResults;
}

export { renderDashboard, showScreen, applyFilters, getResults };
