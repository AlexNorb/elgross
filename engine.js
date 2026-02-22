// engine.js — Supplier-agnostic comparison engine
// Takes parsed supplier data and produces comparison results.
// Supports N suppliers (2 or more).

import { SUPPLIERS } from './suppliers.js';

/**
 * Normalize unit strings so FRP/FP match
 */
function normalizeUnit(u) {
    const upper = (u || '').toUpperCase().trim();
    return (upper === 'FRP' || upper === 'FP') ? 'FP' : upper;
}

/**
 * Load and parse GNP file for a supplier from the server.
 * @param {string} supplierId — key in SUPPLIERS
 * @returns {Promise<Map<string, {list, grp, unit}>>}
 */
async function loadGNP(supplierId) {
    const supplier = SUPPLIERS[supplierId];
    const response = await fetch(supplier.gnpFile);
    if (!response.ok) throw new Error(`Kunde inte ladda ${supplier.gnpFile}`);
    const buffer = await response.arrayBuffer();
    const content = new TextDecoder('iso-8859-1').decode(buffer);
    return supplier.parseGNP(content);
}

/**
 * Parse a user-uploaded agreement file for a supplier.
 * @param {string} supplierId
 * @param {string} content — raw text content
 * @returns {Map<string, number>} grp → discount%
 */
function parseAgreement(supplierId, content) {
    return SUPPLIERS[supplierId].parseAgreement(content);
}

/**
 * Compute net prices for a supplier using GNP data + discount map.
 * @param {Map} gnpArticles — artNo → { list, grp, unit }
 * @param {Map} discounts — grp → discount%
 * @returns {Map<string, {list, grp, disc, net, unit}>}
 */
function computeNetPrices(gnpArticles, discounts) {
    const results = new Map();
    for (const [artNo, data] of gnpArticles) {
        let net = null;
        let disc = discounts.get(data.grp) ?? null;

        if (discounts.has('NET:' + artNo)) {
            net = discounts.get('NET:' + artNo);
            disc = data.list > 0 ? (1 - net / data.list) * 100 : 0;
        } else if (discounts.has('ART_DISC:' + artNo)) {
            disc = discounts.get('ART_DISC:' + artNo);
            net = data.list * (1 - disc / 100);
        } else if (disc !== null) {
            net = data.list * (1 - disc / 100);
        }

        results.set(artNo, {
            list: data.list,
            grp: data.grp,
            disc,
            net,
            unit: data.unit
        });
    }
    return results;
}

/**
 * Compare N suppliers and produce match results.
 * Uses markup model: cheapest = 0%, others = % more expensive.
 * An article is included if it exists in ≥2 suppliers with valid prices.
 * @param {Object} supplierData — { supplierId: Map<artNo, {list, grp, disc, net, unit}> }
 * @returns {Object} { matched[], stats, supplierIds, supplierData }
 */
