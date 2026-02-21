// engine.js — Supplier-agnostic comparison engine
// Takes parsed supplier data and produces comparison results.

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
 * Compare suppliers and produce match results.
 * Uses markup model: cheapest = 0%, others = % more expensive.
 * @param {Object} supplierData — { supplierId: Map<artNo, {list, grp, disc, net, unit}> }
 * @returns {Object} { matched[], stats, supplierData, groups, recommendations }
 */
function compareSuppliers(supplierData) {
    const supplierIds = Object.keys(supplierData);
    if (supplierIds.length < 2) throw new Error('Minst 2 leverantörer krävs');

    const [idA, idB] = supplierIds;
    const dataA = supplierData[idA];
    const dataB = supplierData[idB];

    const allArticles = new Set([...dataA.keys(), ...dataB.keys()]);

    const matched = [];
    let winsA = 0, winsB = 0, equal = 0;
    let unitMismatch = 0, onlyA = 0, onlyB = 0, missingAgreement = 0, zeroPrice = 0, highMarkup = 0;
    let sumMaxMarkup = 0;

    for (const artNo of allArticles) {
        const a = dataA.get(artNo);
        const b = dataB.get(artNo);

        if (!a || !b) {
            if (a && !b) onlyA++;
            if (!a && b) onlyB++;
            continue;
        }

        if (a.disc === null || b.disc === null) { missingAgreement++; continue; }
        if (a.net <= 0 || b.net <= 0) { zeroPrice++; continue; }

        const uA = normalizeUnit(a.unit);
        const uB = normalizeUnit(b.unit);
        if (uA && uB && uA !== uB) { unitMismatch++; continue; }

        const netA = a.net;
        const netB = b.net;
        const bestNet = Math.min(netA, netB);
        const markupA = bestNet > 0 ? ((netA - bestNet) / bestNet) * 100 : 0;
        const markupB = bestNet > 0 ? ((netB - bestNet) / bestNet) * 100 : 0;
        const maxMarkup = Math.max(markupA, markupB);

        if (maxMarkup > 999) { highMarkup++; continue; }

        let cheapest;
        if (Math.abs(markupA - markupB) < 0.01) { equal++; cheapest = 'equal'; }
        else if (markupA < markupB) { winsA++; cheapest = idA; }
        else { winsB++; cheapest = idB; }

        sumMaxMarkup += maxMarkup;

        matched.push({
            enr: artNo,
            netA, netB, bestNet,
            markupA, markupB, maxMarkup,
            grpA: a.grp, grpB: b.grp,
            discA: a.disc, discB: b.disc,
            listA: a.list, listB: b.list,
            unit: a.unit || b.unit || '',
            cheapest
        });
    }

    // Sort by max markup descending
    matched.sort((a, b) => b.maxMarkup - a.maxMarkup);

    const totalMatched = matched.length;
    const avgMaxMarkup = totalMatched > 0 ? sumMaxMarkup / totalMatched : 0;

    const groupStats = buildGroupAnalysis(matched, supplierIds);
    const recommendations = buildRecommendations(matched, supplierIds, supplierData);

    return {
        matched,
        supplierIds,
        supplierData,
        stats: {
            totalMatched,
            winsA, winsB, equal,
            avgMaxMarkup,
            totalSavings: matched.reduce((sum, a) => sum + Math.abs(a.netA - a.netB), 0)
        },
        excluded: {
            unitMismatch,
            onlyA, onlyB,
            missingAgreement,
            zeroPrice,
            highMarkup
        },
        groups: groupStats,
        recommendations
    };
}

/**
 * Build per-group statistics for both suppliers.
 * Uses markup model: avgMarkup = average max markup in each group.
 */
function buildGroupAnalysis(matched, supplierIds) {
    const [idA, idB] = supplierIds;
    const groupsA = {};
    const groupsB = {};

    matched.forEach(a => {
        const gA = a.grpA;
        if (!groupsA[gA]) groupsA[gA] = { count: 0, sumMarkup: 0, sumSavingsKr: 0, articles: [] };
        groupsA[gA].count++;
        groupsA[gA].sumMarkup += a.maxMarkup;
        groupsA[gA].sumSavingsKr += Math.abs(a.netA - a.netB);
        groupsA[gA].articles.push(a);

        const gB = a.grpB;
        if (!groupsB[gB]) groupsB[gB] = { count: 0, sumMarkup: 0, sumSavingsKr: 0, articles: [] };
        groupsB[gB].count++;
        groupsB[gB].sumMarkup += a.maxMarkup;
        groupsB[gB].sumSavingsKr += Math.abs(a.netA - a.netB);
        groupsB[gB].articles.push(a);
    });

    for (const g of Object.values(groupsA)) g.avgMarkup = g.sumMarkup / g.count;
    for (const g of Object.values(groupsB)) g.avgMarkup = g.sumMarkup / g.count;

    return { [idA]: groupsA, [idB]: groupsB };
}

