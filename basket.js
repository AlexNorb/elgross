// basket.js — Shopping basket with localStorage persistence

import { SUPPLIERS } from './suppliers.js';
import { showScreen, getResultsData } from './dashboard.js';

const LS_BASKET_KEY = 'prisjamfor_basket';

// basket state: Map of enr → { qty }
let basketItems = new Map();
let hasInitialized = false;

// ── LocalStorage ──────────────────────────────────────────────────

function saveBasket() {
    try {
        const arr = [];
        for (const [enr, item] of basketItems) {
            arr.push({ enr, qty: item.qty });
        }
        localStorage.setItem(LS_BASKET_KEY, JSON.stringify(arr));
    } catch (e) {
        console.warn('Could not save basket:', e.message);
    }
}

function loadBasket() {
    try {
        const raw = localStorage.getItem(LS_BASKET_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        basketItems = new Map();
        for (const item of arr) {
            if (item.enr && item.qty > 0) {
                basketItems.set(item.enr, { qty: item.qty });
            }
        }
    } catch (e) {
        console.warn('Could not load basket:', e.message);
    }
}

// ── Public API ────────────────────────────────────────────────────

function addToBasket(enr, qty = 1) {
    if (!enr) return;
    enr = String(enr).trim();
    const existing = basketItems.get(enr);
    if (existing) {
        existing.qty += qty;
    } else {
        basketItems.set(enr, { qty });
    }
    saveBasket();
    updateBadge();
}

function removeFromBasket(enr) {
    basketItems.delete(enr);
    saveBasket();
    updateBadge();
}

function clearBasket() {
    basketItems.clear();
    saveBasket();
    updateBadge();
}

function getBasketCount() {
    let total = 0;
    for (const item of basketItems.values()) total += item.qty;
    return total;
}

function updateBadge() {
    const badges = document.querySelectorAll('.basket-badge');
    const count = basketItems.size;
    badges.forEach(b => {
        b.textContent = count;
        b.style.display = count > 0 ? 'inline-flex' : 'none';
    });
}

// ── Init ──────────────────────────────────────────────────────────

function initBasket() {
    if (hasInitialized) return;
    hasInitialized = true;

    const backBtn = document.getElementById('bk-back-btn');
    const clearBtn = document.getElementById('bk-clear-btn');
    const addInput = document.getElementById('bk-add-enr');
    const addQtyInput = document.getElementById('bk-add-qty');
    const addBtn = document.getElementById('bk-add-btn');

    if (!backBtn) return;

    backBtn.addEventListener('click', () => {
        showScreen('quicksearch');
    });

    clearBtn.addEventListener('click', () => {
        if (basketItems.size === 0) return;
        if (confirm('Vill du tömma hela varukorgen?')) {
            clearBasket();
            renderBasket();
        }
    });

    addBtn.addEventListener('click', () => {
        const enr = addInput.value.trim().replace(/\D/g, '');
        const qty = parseInt(addQtyInput.value, 10) || 1;
        if (enr.length === 7) {
            addToBasket(enr, qty);
            addInput.value = '';
            addQtyInput.value = '1';
            renderBasket();
            addInput.focus(); // Return focus to E-nummer input
        }
    });

    addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent accidental form submissions if any
            addBtn.click();
        }
    });

    addQtyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addBtn.click();
        }
    });
}

// ── Render ─────────────────────────────────────────────────────────

