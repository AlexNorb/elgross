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

    // 1. Calculate totals per supplier first so we know who is the overall cheapest
    const supplierTotals = {};
    supplierIds.forEach(id => supplierTotals[id] = 0);

    for (const [enr, item] of basketItems) {
        const qty = item.qty;
        for (const id of supplierIds) {
            const data = supplierData[id];
            if (data && data.has(enr)) {
                supplierTotals[id] += data.get(enr).net * qty;
            }
        }
    }

    // Find the cheapest single supplier
    let bestSingleTotal = Infinity;
    let bestSingleId = null;
    let bestSingleTotalsIds = [];
    for (const id of supplierIds) {
        const supTotalRound = Math.round(supplierTotals[id]);
        if (supTotalRound > 0) {
            if (supTotalRound < bestSingleTotal) {
                bestSingleTotal = supTotalRound;
                bestSingleId = id;
                bestSingleTotalsIds = [id];
            } else if (supTotalRound === bestSingleTotal) {
                bestSingleTotalsIds.push(id);
            }
        }
    }

    // 2. Mix distribution and table rendering
    const mixDistribution = {};
    supplierIds.forEach(id => mixDistribution[id] = { count: 0, kr: 0, items: [] });

    let mixTotal = 0;
    let notFoundCount = 0;

    for (const [enr, item] of basketItems) {
        const qty = item.qty;
        let bestNet = Infinity;
        let bestIds = [];
        const prices = {};

        // Look up price from each supplier
        for (const id of supplierIds) {
            const data = supplierData[id];
            if (data && data.has(enr)) {
                const article = data.get(enr);
                prices[id] = article.net;
                if (article.net > 0) {
                    // Compare based on row total, rounded to nearest integer
                    const rowTotal = Math.round(article.net * qty);
                    const bestRowTotal = Math.round(bestNet * qty);

                    if (rowTotal < bestRowTotal) {
                        bestNet = article.net;
                        bestIds = [id];
                    } else if (rowTotal === bestRowTotal) {
                        // Only add to ties if it's not the first one being set 
                        if (bestNet !== Infinity && !bestIds.includes(id)) {
                            bestIds.push(id);
                        }
                    }
                }
            }
        }

        const found = Object.keys(prices).length > 0;
        if (!found) notFoundCount++;

        // Best supplier badge(s)
        let supBadge = '—';
        if (bestIds.length > 0) {
            supBadge = bestIds.map(id => {
                const bSup = SUPPLIERS[id];
                return `<span class="bk-sup-badge" style="background:${bSup.color}" title="${bSup.name}">${bSup.icon}</span>`;
            }).join('');
        }

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
            html += `<td class="bk-cell-mix">${Math.round(bestNet * qty)} kr</td>`;
            if (bestIds.length > 0) {
                // If there's a tie, assign to the supplier that is cheapest overall (bestSingleId), 
                // otherwise fallback to the first id in bestIds.
                let primaryId = bestIds.includes(bestSingleId) ? bestSingleId : bestIds[0];

                mixDistribution[primaryId].count += qty;
                mixDistribution[primaryId].kr += bestNet * qty;
                mixDistribution[primaryId].items.push({ enr, qty });
            }
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
    renderTotals({ supplierTotals, mixTotal: Math.round(mixTotal), supplierIds, mixDistribution, bestSingleTotal, bestSingleId, bestSingleTotalsIds });
}