/**
 * Build negotiation recommendations: for each supplier, find groups where
 * the competitor is cheaper and suggest target discounts.
 */
function buildRecommendations(matched, supplierIds, supplierData) {
    const [idA, idB] = supplierIds;
    const recsA = []; // Groups where A is more expensive
    const recsB = []; // Groups where B is more expensive

    const groupsWhereALoses = {};
    matched.forEach(a => {
        if (a.markupA > 0.01) { // A is more expensive
            const grp = a.grpA;
            if (!groupsWhereALoses[grp]) groupsWhereALoses[grp] = { articles: [], totalSavingsKr: 0 };
            groupsWhereALoses[grp].articles.push(a);
            groupsWhereALoses[grp].totalSavingsKr += (a.netA - a.netB);
        }
    });

    for (const [grp, data] of Object.entries(groupsWhereALoses)) {
        const avgDiscA = data.articles.reduce((s, a) => s + a.discA, 0) / data.articles.length;
        const avgDiscB = data.articles.reduce((s, a) => s + a.discB, 0) / data.articles.length;
        const avgMarkup = data.articles.reduce((s, a) => s + a.markupA, 0) / data.articles.length;
        recsA.push({
            group: grp,
            currentDiscount: avgDiscA,
            competitorDiscount: avgDiscB,
            targetDiscount: avgDiscA + (avgMarkup * avgDiscA / 100),
            articleCount: data.articles.length,
            totalImpactKr: data.totalSavingsKr,
            avgMarkup
        });
    }

    const groupsWhereBLoses = {};
    matched.forEach(a => {
        if (a.markupB > 0.01) { // B is more expensive
            const grp = a.grpB;
            if (!groupsWhereBLoses[grp]) groupsWhereBLoses[grp] = { articles: [], totalSavingsKr: 0 };
            groupsWhereBLoses[grp].articles.push(a);
            groupsWhereBLoses[grp].totalSavingsKr += (a.netB - a.netA);
        }
    });

    for (const [grp, data] of Object.entries(groupsWhereBLoses)) {
        const avgDiscA = data.articles.reduce((s, a) => s + a.discA, 0) / data.articles.length;
        const avgDiscB = data.articles.reduce((s, a) => s + a.discB, 0) / data.articles.length;
        const avgMarkup = data.articles.reduce((s, a) => s + a.markupB, 0) / data.articles.length;
        recsB.push({
            group: grp,
            currentDiscount: avgDiscB,
            competitorDiscount: avgDiscA,
            targetDiscount: avgDiscB + (avgMarkup * avgDiscB / 100),
            articleCount: data.articles.length,
            totalImpactKr: data.totalSavingsKr,
            avgMarkup
        });
    }

    recsA.sort((a, b) => b.totalImpactKr - a.totalImpactKr);
    recsB.sort((a, b) => b.totalImpactKr - a.totalImpactKr);

    return { [idA]: recsA, [idB]: recsB };
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
            if (!grpUpper.includes(a.grpA.toUpperCase()) && !grpUpper.includes(a.grpB.toUpperCase())) return false;
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
 */
function computeStats(articles) {
    if (articles.length === 0) {
        return { count: 0, avgMaxMarkup: 0, medianMaxMarkup: 0, winsA: 0, winsB: 0, totalSavingsKr: 0 };
    }

    let sumMarkup = 0, winsA = 0, winsB = 0, totalKr = 0;
    const markups = [];

    articles.forEach(a => {
        sumMarkup += a.maxMarkup;
        markups.push(a.maxMarkup);
        totalKr += Math.abs(a.netA - a.netB);
        if (a.cheapest !== 'equal') {
            if (a.markupA < a.markupB) winsA++;
            else winsB++;
        }
    });

    markups.sort((a, b) => a - b);
    const mid = Math.floor(markups.length / 2);
    const median = markups.length % 2 === 0
        ? (markups[mid - 1] + markups[mid]) / 2
        : markups[mid];

    return {
        count: articles.length,
        avgMaxMarkup: sumMarkup / articles.length,
        medianMaxMarkup: median,
        winsA,
        winsB,
        totalSavingsKr: totalKr
    };
}

export { loadGNP, parseAgreement, computeNetPrices, compareSuppliers, filterArticles, computeStats };