function compareSuppliers(supplierData) {
    const supplierIds = Object.keys(supplierData);
    if (supplierIds.length < 2) throw new Error('Minst 2 leverantörer krävs');

    // Collect all unique article numbers
    const allArticles = new Set();
    for (const id of supplierIds) {
        for (const artNo of supplierData[id].keys()) {
            allArticles.add(artNo);
        }
    }

    const matched = [];
    const wins = {};
    supplierIds.forEach(id => wins[id] = 0);
    let equalCount = 0;
    let unitMismatch = 0, missingAgreement = 0, zeroPrice = 0, highMarkup = 0;
    const onlyCounts = {};
    supplierIds.forEach(id => onlyCounts[id] = 0);
    let sumMaxMarkup = 0;

    for (const artNo of allArticles) {
        // Gather valid data from each supplier
        const valid = {};
        let skip = false;

        for (const id of supplierIds) {
            const d = supplierData[id].get(artNo);
            if (!d) continue;
            if (d.disc === null) { missingAgreement++; skip = true; break; }
            if (d.net <= 0) { zeroPrice++; skip = true; break; }
            valid[id] = d;
        }
        if (skip) continue;

        const validIds = Object.keys(valid);

        // Need at least 2 suppliers to compare
        if (validIds.length < 2) {
            if (validIds.length === 1) onlyCounts[validIds[0]]++;
            continue;
        }

        // Unit check — all must match (if non-empty)
        const units = validIds.map(id => normalizeUnit(valid[id].unit)).filter(u => u);
        if (units.length > 1 && new Set(units).size > 1) { unitMismatch++; continue; }

        // Find best net price
        const nets = {};
        validIds.forEach(id => nets[id] = valid[id].net);
        const bestNet = Math.min(...Object.values(nets));

        // Compute markup per supplier
        const markups = {};
        let maxMarkup = 0;
        for (const id of validIds) {
            markups[id] = bestNet > 0 ? ((nets[id] - bestNet) / bestNet) * 100 : 0;
            maxMarkup = Math.max(maxMarkup, markups[id]);
        }

        if (maxMarkup > 999) { highMarkup++; continue; }

        // Determine cheapest supplier
        let cheapest;
        const minMarkup = Math.min(...Object.values(markups));
        const cheapestIds = validIds.filter(id => Math.abs(markups[id] - minMarkup) < 0.01);
        if (cheapestIds.length === validIds.length) {
            equalCount++;
            cheapest = 'equal';
        } else {
            cheapest = cheapestIds[0];
            wins[cheapest]++;
        }

        sumMaxMarkup += maxMarkup;

        // Build per-supplier data for this article
        const suppliersObj = {};
        for (const id of validIds) {
            suppliersObj[id] = {
                net: nets[id],
                markup: markups[id],
                grp: valid[id].grp,
                disc: valid[id].disc,
                list: valid[id].list
            };
        }

        matched.push({
            enr: artNo,
            bestNet,
            maxMarkup,
            cheapest,
            unit: units[0] || '',
            suppliers: suppliersObj
        });
    }

    // Sort by max markup descending
    matched.sort((a, b) => b.maxMarkup - a.maxMarkup);

    const cStats = computeStats(matched, supplierIds);
    cStats.totalMatched = cStats.count; // alias for backwards compatibility

    return {
        matched,
        supplierIds,
        supplierData,
        stats: cStats,
        excluded: {
            unitMismatch,
            onlyCounts,
            missingAgreement,
            zeroPrice,
            highMarkup
        }
    };
}

/**
 * Filter matched articles based on criteria.
 */
function filterArticles(matched, filters = {}) {
    return matched.filter(a => {
        if (filters.enrFrom && a.enr < filters.enrFrom) return false;
        if (filters.enrTo && a.enr > filters.enrTo) return false;
        if (filters.markupMin !== undefined && filters.markupMin !== '' && a.maxMarkup < parseFloat(filters.markupMin)) return false;
        if (filters.markupMax !== undefined && filters.markupMax !== '' && a.maxMarkup > parseFloat(filters.markupMax)) return false;
        if (filters.cheapest && a.cheapest !== filters.cheapest) return false;
        if (filters.groups && filters.groups.length > 0) {
            const grpUpper = filters.groups.map(g => g.toUpperCase());
            const articleGrps = Object.values(a.suppliers).map(s => s.grp.toUpperCase());
            if (!articleGrps.some(g => grpUpper.includes(g))) return false;
        }
        if (filters.categories && filters.categories.length > 0) {
            if (!filters.categories.some(prefix => a.enr.startsWith(prefix))) return false;
        }
        if (filters.searchEnr && !a.enr.includes(filters.searchEnr)) return false;
        if (filters.priceMin !== undefined && filters.priceMin !== '') {
            if (a.bestNet < parseFloat(filters.priceMin)) return false;
        }
        if (filters.priceMax !== undefined && filters.priceMax !== '') {
            if (a.bestNet > parseFloat(filters.priceMax)) return false;
        }
        return true;
    });
}

