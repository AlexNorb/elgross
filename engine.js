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
        const disc = discounts.get(data.grp) ?? null;
        const net = disc !== null ? data.list * (1 - disc / 100) : null;
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
 * @param {Object} supplierData — { supplierId: Map<artNo, {list, grp, disc, net, unit}> }
 * @returns {Object} { matched[], stats, perSupplier{}, excluded{} }
 */
function compareSuppliers(supplierData) {
    const supplierIds = Object.keys(supplierData);
    if (supplierIds.length < 2) throw new Error('Minst 2 leverantörer krävs');

    // For now, we work with exactly 2 suppliers (extensible later)
    const [idA, idB] = supplierIds;
    const dataA = supplierData[idA];
    const dataB = supplierData[idB];

    // Collect all article numbers
    const allArticles = new Set([...dataA.keys(), ...dataB.keys()]);

    const matched = [];
    let winsA = 0, winsB = 0, equal = 0;
    let unitMismatch = 0, onlyA = 0, onlyB = 0, missingAgreement = 0, zeroPrice = 0;
    let totalDiffSum = 0;

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
        const diffKr = netA - netB; // positive = A more expensive
        const refPrice = Math.max(netA, netB);
        const diffPct = refPrice > 0 ? (diffKr / refPrice) * 100 : 0;

        if (Math.abs(diffPct) < 0.01) equal++;
        else if (diffKr > 0) winsB++;
        else winsA++;

        totalDiffSum += diffPct;

        matched.push({
            enr: artNo,
            netA, netB,
            diffKr, diffPct,
            grpA: a.grp, grpB: b.grp,
            discA: a.disc, discB: b.disc,
            listA: a.list, listB: b.list,
            unit: a.unit || b.unit || '',
            cheapest: diffKr > 0.001 ? idB : (diffKr < -0.001 ? idA : 'equal')
        });
    }

    // Sort by absolute diff% descending
    matched.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

    const totalMatched = matched.length;
    const avgDiffPct = totalMatched > 0 ? totalDiffSum / totalMatched : 0;

    // Group analysis
    const groupStats = buildGroupAnalysis(matched, supplierIds);

    // Recommendations
    const recommendations = buildRecommendations(matched, supplierIds, supplierData);

    return {
        matched,
        supplierIds,
        stats: {
            totalMatched,
            winsA, winsB, equal,
            avgDiffPct,
            totalSavings: matched.reduce((sum, a) => sum + Math.abs(a.diffKr), 0)
        },
        excluded: {
            unitMismatch,
            onlyA, onlyB,
            missingAgreement,
            zeroPrice
        },
        groups: groupStats,
        recommendations
    };
}

/**
 * Build per-group statistics for both suppliers.
 */
