// export.js — Excel export using SheetJS
import { computeStats, computeCategoryStats } from './engine.js';

/**
 * Export results to Excel workbook with multiple sheets.
 * Loads SheetJS from CDN on first use.
 */

let XLSX = null;

async function loadSheetJS() {
    if (XLSX) return XLSX;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';
        script.onload = () => {
            XLSX = window.XLSX;
            resolve(XLSX);
        };
        script.onerror = () => reject(new Error('Kunde inte ladda SheetJS'));
        document.head.appendChild(script);
    });
}

/**
 * Export full analysis results to Excel.
 * Supports N suppliers dynamically.
 * @param {Object} filteredData — from getFilteredData()
 * @param {Object} SUPPLIERS — supplier registry
 */
async function exportToExcel(filteredData, SUPPLIERS) {
    const xlsx = await loadSheetJS();

    const { filtered, supplierIds, dynamicRecommendations } = filteredData;
    const stats = computeStats(filtered, supplierIds);
    const categoryStats = computeCategoryStats(filtered, supplierIds);

    // Name file with filter info if available
    const searchParam = document.getElementById('f-enr-search')?.value.trim();
    const grwParam = document.getElementById('f-group')?.value.trim();
    let filterString = '';
    if (grwParam) filterString = `_${grwParam.replace(/[^a-z0-9]/gi, '')}`;
    else if (searchParam) filterString = `_sok`;
    const timestamp = new Date().toISOString().slice(0, 10);

    for (const id of supplierIds) {
        const wb = xlsx.utils.book_new();
        const sup = SUPPLIERS[id];

        const wbData = [];

        // 1. Sammanfattning
        const totalCompared = Object.values(stats.wins).reduce((a, b) => a + b, 0) + stats.equal;
        const winPct = totalCompared > 0 ? ((stats.wins[id] || 0) / totalCompared * 100).toFixed(1) : 0;

        wbData.push([`${sup.name} - Förhandlingsunderlag`]);
        wbData.push([]);
        wbData.push(['Sammanfattning']);
        wbData.push(['Filtrerade artiklar', stats.count]);
        wbData.push([`${sup.name} billigast på`, `${winPct}% av artiklarna`]);
        wbData.push(['Snitt överpris', `${(stats.supplierStats[id]?.avgMarkup || 0).toFixed(1)}%`]);
        wbData.push(['Median överpris', `${(stats.supplierStats[id]?.medianMarkup || 0).toFixed(1)}%`]);
        wbData.push([]);

        // 2. Kategorianalys
        wbData.push(['Kategorianalys (Topp 10 - Lägst överpris)']);
        wbData.push(['Kategori', 'Snitt överpris %', 'Antal artiklar']);
        const catData = categoryStats[id];
        if (catData && catData.sortedAsc.length > 0) {
            catData.sortedAsc.slice(0, 10).forEach(c => {
                wbData.push([`Kategori ${c.category}`, Math.round(c.avgMarkup * 10) / 10, c.count]);
            });
        }
        wbData.push([]);

        wbData.push(['Kategorianalys (Botten 10 - Högst överpris)']);
        wbData.push(['Kategori', 'Snitt överpris %', 'Antal artiklar']);
        if (catData && catData.sortedDesc.length > 0) {
            catData.sortedDesc.slice(0, 10).forEach(c => {
                wbData.push([`Kategori ${c.category}`, Math.round(c.avgMarkup * 10) / 10, c.count]);
            });
        }
        wbData.push([]);

        // 3. Förhandlingsunderlag
        wbData.push(['Förhandlingsunderlag - Rabattgrupper']);
        // Header row
        wbData.push(['Rabattgrupp', 'Dyrare artiklar', 'Snitt överpris %', 'Nuv. rabatt %', 'Mål %', 'Diff %']);

        const headerRowIndex = wbData.length - 1; // 0-indexed index of the header row

        let recs = dynamicRecommendations ? dynamicRecommendations[id] : [];
        if (recs && recs.length > 0) {
            recs = recs.map(r => ({
                ...r,
                diffPct: r.targetDiscount - r.currentDiscount
            })).filter(r => r.diffPct >= 1).sort((a, b) => b.diffPct - a.diffPct);

            recs.forEach(r => {
                const dyrareCount = r.losingCount !== undefined ? r.losingCount : r.articleCount;
                wbData.push([
                    r.group,
                    dyrareCount,
                    Math.round(r.avgMarkup * 10) / 10,
                    Math.round(r.currentDiscount * 10) / 10,
                    Math.round(r.targetDiscount * 10) / 10,
                    Math.round(r.diffPct * 10) / 10
                ]);
            });
        }

        const ws = xlsx.utils.aoa_to_sheet(wbData);
        ws['!cols'] = [
            { wch: 25 },
            { wch: 20 },
            { wch: 15 },
            { wch: 15 },
            { wch: 15 },
            { wch: 15 }
        ];

        // Add AutoFilter to the negotiation table
        if (recs && recs.length > 0) {
            const range = {
                s: { c: 0, r: headerRowIndex },
                e: { c: 5, r: headerRowIndex + recs.length }
            };
            ws['!autofilter'] = { ref: xlsx.utils.encode_range(range) };
        }

        let sheetName = sup.name.substring(0, 31); // Max length in excel
        xlsx.utils.book_append_sheet(wb, ws, sheetName);

        // Name file with supplier name + date
        let safeSupName = sup.name.replace(/[^a-z0-9åäöÅÄÖ\-_\s]/gi, '').trim().replace(/\s+/g, '_');
        xlsx.writeFile(wb, `${safeSupName}_${timestamp}${filterString}.xlsx`);
    }
}

export { exportToExcel };
