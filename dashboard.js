// dashboard.js — Results dashboard rendering with virtual scrolling

import { SUPPLIERS } from './suppliers.js';
import { filterArticles, computeStats } from './engine.js';

let currentResults = null;
let currentFiltered = null;
let sortColumn = null;
let sortAsc = true;
let referensEnr = null; // Set of reference E-nummers
let refFilterMode = null; // null | 'direct' | 'groups'
let refGroupsList = []; // groups derived from ref articles
let minArticlesPerGroup = 0; // minimum articles per group threshold
let favEnrSet = null;       // Set of favourite E-nummers (validated)
let favFilterMode = null;   // null | 'direct' | 'groups'
let favGroupsList = [];     // groups derived from fav E-nummers

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

  // Group Analysis & Top Opportunities — removed, info merged into Förhandlingsunderlag
  // renderGroupAnalysis(results, supA, supB, idA, idB);
  // renderTopOpportunities(results, supA, supB, idA, idB);

  // Negotiation Recommendations (initial render uses engine.js recs)
  renderNegotiation(results.recommendations, supA, supB, idA, idB);

  // Load referensmall
  loadReferensMall();

  // Article Table (initial: all matched)
  setupFilters(results, idA, idB);
  applyAllSections();

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
  const winner = stats.winsA >= stats.winsB ? supA : supB;



  // Winner badge
  const winnerEl = document.getElementById('hero-winner');
  winnerEl.textContent = winner.name;
  winnerEl.style.background = winner.color;

  // Win percentage
  const totalCompared = stats.winsA + stats.winsB + stats.equal;
  const winnerPct = stats.winsA >= stats.winsB
    ? ((stats.winsA / totalCompared) * 100).toFixed(0)
    : ((stats.winsB / totalCompared) * 100).toFixed(0);
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
      <div class="stat-value">${stats.avgMaxMarkup.toFixed(1)}%</div>
      <div class="stat-label">Snitt markup</div>
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
    <span class="excl-tag">Markup &gt; 999%: ${excluded.highMarkup}</span>
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
      .reduce((sum, a) => sum + Math.abs(a.netA - a.netB), 0);

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

function renderGroupAnalysis(dynamicGroups, supA, supB, idA, idB) {
  const container = document.getElementById('group-cards');
  container.innerHTML = '';

  // Sort controls
  const sortBar = document.getElementById('group-sort');
  if (sortBar && !sortBar.dataset.setup) {
    sortBar.dataset.setup = 'true';
    sortBar.innerHTML = `
      <button class="sort-btn active" data-sort="score">Impact score</button>
      <button class="sort-btn" data-sort="count">Flest artiklar</button>
      <button class="sort-btn" data-sort="pct">Högst % skillnad</button>
    `;
    sortBar.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortBar.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Hacky way to re-render but maintain global state... ideally we'd store dynamicGroups glboally
        // But for now, we just fetch active sort and let applyFilters handle it.
        applyAllSections();
      });
    });
  }

  const activeSort = document.querySelector('#group-sort .sort-btn.active')?.dataset.sort || 'score';
  renderGroupCards(dynamicGroups, supA, supB, idA, idB, activeSort);
}