/**
 * Compute summary stats for a set of articles.
 * @param {Array} articles — matched articles with suppliers object
 * @param {Array} supplierIds — list of supplier IDs
 */
function computeStats(articles, supplierIds) {
    if (!supplierIds || supplierIds.length === 0) {
        supplierIds = articles.length > 0 ? Object.keys(articles[0].suppliers) : [];
    }
    const wins = {};
    supplierIds.forEach(id => wins[id] = 0);

    const supplierStats = {};
    supplierIds.forEach(id => {
        supplierStats[id] = { sumMarkup: 0, markups: [] };
    });

    if (articles.length === 0) {
        supplierIds.forEach(id => {
            supplierStats[id].avgMarkup = 0;
            supplierStats[id].medianMarkup = 0;
            delete supplierStats[id].sumMarkup;
            delete supplierStats[id].markups;
        });
        return { count: 0, avgMaxMarkup: 0, medianMaxMarkup: 0, wins, equal: 0, supplierStats };
    }

    let sumMarkup = 0, equalCount = 0;
    const markups = [];

    articles.forEach(a => {
        sumMarkup += a.maxMarkup;
        markups.push(a.maxMarkup);
        if (a.cheapest === 'equal') {
            equalCount++;
        } else if (wins[a.cheapest] !== undefined) {
            wins[a.cheapest]++;
        }

        supplierIds.forEach(id => {
            if (a.suppliers && a.suppliers[id]) {
                const mu = a.suppliers[id].markup;
                supplierStats[id].sumMarkup += mu;
                supplierStats[id].markups.push(mu);
            }
        });
    });

    markups.sort((a, b) => a - b);
    const mid = Math.floor(markups.length / 2);
    const median = markups.length % 2 === 0
        ? (markups[mid - 1] + markups[mid]) / 2
        : markups[mid];

    supplierIds.forEach(id => {
        const arr = supplierStats[id].markups;
        arr.sort((a, b) => a - b);
        let sMed = 0;
        if (arr.length > 0) {
            const smid = Math.floor(arr.length / 2);
            sMed = arr.length % 2 === 0 ? (arr[smid - 1] + arr[smid]) / 2 : arr[smid];
        }
        supplierStats[id].avgMarkup = arr.length > 0 ? supplierStats[id].sumMarkup / arr.length : 0;
        supplierStats[id].medianMarkup = sMed;
        delete supplierStats[id].sumMarkup;
        delete supplierStats[id].markups;
    });

    return {
        count: articles.length,
        avgMaxMarkup: sumMarkup / articles.length,
        medianMaxMarkup: median,
        wins,
        equal: equalCount,
        supplierStats
    };
}

/**
 * Compute average markup per category (first 2 digits of E-nummer) per supplier
 * Returns { supplierId: { top5: [], bottom5: [] } }
 */
function computeCategoryStats(articles, supplierIds) {
    const stats = {};
    supplierIds.forEach(id => {
        const catMap = {};
        articles.forEach(a => {
            const s = a.suppliers[id];
            if (!s) return;
            const cat = a.enr.substring(0, 2);
            if (!catMap[cat]) catMap[cat] = { sumMarkup: 0, count: 0 };
            catMap[cat].sumMarkup += s.markup;
            catMap[cat].count++;
        });

        const arr = [];
        for (const [cat, data] of Object.entries(catMap)) {
            arr.push({ category: cat, avgMarkup: data.sumMarkup / data.count, count: data.count });
        }
        arr.sort((a, b) => a.avgMarkup - b.avgMarkup);

        stats[id] = {
            sortedAsc: [...arr],
            sortedDesc: [...arr].reverse()
        };
    });
    return stats;
}

export { loadGNP, parseAgreement, computeNetPrices, compareSuppliers, filterArticles, computeStats, computeCategoryStats };
