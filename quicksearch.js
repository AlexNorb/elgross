// quicksearch.js — Quick single E-nummer lookup with optional barcode scanning

import { SUPPLIERS } from './suppliers.js';
import { showScreen, getResultsData } from './dashboard.js';

let hasInitialized = false;

// ── Init ──────────────────────────────────────────────────────────

function initQuickSearch() {
    if (hasInitialized) return;
    hasInitialized = true;

    const searchInput = document.getElementById('qs-enr-input');
    const backBtn = document.getElementById('qs-back-btn');

    if (!searchInput) return;

    // Search on Enter key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            doSearch();
            searchInput.blur(); // Close numberpad on mobile
        }
    });

    // Auto-search when 7 digits are entered
    searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim().replace(/\D/g, '');
        if (val.length === 7) {
            searchInput.value = val;
            doSearch();
            searchInput.blur(); // Close numberpad on mobile
        }
    });

    // Back button (goes to main dashboard)
    backBtn.addEventListener('click', () => {
        showScreen('results');
    });
}

// ── Search ────────────────────────────────────────────────────────

function doSearch() {
    const input = document.getElementById('qs-enr-input');
    const enr = input.value.trim().replace(/\D/g, '');
    if (!enr) return;

    const results = getResultsData();
    if (!results || !results.supplierData) {
        renderNoData();
        return;
    }

    const { supplierData, supplierIds } = results;

    // Look up this E-nummer across all suppliers
    const priceRows = [];
    let bestNet = Infinity;
    let bestId = null;

    for (const id of supplierIds) {
        const data = supplierData[id];
        if (!data) continue;
        const article = data.get(enr);
        if (article) {
            priceRows.push({ id, ...article });
            if (article.net > 0 && article.net < bestNet) {
                bestNet = article.net;
                bestId = id;
            }
        }
    }

    renderResult(enr, priceRows, bestId, bestNet, supplierIds);
}

function renderNoData() {
    const container = document.getElementById('qs-results');
    container.innerHTML = `
    <div class="qs-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
      <p>Ingen data laddad — kör en analys först.</p>
      <button class="qs-goto-upload" onclick="document.getElementById('qs-back-btn').click()">← Gå till analys</button>
    </div>
  `;
}

function renderResult(enr, rows, bestId, bestNet, supplierIds) {
    const container = document.getElementById('qs-results');

    if (rows.length === 0) {
        container.innerHTML = `
      <div class="qs-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <p>E-nummer <strong>${enr}</strong> hittades inte hos någon leverantör.</p>
      </div>
    `;
        return;
    }

    let html = `
    <div class="qs-table-wrap">
      <table class="qs-table">
        <thead>
          <tr>
            <th>Leverantör</th>
            <th>Nettopris</th>
            <th>Överpris</th>
          </tr>
        </thead>
        <tbody>
  `;

    // Sort by net price ascending (cheapest first)
    rows.sort((a, b) => (a.net || 0) - (b.net || 0));

    for (const row of rows) {
        const sup = SUPPLIERS[row.id];
        const isBest = row.id === bestId && rows.length > 1;
        const markup = bestNet > 0 && bestNet < Infinity && row.net > 0
            ? ((row.net - bestNet) / bestNet * 100)
            : 0;

        const rowClass = isBest ? 'qs-row-best' : '';
        const markupText = markup > 0.01 ? `+${markup.toFixed(1)}%` : (isBest ? '✓ Billigast' : '—');
        const markupClass = markup > 0.01 ? 'text-red' : (isBest ? 'text-green' : 'text-muted');

        html += `
      <tr class="${rowClass}">
        <td>
          <span class="qs-sup-badge" style="background:${sup.color}">${sup.icon}</span>
          ${sup.name}
        </td>
        <td class="${isBest ? 'qs-net-best' : ''}">${row.net ? row.net.toFixed(2) + ' kr' : '—'}</td>
        <td class="${markupClass}">${markupText}</td>
      </tr>
    `;
    }

    html += '</tbody></table></div>';

    // Price difference summary
    if (rows.length > 1 && bestNet < Infinity) {
        const worstNet = Math.max(...rows.map(r => r.net || 0));
        const diffKr = worstNet - bestNet;
        const diffPct = bestNet > 0 ? ((worstNet - bestNet) / bestNet * 100) : 0;
        html += `
      <div class="qs-diff-summary">
        <span>Prisskillnad: <strong>${diffKr.toFixed(2)} kr</strong> (${diffPct.toFixed(1)}%)</span>
      </div>
    `;
    }

    // Add to basket button
    html += `
      <div class="qs-basket-action">
        <button class="qs-add-basket-btn" id="qs-add-to-basket">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
          Lägg i varukorg
        </button>
      </div>
    `;

    container.innerHTML = html;

    // Wire up basket button
    const addBtn = document.getElementById('qs-add-to-basket');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const { addToBasket, updateBadge } = await import('./basket.js');
            addToBasket(enr, 1);
            updateBadge();
            addBtn.textContent = '✓ Tillagd!';
            addBtn.disabled = true;
            setTimeout(() => {
                addBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                    Lägg i varukorg
                `;
                addBtn.disabled = false;
            }, 1500);
        });
    }
}

// ── Public show function ──────────────────────────────────────────

function showQuickSearch(prefillEnr) {
    showScreen('quicksearch');
    initQuickSearch();
    if (prefillEnr) {
        document.getElementById('qs-enr-input').value = prefillEnr;
        doSearch();
    } else {
        document.getElementById('qs-enr-input').focus();
    }
}

export { showQuickSearch, initQuickSearch };
