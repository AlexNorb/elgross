// export.js — Excel export using SheetJS

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
 * @param {Object} results — from compareSuppliers()
 * @param {Object} SUPPLIERS — supplier registry
 */
async function exportToExcel(results, SUPPLIERS) {
    const xlsx = await loadSheetJS();
    const wb = xlsx.utils.book_new();

    const supplierIds = results.supplierIds;

    // ── Sheet 1: Summary ─────────────────────────────
    const summaryData = [
        ['Prisjämförelse — Sammanfattning'],
        [],
        ['Matchade artiklar', results.stats.totalMatched],
        ['Snitt markup', results.stats.avgMaxMarkup.toFixed(1) + '%'],
    ];
    for (const id of supplierIds) {
        const sup = SUPPLIERS[id];
        summaryData.push([`${sup.name} billigare`, results.stats.wins[id] || 0]);
    }
    summaryData.push(
        ['Samma pris', results.stats.equal],
        [],
        ['Exkluderade'],
        ['Olika enhet', results.excluded.unitMismatch],
    );
    for (const id of supplierIds) {
        const sup = SUPPLIERS[id];
        summaryData.push([`Bara ${sup.name}`, results.excluded.onlyCounts[id] || 0]);
    }
    summaryData.push(
        ['Saknar avtal', results.excluded.missingAgreement],
        ['Pris = 0', results.excluded.zeroPrice],
        ['Markup > 999%', results.excluded.highMarkup],
    );

    const wsSummary = xlsx.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Sammanfattning');

    // ── Sheet 2: All Articles ─────────────────────────
    // Dynamic headers: E-nummer, Bäst (kr), then per supplier: Netto, Markup (%), Grupp
    const articleHeaders = ['E-nummer', 'Bäst pris (kr)'];
    for (const id of supplierIds) {
        const name = SUPPLIERS[id].name;
        articleHeaders.push(`${name} Netto`, `${name} Markup (%)`, `${name} Grupp`);
    }
    articleHeaders.push('Enhet', 'Billigast');

    const articleRows = results.matched.map(a => {
        const row = [a.enr, Math.round(a.bestNet * 100) / 100];
        for (const id of supplierIds) {
            const s = a.suppliers[id];
            if (s) {
                row.push(
                    Math.round(s.net * 100) / 100,
                    Math.round(s.markup * 100) / 100,
                    s.grp
                );
            } else {
                row.push('', '', '');
            }
        }
        const cheapestName = a.cheapest === 'equal' ? 'Lika' : (SUPPLIERS[a.cheapest]?.name || a.cheapest);
        row.push(a.unit, cheapestName);
        return row;
    });

    const wsArticles = xlsx.utils.aoa_to_sheet([articleHeaders, ...articleRows]);
    const colWidths = [{ wch: 12 }, { wch: 14 }];
    for (const id of supplierIds) {
        colWidths.push({ wch: 14 }, { wch: 14 }, { wch: 14 });
    }
    colWidths.push({ wch: 8 }, { wch: 12 });
    wsArticles['!cols'] = colWidths;
    xlsx.utils.book_append_sheet(wb, wsArticles, 'Artiklar');

    // ── Sheet 3: Negotiation ──────────────────────────
    const negHeaders = [
        'Leverantör', 'Rabattgrupp', 'Artiklar',
        'Nuvarande rabatt %', 'Mål rabatt %', 'Total påverkan (kr)'
    ];
    const negRows = [];

    // Use recommendations if available, otherwise empty
    const recs = results.recommendations || {};
    for (const [id, recList] of Object.entries(recs)) {
        const sup = SUPPLIERS[id];
        if (!recList) continue;
        recList.forEach(r => {
            negRows.push([
                sup.name,
                r.group,
                r.articleCount,
                Math.round(r.currentDiscount * 10) / 10,
                Math.round(r.targetDiscount * 10) / 10,
                Math.round(r.totalImpactKr)
            ]);
        });
    }

    const wsNeg = xlsx.utils.aoa_to_sheet([negHeaders, ...negRows]);
    wsNeg['!cols'] = [
        { wch: 12 }, { wch: 15 }, { wch: 10 },
        { wch: 18 }, { wch: 15 }, { wch: 18 }
    ];
    xlsx.utils.book_append_sheet(wb, wsNeg, 'Förhandlingsunderlag');

    // ── Download ──────────────────────────────────────
    const timestamp = new Date().toISOString().slice(0, 10);
    xlsx.writeFile(wb, `prisjamforelse_${timestamp}.xlsx`);
}

export { exportToExcel };