function renderGroupCards(dynamicGroups, supA, supB, idA, idB, sortBy) {
  const container = document.getElementById('group-cards');
  if (!container) return;
  container.innerHTML = '';

  // Merge groups from both suppliers
  const allGroups = new Map();
  for (const [grp, data] of Object.entries(dynamicGroups[idA] || {})) {
    allGroups.set(grp, { ...data, supplier: supA, supplierId: idA });
  }

  let entries = [...allGroups.entries()];

  // Filter by min articles
  if (minArticlesPerGroup > 0) {
    entries = entries.filter(([, d]) => d.count >= minArticlesPerGroup);
  }

  // Sort
  if (sortBy === 'score') {
    // Impact score: count × avgMarkup — balances volume and magnitude
    entries.sort((a, b) => (b[1].count * b[1].avgMarkup) - (a[1].count * a[1].avgMarkup));
  } else if (sortBy === 'count') {
    entries.sort((a, b) => b[1].count - a[1].count);
  } else if (sortBy === 'pct') {
    entries.sort((a, b) => b[1].avgMarkup - a[1].avgMarkup);
  }

  // Show top 20
  entries.slice(0, 20).forEach(([grp, data]) => {
    // Determine which supplier wins more often in this group
    let wA = 0, wB = 0;
    data.articles.forEach(a => { if (a.cheapest === idA) wA++; else if (a.cheapest === idB) wB++; });
    const winner = wA >= wB ? supA : supB;
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
          <span class="gstat-value">${data.avgMarkup.toFixed(1)}%</span>
          <span class="gstat-label">snitt markup</span>
        </div>
        <div class="group-stat">
          <span class="gstat-value">${formatKr(data.sumSavingsKr)}</span>
          <span class="gstat-label">besparing</span>
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

function renderTopOpportunities(dynamicGroups, supA, supB, idA, idB) {
  const container = document.getElementById('opportunities-list');
  if (!container) return;
  container.innerHTML = '';

  // Top 10 groups by total savings, filtered by min articles
  const groupsA = Object.entries(dynamicGroups[idA] || {})
    .filter(([, d]) => d.count >= minArticlesPerGroup)
    .sort((a, b) => b[1].sumSavingsKr - a[1].sumSavingsKr)
    .slice(0, 10);

  const groupsB = Object.entries(dynamicGroups[idB] || {})
    .filter(([, d]) => d.count >= minArticlesPerGroup)
    .sort((a, b) => b[1].sumSavingsKr - a[1].sumSavingsKr)
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
      <span class="opp-diff">${data.avgMarkup.toFixed(1)}%</span>
      <span class="opp-kr">${formatKr(data.sumSavingsKr)}</span>
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

function renderNegotiation(dynamicRecommendations, supA, supB, idA, idB) {
  const container = document.getElementById('negotiation-content');
  if (!container) return;
  container.innerHTML = '';

  // We want to skip minArticlesPerGroup if there's an active specific filter.
  const isTargetedSearch = (document.getElementById('f-enr-search')?.value.trim() !== '') ||
    (document.getElementById('f-group')?.value.trim() !== '') ||
    (favFilterMode !== null) ||
    (refFilterMode !== null);

  [{ sup: supA, id: idA, recs: dynamicRecommendations[idA], comp: supB },
  { sup: supB, id: idB, recs: dynamicRecommendations[idB], comp: supA }].forEach(({ sup, recs, comp }) => {
    if (!recs || recs.length === 0) return;

    // Bypass articles count threshold if user has directly filtered out items
    let filteredRecs = isTargetedSearch ? recs : recs.filter(rec => rec.articleCount >= minArticlesPerGroup);
    if (filteredRecs.length === 0) return;

    // Add computed fields for display/sorting
    filteredRecs = filteredRecs.map(r => ({
      ...r,
      diffPct: r.targetDiscount - r.currentDiscount,
      // Påverkan = artiklar × snitt markup × total kr (normalized)
      impactScore: r.articleCount * (r.avgMarkup || 0) * r.totalImpactKr / 1000
    }));

    // Track sort state per section
    let negSortCol = 'impactScore';
    let negSortAsc = false; // default: highest impact first

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

    function renderNegRows() {
      // Sort
      const sorted = [...filteredRecs].sort((a, b) => {
        let va = a[negSortCol], vb = b[negSortCol];
        if (typeof va === 'string') return negSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        return negSortAsc ? va - vb : vb - va;
      });

      table.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'neg-header';
      const cols = [
        { key: 'group', label: 'Grupp' },
        { key: 'articleCount', label: 'Artiklar (dyrare)' },
        { key: 'avgMarkup', label: 'Snitt markup' },
        { key: 'currentDiscount', label: 'Nuv. rabatt' },
        { key: 'targetDiscount', label: 'Mål' },
        { key: 'diffPct', label: 'Diff %' },
        { key: 'impactScore', label: 'Påverkan' }
      ];
      cols.forEach(({ key, label }) => {
        const span = document.createElement('span');
        span.textContent = label;
        span.style.cursor = 'pointer';
        span.style.userSelect = 'none';
        if (negSortCol === key) {
          span.textContent += negSortAsc ? ' ▲' : ' ▼';
          span.style.fontWeight = '700';
        }
        span.addEventListener('click', () => {
          if (negSortCol === key) { negSortAsc = !negSortAsc; }
          else { negSortCol = key; negSortAsc = true; }
          renderNegRows();
        });
        header.appendChild(span);
      });
      table.appendChild(header);

      // Rows (all, scrollable container handles visibility)
      sorted.forEach(rec => {
        const row = document.createElement('div');
        row.className = 'neg-row';
        row.innerHTML = `
          <span class="neg-group">${rec.group}</span>
          <span>${rec.articleCount} <small style="color:var(--text-muted)">(${rec.losingCount || rec.articleCount})</small></span>
          <span>${(rec.avgMarkup || 0).toFixed(1)}%</span>
          <span>${rec.currentDiscount.toFixed(1)}%</span>
          <span class="text-green">${rec.targetDiscount.toFixed(1)}%</span>
          <span style="font-weight:600; color:var(--accent)">${rec.diffPct.toFixed(1)}%</span>
          <span style="font-weight:600; color:var(--text-secondary)">${rec.impactScore.toFixed(0)}</span>
        `;
        table.appendChild(row);
      });
    }

    renderNegRows();

    // Make table scrollable showing ~10 rows
    table.style.maxHeight = '400px';
    table.style.overflowY = 'auto';

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
  document.getElementById('btn-apply-filters').addEventListener('click', () => {
    refFilterMode = null;
    updateRefButtonStyles();
    applyAllSections();
  });

  // Enter key
  document.querySelectorAll('#filter-bar input, #filter-bar select').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { refFilterMode = null; updateRefButtonStyles(); applyAllSections(); } });
  });

  // Reset
  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    ['f-enr-search', 'f-diff-min', 'f-diff-max', 'f-price-min', 'f-price-max', 'f-group', 'f-lookup-enr', 'f-min-articles'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('f-cheapest').selectedIndex = 0;
    refFilterMode = null;
    updateRefButtonStyles();
    favFilterMode = null;
    favEnrSet = null;
    favGroupsList = [];
    updateFavButtonStyles();
    const favTa = document.getElementById('fav-enr-input');
    if (favTa) favTa.value = '';
    const favCount = document.getElementById('fav-count');
    if (favCount) favCount.textContent = '';
    uncheckAllCategories();
    applyAllSections();
  });

  // E-nummer → Rabattgrupp lookup
  const lookupBtn = document.getElementById('btn-lookup-enr');
  const lookupInput = document.getElementById('f-lookup-enr');
  if (lookupBtn) lookupBtn.addEventListener('click', lookupEnrGroups);
  if (lookupInput) lookupInput.addEventListener('keydown', e => { if (e.key === 'Enter') lookupEnrGroups(); });

  // Referensmall preset buttons
  const refDirectBtn = document.getElementById('btn-ref-direct');
  const refGroupsBtn = document.getElementById('btn-ref-groups');
  if (refDirectBtn) refDirectBtn.addEventListener('click', applyRefDirect);
  if (refGroupsBtn) refGroupsBtn.addEventListener('click', applyRefGroups);

  // Favoritlista
  const favFileInput = document.getElementById('fav-file-input');
  if (favFileInput) favFileInput.addEventListener('change', loadFavFile);
  const favClearBtn = document.getElementById('btn-fav-clear');
  if (favClearBtn) favClearBtn.addEventListener('click', clearFavList);
  const favDirectBtn = document.getElementById('btn-fav-direct');
  if (favDirectBtn) favDirectBtn.addEventListener('click', applyFavDirect);
  const favGroupsBtn = document.getElementById('btn-fav-groups');
  if (favGroupsBtn) favGroupsBtn.addEventListener('click', applyFavGroups);

  // Build category checkboxes
  buildCategoryCheckboxes();

  // Update table headers
  const thA = document.getElementById('th-net-a');
  const thB = document.getElementById('th-net-b');
  const thMarkupA = document.getElementById('th-markup-a');
  const thMarkupB = document.getElementById('th-markup-b');
  const thGrpA = document.getElementById('th-grp-a');
  const thGrpB = document.getElementById('th-grp-b');
  if (thA) thA.textContent = `${supA.name} Netto`;
  if (thB) thB.textContent = `${supB.name} Netto`;
  if (thMarkupA) thMarkupA.textContent = `${supA.name} %`;
  if (thMarkupB) thMarkupB.textContent = `${supB.name} %`;
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

/**
 * Re-render all group-dependent sections + article table.
 * Instead of duplicating logic, applying filters triggers generating the dynamic groups
 * and rendering all sections.
 */
function applyAllSections() {
  applyFilters();
}

function applyFilters() {
  if (!currentResults) return;

  const filters = {
    searchEnr: document.getElementById('f-enr-search')?.value.trim() || '',
    markupMin: document.getElementById('f-diff-min')?.value || '',
    markupMax: document.getElementById('f-diff-max')?.value || '',
    cheapest: document.getElementById('f-cheapest')?.value || '',
    groups: (document.getElementById('f-group')?.value || '').trim()
      ? document.getElementById('f-group').value.split(',').map(g => g.trim()).filter(Boolean)
      : [],
    categories: getCheckedCategories(),
    priceMin: document.getElementById('f-price-min')?.value || '',
    priceMax: document.getElementById('f-price-max')?.value || ''
  };

  // Start from matched or ref-filtered set
  let source = currentResults.matched;
  if (refFilterMode === 'direct' && referensEnr) {
    source = source.filter(a => referensEnr.has(a.enr));
  } else if (refFilterMode === 'groups' && refGroupsList.length > 0) {
    const grpSet = new Set(refGroupsList.map(g => g.toUpperCase()));
    source = source.filter(a => grpSet.has(a.grpA.toUpperCase()) || grpSet.has(a.grpB.toUpperCase()));
  }

  // Favoritlista filter
  if (favFilterMode === 'direct' && favEnrSet && favEnrSet.size > 0) {
    source = source.filter(a => favEnrSet.has(a.enr));
  } else if (favFilterMode === 'groups' && favGroupsList.length > 0) {
    const grpSet = new Set(favGroupsList.map(g => g.toUpperCase()));
    source = source.filter(a => grpSet.has(a.grpA.toUpperCase()) || grpSet.has(a.grpB.toUpperCase()));
  }

  // Filter out articles from groups below min-articles threshold
  if (minArticlesPerGroup > 0) {
    const grpCounts = {};
    source.forEach(a => {
      grpCounts[a.grpA] = (grpCounts[a.grpA] || 0) + 1;
    });
    source = source.filter(a => (grpCounts[a.grpA] || 0) >= minArticlesPerGroup);
  }

  let filtered = filterArticles(source, filters);

  // Sort
  if (sortColumn) {
    const sortFns = {
      enr: (a, b) => a.enr.localeCompare(b.enr),
      netA: (a, b) => a.netA - b.netA,
      netB: (a, b) => a.netB - b.netB,
      bestNet: (a, b) => a.bestNet - b.bestNet,
      markupA: (a, b) => a.markupA - b.markupA,
      markupB: (a, b) => a.markupB - b.markupB,
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
    let label = `Visar ${filtered.length.toLocaleString('sv-SE')} av ${currentResults.matched.length.toLocaleString('sv-SE')} artiklar`;
    if (refFilterMode === 'direct') label += ' (Referensmall: artiklar)';
    else if (refFilterMode === 'groups') label += ` (Referensmall: ${refGroupsList.length} grupper)`;
    countEl.textContent = label;
  }

  // Update filtered summary
  renderFilteredSummary(filtered);

  // Render virtual table
  renderVirtualTable(filtered);

  // Re-calculate aggregations based purely on the filtered list
  const [idA, idB] = currentResults.supplierIds;
  const { dynamicGroups, dynamicRecommendations } = recalculateDynamicGroups(filtered, idA, idB);

  // Read min-articles threshold
  const minVal = parseInt(document.getElementById('f-min-articles')?.value, 10);
  minArticlesPerGroup = isNaN(minVal) || minVal < 0 ? 0 : minVal;

  const supA = SUPPLIERS[idA];
  const supB = SUPPLIERS[idB];

  // renderGroupCards and renderTopOpportunities removed — info merged into negotiation table
  renderNegotiation(dynamicRecommendations, supA, supB, idA, idB);
}

function recalculateDynamicGroups(articles, idA, idB) {
  const groupsA = {};
  const groupsB = {};

  // Group items
  articles.forEach(a => {
    // A groups
    if (!groupsA[a.grpA]) {
      groupsA[a.grpA] = { count: 0, articles: [], sumSavingsKr: 0, sumMarkupPct: 0, avgMarkup: 0, totalCurrentPrice: 0 };
    }
    groupsA[a.grpA].count++;
    groupsA[a.grpA].articles.push(a);
    // Accumulate savings: how much cheaper is B than A in this group
    if (a.netA > 0 && a.netB > 0 && a.netA > a.netB) {
      groupsA[a.grpA].sumSavingsKr += (a.netA - a.netB);
    }
    if (a.netA > 0 && a.netB > 0) {
      groupsA[a.grpA].sumMarkupPct += (Math.max(a.netA, a.netB) / Math.min(a.netA, a.netB) - 1) * 100;
    }

    // B groups
    if (!groupsB[a.grpB]) {
      groupsB[a.grpB] = { count: 0, articles: [], sumSavingsKr: 0, sumMarkupPct: 0, avgMarkup: 0, totalCurrentPrice: 0 };
    }
    groupsB[a.grpB].count++;
    groupsB[a.grpB].articles.push(a);
    // Accumulate savings: how much cheaper is A than B in this group
    if (a.netA > 0 && a.netB > 0 && a.netB > a.netA) {
      groupsB[a.grpB].sumSavingsKr += (a.netB - a.netA);
    }
    if (a.netA > 0 && a.netB > 0) {
      groupsB[a.grpB].sumMarkupPct += (Math.max(a.netA, a.netB) / Math.min(a.netA, a.netB) - 1) * 100;
    }
  });

  // Average them out
  for (const g in groupsA) {
    groupsA[g].avgMarkup = groupsA[g].sumMarkupPct / groupsA[g].count;
  }
  for (const g in groupsB) {
    groupsB[g].avgMarkup = groupsB[g].sumMarkupPct / groupsB[g].count;
  }

  const dynamicGroups = { [idA]: groupsA, [idB]: groupsB };

  // Debug: check a sample group
  const sampleKeyA = Object.keys(groupsA)[0];
  if (sampleKeyA) {
    const sg = groupsA[sampleKeyA];
    console.log('[DEBUG recalc] sampleGroupA:', sampleKeyA, 'count:', sg.count, 'sumSavingsKr:', sg.sumSavingsKr);
    if (sg.articles[0]) {
      const a = sg.articles[0];
      console.log('[DEBUG recalc] sample article: markupA=', a.markupA, 'markupB=', a.markupB, 'netA=', a.netA, 'netB=', a.netB, 'cheapest=', a.cheapest, 'diffKr=', a.diffKr);
    }
  }

  // Calculate generic recommendations based on new data
  const recsA = buildDynamicRecs(groupsA, idA, idB);
  const recsB = buildDynamicRecs(groupsB, idB, idA);
  console.log('[DEBUG recalc] recsA length:', recsA.length, 'recsB length:', recsB.length);
  const dynamicRecommendations = { [idA]: recsA, [idB]: recsB };

  return { dynamicGroups, dynamicRecommendations };
}

function buildDynamicRecs(groups, supplierId, competitorId) {
  const recs = [];
  const isA = supplierId === currentResults.supplierIds[0];

  for (const [grp, data] of Object.entries(groups)) {
    const totalArticles = data.articles.length;
    if (totalArticles === 0) continue;

    let losingCount = 0;       // articles where we're more expensive
    let totalMyNet = 0;        // sum of our net prices (all articles)
    let totalBestNet = 0;      // sum of best net price per article
    let totalMyList = 0;       // sum of our list prices (if available)
    let sumMyDisc = 0;         // sum of our discounts (all articles)
    let sumLosingMarkup = 0;   // sum of markup on losing articles only
    let hasListPrices = true;

    data.articles.forEach(a => {
      const myMarkup = isA ? a.markupA : a.markupB;
      const myDisc = isA ? a.discA : a.discB;
      const meNet = isA ? a.netA : a.netB;
      const meList = isA ? a.listA : a.listB;
      const compNet = isA ? a.netB : a.netA;

      if (meNet <= 0 || compNet <= 0) return;

      totalMyNet += meNet;
      totalBestNet += Math.min(meNet, compNet);
      sumMyDisc += (myDisc || 0);

      if (meList > 0) {
        totalMyList += meList;
      } else {
        hasListPrices = false;
      }

      if (myMarkup > 0.01 && meNet > compNet) {
        losingCount++;
        sumLosingMarkup += myMarkup;
      }
    });

    // Only show groups where there's actual savings potential
    const totalSavingsKr = totalMyNet - totalBestNet;
    if (totalSavingsKr <= 0 || losingCount === 0) continue;

    const avgCurrentDisc = sumMyDisc / totalArticles;
    const avgLosingMarkup = sumLosingMarkup / losingCount;

    // Calculate target discount from the whole group
    let targetDiscount;
    if (hasListPrices && totalMyList > 0) {
      // Best case: use actual list prices
      targetDiscount = (1 - totalBestNet / totalMyList) * 100;
    } else if (avgCurrentDisc > 0 && avgCurrentDisc < 100) {
      // Derive implied list from current discount
      const impliedTotalList = totalMyNet / (1 - avgCurrentDisc / 100);
      targetDiscount = (1 - totalBestNet / impliedTotalList) * 100;
    } else {
      // Fallback: current discount + needed reduction as % of net
      targetDiscount = avgCurrentDisc + (totalSavingsKr / totalMyNet * 100);
    }

    targetDiscount = Math.max(0, Math.min(targetDiscount, 99.9));

    recs.push({
      group: grp,
      articleCount: totalArticles,
      losingCount: losingCount,
      avgMarkup: avgLosingMarkup,
      currentDiscount: avgCurrentDisc,
      targetDiscount: targetDiscount,
      totalImpactKr: totalSavingsKr
    });
  }

  return recs.sort((a, b) => b.totalImpactKr - a.totalImpactKr);
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
        <span class="fs-label">Snitt markup</span>
        <span class="fs-value">${stats.avgMaxMarkup.toFixed(1)}%</span>
      </div>
      <div class="fs-stat">
        <span class="fs-label">Median markup</span>
        <span class="fs-value">${stats.medianMaxMarkup.toFixed(1)}%</span>
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
        <span class="fs-label">Total besparing</span>
        <span class="fs-value">${formatKr(stats.totalSavingsKr)}</span>
      </div>
    </div>
  `;
}

const MAX_TABLE_ROWS = 500;
let virtualData = [];
let tableBody = null;

function renderVirtualTable(articles) {
  virtualData = articles;
  tableBody = document.getElementById('article-tbody');
  const scrollContainer = document.getElementById('virtual-scroll-container');

  if (!tableBody) return;

  // Cap to MAX_TABLE_ROWS for performance
  const capped = articles.slice(0, MAX_TABLE_ROWS);

  // Set up scrollable container
  if (scrollContainer) {
    scrollContainer.style.maxHeight = '600px';
    scrollContainer.style.overflowY = 'auto';
  }

  // Remove spacers if they exist (no longer needed)
  const spacerTop = document.getElementById('spacer-top');
  const spacerBottom = document.getElementById('spacer-bottom');
  if (spacerTop) spacerTop.style.height = '0px';
  if (spacerBottom) spacerBottom.style.height = '0px';

  // Render rows
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < capped.length; i++) {
    const a = capped[i];
    const tr = document.createElement('tr');
    const clsA = a.markupA > 0.01 ? 'text-red' : 'text-green';
    const clsB = a.markupB > 0.01 ? 'text-red' : 'text-green';
    tr.innerHTML = `
      <td>${a.enr}</td>
      <td>${a.netA.toFixed(2)}</td>
      <td>${a.netB.toFixed(2)}</td>
      <td>${a.bestNet.toFixed(2)}</td>
      <td class="${clsA}">${a.markupA < 0.01 ? '0%' : '+' + a.markupA.toFixed(1) + '%'}</td>
      <td class="${clsB}">${a.markupB < 0.01 ? '0%' : '+' + a.markupB.toFixed(1) + '%'}</td>
      <td>${a.grpA}</td>
      <td>${a.grpB}</td>
      <td>${a.unit}</td>
    `;
    fragment.appendChild(tr);
  }
  tableBody.innerHTML = '';
  tableBody.appendChild(fragment);

  // Show a note if capped
  if (articles.length > MAX_TABLE_ROWS) {
    const note = document.createElement('tr');
    note.innerHTML = `<td colspan="9" style="text-align:center; color:var(--text-secondary); padding:0.75rem;">Visar ${MAX_TABLE_ROWS} av ${articles.length.toLocaleString('sv-SE')} artiklar. Filtrera för att se fler.</td>`;
    tableBody.appendChild(note);
  }
}

// ── Category Checkboxes ───────────────────────────────────────────

function buildCategoryCheckboxes() {
  const container = document.getElementById('cat-checkboxes');
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
    l1Cb.className = 'cat-l1-cb';
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
      l2Cb.className = 'cat-l2-cb';
      l2Cb.value = prefix;
      l2Cb.addEventListener('change', () => {
        const siblings = childrenDiv.querySelectorAll('.cat-l2-cb');
        const allChecked = [...siblings].every(s => s.checked);
        const someChecked = [...siblings].some(s => s.checked);
        l1Cb.checked = allChecked;
        l1Cb.indeterminate = someChecked && !allChecked;
      });
      l2Label.appendChild(l2Cb);
      l2Label.appendChild(document.createTextNode(` ${prefix}`));
      childrenDiv.appendChild(l2Label);
    }

    // L1 click toggles all children
    l1Cb.addEventListener('change', () => {
      const children = childrenDiv.querySelectorAll('.cat-l2-cb');
      children.forEach(cb => cb.checked = l1Cb.checked);
      l1Cb.indeterminate = false;
    });

    group.appendChild(childrenDiv);
    container.appendChild(group);
  }
}

function getCheckedCategories() {
  const checked = document.querySelectorAll('.cat-l2-cb:checked');
  if (!checked.length) return [];
  return [...checked].map(cb => cb.value);
}

function uncheckAllCategories() {
  document.querySelectorAll('.cat-l1-cb, .cat-l2-cb').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
}

// ── E-nummer → Rabattgrupp Lookup ────────────────────────────────

function lookupEnrGroups() {
  if (!currentResults) return;
  const enr = (document.getElementById('f-lookup-enr')?.value || '').trim();
  if (!enr) return;

  const { supplierData, supplierIds } = currentResults;
  const groups = new Set();

  for (const id of supplierIds) {
    const data = supplierData[id];
    if (data && data.has(enr)) {
      groups.add(data.get(enr).grp);
    }
  }

  if (groups.size === 0) {
    alert(`E-nummer ${enr} hittades inte i någon leverantörs prislista.`);
    return;
  }

  document.getElementById('f-group').value = [...groups].join(', ');
  refFilterMode = null;
  updateRefButtonStyles();
  applyFilters();
}

// ── Referensmall ─────────────────────────────────────────────────

async function loadReferensMall() {
  try {
    const resp = await fetch('./referens_enummer.json');
    if (!resp.ok) return;
    const arr = await resp.json();
    referensEnr = new Set(arr.map(e => String(e).trim()));
  } catch (e) {
    console.warn('Could not load referens_enummer.json:', e);
  }
}

function applyRefDirect() {
  if (!referensEnr) { alert('Referensmall har inte laddats.'); return; }
  refFilterMode = refFilterMode === 'direct' ? null : 'direct'; // toggle
  updateRefButtonStyles();
  applyFilters();
}

function applyRefGroups() {
  if (!referensEnr || !currentResults) { alert('Referensmall har inte laddats.'); return; }

  if (refFilterMode === 'groups') {
    refFilterMode = null;
    refGroupsList = [];
    updateRefButtonStyles();
    applyFilters();
    return;
  }

  // Collect groups from reference E-nummers
  const { supplierData, supplierIds } = currentResults;
  const groups = new Set();
  for (const enr of referensEnr) {
    for (const id of supplierIds) {
      const d = supplierData[id];
      if (d && d.has(enr)) groups.add(d.get(enr).grp);
    }
  }
  refGroupsList = [...groups];
  refFilterMode = 'groups';
  updateRefButtonStyles();
  applyFilters();
}

function updateRefButtonStyles() {
  const directBtn = document.getElementById('btn-ref-direct');
  const groupsBtn = document.getElementById('btn-ref-groups');
  if (directBtn) directBtn.classList.toggle('active', refFilterMode === 'direct');
  if (groupsBtn) groupsBtn.classList.toggle('active', refFilterMode === 'groups');
}

// ── Favoritlista ──────────────────────────────────────────────────

const ENR_REGEX = /^\d{7}$/;

/**
 * Parse textarea content into favEnrSet.
 * Only keeps values that are exactly 7 digits AND exist in matched articles.
 */
function parseFavInput() {
  const ta = document.getElementById('fav-enr-input');
  const countEl = document.getElementById('fav-count');
  // UI for unmatched
  const umDetails = document.getElementById('fav-unmatched-details');
  const umSummary = document.getElementById('fav-unmatched-summary');
  const umList = document.getElementById('fav-unmatched-list');

  if (!ta) return;

  const raw = ta.value;
  if (!raw.trim()) {
    favEnrSet = null;
    if (countEl) countEl.textContent = '';
    if (umDetails) umDetails.style.display = 'none';
    if (umList) umList.textContent = '';
    return;
  }

  // Split on newline, comma, semicolon, tab — extract all 7-digit tokens
  const tokens = raw.split(/[\n\r,;\t]+/).map(s => s.trim()).filter(Boolean);
  const valid = tokens.filter(t => ENR_REGEX.test(t));
  const uniqueValid = [...new Set(valid)];

  // Intersect with matched articles for efficiency
  let matchedEnrs = null;
  if (currentResults) {
    matchedEnrs = new Set(currentResults.matched.map(a => a.enr));
    favEnrSet = new Set(uniqueValid.filter(e => matchedEnrs.has(e)));
  } else {
    // If no results loaded yet, accept all as potentially valid
    favEnrSet = new Set(uniqueValid);
  }

  const skipped = tokens.length - valid.length;
  // Unmatched are valid 7-digit numbers that are NOT in the matched set
  const unmatched = uniqueValid.filter(e => !favEnrSet.has(e));

  let label = `${favEnrSet.size} E-nummer laddade`;
  if (skipped > 0) label += `, ${skipped} ogiltiga (ej 7 siffror)`;
  if (unmatched.length > 0) label += `, ${unmatched.length} utan match i aktuell prislista`;

  if (countEl) countEl.textContent = label;

  // Render unmatched list
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

function loadFavFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const ta = document.getElementById('fav-enr-input');
    if (ta) ta.value = e.target.result;
    parseFavInput();
  };
  reader.readAsText(file);
  // Reset so the same file can be re-loaded
  event.target.value = '';
}

function clearFavList() {
  const ta = document.getElementById('fav-enr-input');
  if (ta) ta.value = '';
  favEnrSet = null;
  favFilterMode = null;
  favGroupsList = [];
  const countEl = document.getElementById('fav-count');
  if (countEl) countEl.textContent = '';

  const umDetails = document.getElementById('fav-unmatched-details');
  if (umDetails) umDetails.style.display = 'none';
  const umList = document.getElementById('fav-unmatched-list');
  if (umList) umList.textContent = '';

  updateFavButtonStyles();
  applyAllSections();
}

function applyFavDirect() {
  // Parse input first
  parseFavInput();
  if (!favEnrSet || favEnrSet.size === 0) {
    alert('Inga giltiga E-nummer i favoritlistan.');
    return;
  }

  // Toggle
  if (favFilterMode === 'direct') {
    favFilterMode = null;
  } else {
    favFilterMode = 'direct';
    // Mutual exclusion: deactivate ref-filter
    refFilterMode = null;
    updateRefButtonStyles();
  }
  updateFavButtonStyles();
  applyAllSections();
}

function applyFavGroups() {
  parseFavInput();
  if (!favEnrSet || favEnrSet.size === 0 || !currentResults) {
    alert('Inga giltiga E-nummer i favoritlistan.');
    return;
  }

  if (favFilterMode === 'groups') {
    favFilterMode = null;
    favGroupsList = [];
    updateFavButtonStyles();
    applyAllSections();
    return;
  }

  // Collect groups from fav E-nummers via supplierData
  const { supplierData, supplierIds } = currentResults;
  const groups = new Set();
  for (const enr of favEnrSet) {
    for (const id of supplierIds) {
      const d = supplierData[id];
      if (d && d.has(enr)) groups.add(d.get(enr).grp);
    }
  }
  favGroupsList = [...groups];
  favFilterMode = 'groups';

  // Mutual exclusion: deactivate ref-filter
  refFilterMode = null;
  updateRefButtonStyles();

  updateFavButtonStyles();
  applyAllSections();
}

function updateFavButtonStyles() {
  const directBtn = document.getElementById('btn-fav-direct');
  const groupsBtn = document.getElementById('btn-fav-groups');
  if (directBtn) directBtn.classList.toggle('active', favFilterMode === 'direct');
  if (groupsBtn) {
    groupsBtn.classList.toggle('active', favFilterMode === 'groups');
    groupsBtn.textContent = favFilterMode === 'groups' && favGroupsList.length > 0
      ? `Fav: Grupper (${favGroupsList.length} st)`
      : 'Fav: Grupper';
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function formatKr(value) {
  return Math.round(value).toLocaleString('sv-SE') + ' kr';
}

function getResults() {
  return currentResults;
}

export { renderDashboard, showScreen, applyFilters, getResults };