function renderTotals(data) {
    const container = document.getElementById('bk-totals');
    if (!container) return;

    if (!data) {
        container.innerHTML = '';
        return;
    }

    const { supplierTotals, mixTotal, supplierIds, mixDistribution, bestSingleTotal, bestSingleId, bestSingleTotalsIds } = data;

    // Calculate savings against cheapest single supplier
    let savingsHtml = '';
    let savingsKr = 0;
    let savingsPct = 0;

    if (bestSingleTotal > mixTotal && mixTotal > 0) {
        savingsKr = Math.round(bestSingleTotal - mixTotal);
        savingsPct = (savingsKr / bestSingleTotal * 100);
        savingsHtml = `<span class="bk-total-diff text-green" style="font-weight: 600;">Spara ${savingsKr.toFixed(0)} kr (${savingsPct.toFixed(1)}%) mot billigaste helhetsleverantören</span>`;
    } else {
        savingsHtml = '<span class="bk-total-diff text-muted">Ingen extra besparing mot billigaste.</span>';
    }

    // Determine recommendation for sorting
    let recommendMix = false;
    if (mixTotal > 0) {
        if (savingsPct >= 2.0 || !bestSingleTotalsIds || bestSingleTotalsIds.length === 0) {
            recommendMix = true;
        }
    }

    // Build Mix Distribution List
    let mixDistHtml = '<div class="bk-mix-distribution">';
    for (const id of supplierIds) {
        if (mixDistribution[id].count > 0) {
            const sup = SUPPLIERS[id];
            mixDistHtml += `
                <div class="bk-mix-dist-row">
                    <div class="bk-mix-dist-left">
                        <span class="bk-mix-dist-dot" style="background: ${sup.color}"></span>
                        <span class="bk-mix-dist-name">${sup.name}</span>
                        <span class="bk-mix-dist-count">(${mixDistribution[id].count} st)</span>
                    </div>
                    <div class="bk-mix-dist-kr">${mixDistribution[id].kr.toFixed(0)} kr</div>
                </div>
            `;
        }
    }
    mixDistHtml += '</div>';

    let html = '';

    // Build Mix HTML
    let mixCardHtml = `
        <div class="bk-total-card bk-total-mix">
            <div class="bk-total-header bk-mix-header">
                <span>🏆 Mix (Bästa möjliga pris)</span>
            </div>
            <div class="bk-total-body" style="align-items: center; justify-content: space-between;">
                <span class="bk-total-amount bk-mix-amount">${mixTotal.toFixed(0)} kr</span>
                ${savingsHtml}
            </div>
            <div class="bk-total-footer" style="padding: 12px 16px; border-top: 1px solid var(--border); background: var(--bg-primary);">
                <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">Fördelning vid köp enligt "Mix":</div>
                ${mixDistHtml}
            </div>
        </div>
    `;

    // Pre-build all supplier cards HTML
    const supplierCardsHtmlMap = {};
    for (const id of supplierIds) {
        const sup = SUPPLIERS[id];
        const total = Math.round(supplierTotals[id]);
        const diff = total - mixTotal;
        const pctMore = mixTotal > 0 ? ((diff / mixTotal) * 100) : 0;

        let diffHtml = '';
        if (diff > 0) {
            diffHtml = `<span class="bk-total-diff text-red" style="margin-bottom: 8px; display: inline-block;">Dyrare än mix: +${diff.toFixed(0)} kr (+${pctMore.toFixed(1)}%)</span>`;
        } else {
            diffHtml = `<span class="bk-total-diff text-green" style="margin-bottom: 8px; display: inline-block;">Samma som bästa pris</span>`;
        }

        const isBestSingle = bestSingleTotalsIds && bestSingleTotalsIds.includes(id);

        // Inner Mix List
        let mixListHtml = '';
        if (mixDistribution[id] && mixDistribution[id].count > 0) {
            const items = mixDistribution[id].items;
            mixListHtml = `
                <div class="bk-sup-mix-list-container">
                    <div class="bk-sup-mix-list-header">
                        <span>Att köpa vid "Mix"-val:</span>
                        <button class="bk-copy-btn" data-supplier="${id}" title="Kopiera lista som CSV">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    </div>
                    <div class="bk-sup-mix-list-scroller">
                        ${items.map(i => `<div class="bk-sup-mix-item"><span class="bk-mix-enr">${i.enr}</span><span class="bk-mix-qty">${i.qty} st</span></div>`).join('')}
                    </div>
                </div>
            `;
        }

        supplierCardsHtmlMap[id] = `
            <div class="bk-total-card ${isBestSingle && total > 0 ? 'bk-total-cheapest' : ''}" style="border-color:${sup.color}">
                <div class="bk-total-header" style="background:${sup.color}">
                    <span>${sup.name} ${isBestSingle && total > 0 ? '(Billigast som ensam leverantör)' : ''}</span>
                </div>
                <div class="bk-total-body">
                    <div class="bk-total-info">
                        <span class="bk-total-amount">${total.toFixed(0)} kr</span>
                        ${total > 0 && isBestSingle ? '<span style="font-size: 0.75rem; color: var(--green); margin-bottom: 4px; font-weight: 600;">✅ Vårt val av helhetsleverantör</span>' : ''}
                        ${total > 0 ? diffHtml : '<span class="text-muted" style="font-size: 0.85rem">Inga artiklar hos denna leverantör</span>'}
                    </div>
                    ${mixListHtml}
                </div>
            </div>
        `;
    }

    // Assemble final Layout
    if (recommendMix || !bestSingleTotalsIds || bestSingleTotalsIds.length === 0) {
        // Recommend Mix: Mix card on top row, all suppliers in grid
        html += `
            <div class="bk-total-mix-fullrow">
                ${mixCardHtml}
            </div>
            <div class="bk-totals-grid">
        `;
        for (const id of supplierIds) {
            html += supplierCardsHtmlMap[id];
        }
        html += '</div>';
    } else {
        // Recommend Single Supplier(s): Put the best single supplier(s) in a top grid, then Mix and others below
        html += `<div class="bk-totals-grid" style="margin-bottom: 12px;">`;
        for (const id of bestSingleTotalsIds) {
            html += supplierCardsHtmlMap[id];
        }
        html += `</div>`;

        // Second grid for the rest
        html += `<div class="bk-totals-grid">`;
        html += mixCardHtml; // Mix card goes in second grid
        for (const id of supplierIds) {
            if (!bestSingleTotalsIds.includes(id)) {
                html += supplierCardsHtmlMap[id];
            }
        }
        html += '</div>';
    }
    container.innerHTML = html;

    // Attach copy clipboard event listeners
    const totalsContainer = document.getElementById('bk-totals');
    totalsContainer.querySelectorAll('.bk-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.supplier;
            if (mixDistribution[id]) {
                const csvData = mixDistribution[id].items.map(i => `${i.enr}; ${i.qty}`).join('\\n');
                navigator.clipboard.writeText(csvData).then(() => {
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                    setTimeout(() => btn.innerHTML = originalHtml, 2000);
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                });
            }
        });
    });
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