function renderBasket() {
    const container = document.getElementById('bk-content');
    if (!container) return;

    const results = getResultsData();

    if (basketItems.size === 0) {
        container.innerHTML = `
            <div class="bk-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <p>Varukorgen är tom</p>
                <p class="bk-empty-hint">Lägg till E-nummer ovan eller från Snabbsök</p>
            </div>
        `;
        renderTotals(null);
        return;
    }

    if (!results || !results.supplierData) {
        container.innerHTML = `
            <div class="bk-empty">
                <p>Ingen prisdata laddad — kör en analys först.</p>
            </div>
        `;
        renderTotals(null);
        return;
    }

    const { supplierData, supplierIds } = results;

    // Build table — 5 columns: delete, E-nummer, Antal, Bäst pris, Leverantör
    let html = `
        <div class="bk-table-wrap">
            <table class="bk-table">
                <thead><tr>
                    <th class="bk-col-del"></th>
                    <th>E-nummer</th>
                    <th>Antal</th>
                    <th>Bäst pris</th>
                    <th class="bk-col-sup"></th>
                </tr></thead>
                <tbody>`;

    // Totals tracking
    const supplierTotals = {};
    supplierIds.forEach(id => supplierTotals[id] = 0);
    let mixTotal = 0;
    let notFoundCount = 0;

    for (const [enr, item] of basketItems) {
        const qty = item.qty;
        let bestNet = Infinity;
        let bestId = null;
        const prices = {};

        // Look up price from each supplier
        for (const id of supplierIds) {
            const data = supplierData[id];
            if (data && data.has(enr)) {
                const article = data.get(enr);
                prices[id] = article.net;
                if (article.net > 0 && article.net < bestNet) {
                    bestNet = article.net;
                    bestId = id;
                }
            }
        }

        // Accumulate supplier totals for summary cards
        for (const id of supplierIds) {
            if (prices[id] != null) supplierTotals[id] += prices[id] * qty;
        }

        const found = Object.keys(prices).length > 0;
        if (!found) notFoundCount++;

        // Best supplier badge
        const bestSup = bestId ? SUPPLIERS[bestId] : null;
        const supBadge = bestSup
            ? `<span class="bk-sup-badge" style="background:${bestSup.color}">${bestSup.icon}</span>`
            : '—';

        html += `<tr class="${!found ? 'bk-row-missing' : ''}">` +
            `<td class="bk-col-del"><button class="bk-remove-btn" data-enr="${enr}" title="Ta bort">✕</button></td>` +
            `<td class="bk-enr">${enr}</td>` +
            `<td><div class="bk-qty-controls">` +
            `<button class="bk-qty-btn" data-enr="${enr}" data-delta="-1">−</button>` +
            `<span class="bk-qty-value">${qty}</span>` +
            `<button class="bk-qty-btn" data-enr="${enr}" data-delta="1">+</button>` +
            `</div></td>`;

        if (bestNet < Infinity) {
            mixTotal += bestNet * qty;
            html += `<td class="bk-cell-mix">${(bestNet * qty).toFixed(1)} kr</td>`;
        } else {
            html += `<td class="text-muted">—</td>`;
        }

        html += `<td class="bk-col-sup">${supBadge}</td></tr>`;
    }

    html += `</tbody></table></div>`;

    if (notFoundCount > 0) {
        html += `<p class="bk-warning">⚠ ${notFoundCount} artikel${notFoundCount > 1 ? 'ar' : ''} hittades inte i prislistan</p>`;
    }

    container.innerHTML = html;

    // Attach event listeners
    container.querySelectorAll('.bk-qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const enr = btn.dataset.enr;
            const delta = parseInt(btn.dataset.delta, 10);
            const existing = basketItems.get(enr);
            if (existing) {
                existing.qty = Math.max(1, existing.qty + delta);
                saveBasket();
                renderBasket();
            }
        });
    });

    container.querySelectorAll('.bk-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            removeFromBasket(btn.dataset.enr);
            renderBasket();
        });
    });

    // Render totals
    renderTotals({ supplierTotals, mixTotal, supplierIds });
}

function renderTotals(data) {
    const container = document.getElementById('bk-totals');
    if (!container) return;

    if (!data) {
        container.innerHTML = '';
        return;
    }

    const { supplierTotals, mixTotal, supplierIds } = data;

    // Calculate savings
    const worstTotal = Math.max(...Object.values(supplierTotals));
    let savingsHtml = '<span class="bk-total-diff text-green">Billigast möjliga</span>';

    if (worstTotal > mixTotal && mixTotal > 0) {
        const savingsKr = worstTotal - mixTotal;
        const savingsPct = (savingsKr / worstTotal * 100);
        savingsHtml = `<span class="bk-total-diff text-green">Spara ${savingsKr.toFixed(0)} kr (${savingsPct.toFixed(1)}%)</span>`;
    }

    // Mix total (best price) - FULL ROW ON TOP
    let html = `
        <div class="bk-total-mix-fullrow">
            <div class="bk-total-card bk-total-mix">
                <div class="bk-total-header bk-mix-header">
                    <span>🏆 Mix (Bästa pris)</span>
                </div>
                <div class="bk-total-body" style="align-items: center; flex-direction: row; justify-content: space-between;">
                    <span class="bk-total-amount bk-mix-amount">${mixTotal.toFixed(0)} kr</span>
                    ${savingsHtml}
                </div>
            </div>
        </div>
        <div class="bk-totals-grid">
    `;

    // Per-supplier totals
    for (const id of supplierIds) {
        const sup = SUPPLIERS[id];
        const total = supplierTotals[id];
        const diff = total - mixTotal;
        const pctMore = mixTotal > 0 ? ((diff / mixTotal) * 100) : 0;

        html += `
            <div class="bk-total-card" style="border-color:${sup.color}">
                <div class="bk-total-header" style="background:${sup.color}">
                    <span>${sup.icon} ${sup.name}</span>
                </div>
                <div class="bk-total-body">
                    <span class="bk-total-amount">${total.toFixed(0)} kr</span>
                    ${diff > 0.01 ? `<span class="bk-total-diff text-red">+${diff.toFixed(0)} kr (+${pctMore.toFixed(1)}%)</span>` : ''}
                </div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ── Public show ───────────────────────────────────────────────────

function showBasket() {
    loadBasket();
    showScreen('basket');
    initBasket();
    renderBasket();
    updateBadge();
}

export { showBasket, addToBasket, removeFromBasket, clearBasket, getBasketCount, updateBadge, loadBasket };