function buildGroupAnalysis(matched, supplierIds) {
    const [idA, idB] = supplierIds;
    const groupsA = {};
    const groupsB = {};

    matched.forEach(a => {
        // Group by supplier A's group
        const gA = a.grpA;
        if (!groupsA[gA]) groupsA[gA] = { count: 0, sumDiffKr: 0, sumDiffPct: 0, articles: [] };
        groupsA[gA].count++;
        groupsA[gA].sumDiffKr += a.diffKr;
        groupsA[gA].sumDiffPct += a.diffPct;
        groupsA[gA].articles.push(a);

        // Group by supplier B's group
        const gB = a.grpB;
        if (!groupsB[gB]) groupsB[gB] = { count: 0, sumDiffKr: 0, sumDiffPct: 0, articles: [] };
        groupsB[gB].count++;
        groupsB[gB].sumDiffKr += a.diffKr;
        groupsB[gB].sumDiffPct += a.diffPct;
        groupsB[gB].articles.push(a);
    });

    // Compute averages
    for (const g of Object.values(groupsA)) g.avgPct = g.sumDiffPct / g.count;
    for (const g of Object.values(groupsB)) g.avgPct = g.sumDiffPct / g.count;

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

    // Group by A's groups where B wins
    const groupsWhereALoses = {};
    matched.forEach(a => {
        if (a.diffKr > 0) { // A more expensive
            const grp = a.grpA;
            if (!groupsWhereALoses[grp]) groupsWhereALoses[grp] = { articles: [], totalDiffKr: 0 };
            groupsWhereALoses[grp].articles.push(a);
            groupsWhereALoses[grp].totalDiffKr += a.diffKr;
        }
    });

    for (const [grp, data] of Object.entries(groupsWhereALoses)) {
        const avgDiscA = data.articles.reduce((s, a) => s + a.discA, 0) / data.articles.length;
        const avgDiscB = data.articles.reduce((s, a) => s + a.discB, 0) / data.articles.length;
        const avgDiffPct = data.articles.reduce((s, a) => s + a.diffPct, 0) / data.articles.length;
        recsA.push({
            group: grp,
            currentDiscount: avgDiscA,
            competitorDiscount: avgDiscB,
            targetDiscount: avgDiscA + (avgDiffPct * avgDiscA / 100),
            articleCount: data.articles.length,
            totalImpactKr: data.totalDiffKr,
            avgDiffPct
        });
    }

    // Group by B's groups where A wins
    const groupsWhereBLoses = {};
    matched.forEach(a => {
        if (a.diffKr < 0) { // B more expensive
            const grp = a.grpB;
            if (!groupsWhereBLoses[grp]) groupsWhereBLoses[grp] = { articles: [], totalDiffKr: 0 };
            groupsWhereBLoses[grp].articles.push(a);
            groupsWhereBLoses[grp].totalDiffKr += Math.abs(a.diffKr);
        }
    });

    for (const [grp, data] of Object.entries(groupsWhereBLoses)) {
        const avgDiscA = data.articles.reduce((s, a) => s + a.discA, 0) / data.articles.length;
        const avgDiscB = data.articles.reduce((s, a) => s + a.discB, 0) / data.articles.length;
        const avgDiffPct = data.articles.reduce((s, a) => s + Math.abs(a.diffPct), 0) / data.articles.length;
        recsB.push({
            group: grp,
            currentDiscount: avgDiscB,
            competitorDiscount: avgDiscA,
            targetDiscount: avgDiscB + (avgDiffPct * avgDiscB / 100),
            articleCount: data.articles.length,
            totalImpactKr: data.totalDiffKr,
            avgDiffPct
        });
    }

    // Sort by total impact
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
        if (filters.diffMin !== undefined && filters.diffMin !== '' && a.diffPct < parseFloat(filters.diffMin)) return false;
        if (filters.diffMax !== undefined && filters.diffMax !== '' && a.diffPct > parseFloat(filters.diffMax)) return false;
        if (filters.cheapest && a.cheapest !== filters.cheapest) return false;
        if (filters.groups && filters.groups.length > 0) {
            const grpUpper = filters.groups.map(g => g.toUpperCase());
            if (!grpUpper.includes(a.grpA.toUpperCase()) && !grpUpper.includes(a.grpB.toUpperCase())) return false;
        }
        if (filters.categories && filters.categories.length > 0) {
            if (!filters.categories.some(prefix => a.enr.startsWith(prefix))) return false;
        }
        if (filters.searchEnr && !a.enr.includes(filters.searchEnr)) return false;
        return true;
    });
}

/**
 * Compute summary stats for a set of articles.
 */
function computeStats(articles) {
    if (articles.length === 0) {
        return { count: 0, avgDiffPct: 0, medianDiffPct: 0, winsA: 0, winsB: 0, totalDiffKr: 0 };
    }

    let sumPct = 0, winsA = 0, winsB = 0, totalKr = 0;
    const diffs = [];

    articles.forEach(a => {
        sumPct += a.diffPct;
        diffs.push(a.diffPct);
        totalKr += a.diffKr;
        if (a.diffKr > 0) winsB++;
        else if (a.diffKr < 0) winsA++;
    });

    diffs.sort((a, b) => a - b);
    const mid = Math.floor(diffs.length / 2);
    const median = diffs.length % 2 === 0
        ? (diffs[mid - 1] + diffs[mid]) / 2
        : diffs[mid];

    return {
        count: articles.length,
        avgDiffPct: sumPct / articles.length,
        medianDiffPct: median,
        winsA,
        winsB,
        totalDiffKr: totalKr
    };
}

export { loadGNP, parseAgreement, computeNetPrices, compareSuppliers, filterArticles, computeStats };
