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
 * @param {Object} results — from compareSuppliers()
 * @param {Object} SUPPLIERS — supplier registry
 */
async function exportToExcel(results, SUPPLIERS) {
    const xlsx = await loadSheetJS();
    const wb = xlsx.utils.book_new();

    const [idA, idB] = results.supplierIds;
    const supA = SUPPLIERS[idA];
    const supB = SUPPLIERS[idB];

    // ── Sheet 1: Summary ─────────────────────────────
    const summaryData = [
        ['Prisjämförelse — Sammanfattning'],
        [],
        ['Matchade artiklar', results.stats.totalMatched],
        ['Snitt markup', results.stats.avgMaxMarkup.toFixed(1) + '%'],
        [`${supA.name} billigare`, results.stats.winsA],
        [`${supB.name} billigare`, results.stats.winsB],
        ['Samma pris', results.stats.equal],
        [],
        ['Exkluderade'],
        ['Olika enhet', results.excluded.unitMismatch],
        [`Bara ${supA.name}`, results.excluded.onlyA],
        [`Bara ${supB.name}`, results.excluded.onlyB],
        ['Saknar avtal', results.excluded.missingAgreement],
        ['Pris = 0', results.excluded.zeroPrice],
        ['Markup > 5000%', results.excluded.highMarkup],
    ];
    const wsSummary = xlsx.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Sammanfattning');

    // ── Sheet 2: All Articles ─────────────────────────
    const articleHeaders = [
        'E-nummer',
        `${supA.name} Netto`,
        `${supB.name} Netto`,
        'Bäst pris (kr)',
        `${supA.name} Markup (%)`,
        `${supB.name} Markup (%)`,
        `${supA.name} Grupp`,
        `${supB.name} Grupp`,
        'Enhet',
        'Billigast'
    ];

    const articleRows = results.matched.map(a => [
        a.enr,
        Math.round(a.netA * 100) / 100,
        Math.round(a.netB * 100) / 100,
        Math.round(a.bestNet * 100) / 100,
        Math.round(a.markupA * 100) / 100,
        Math.round(a.markupB * 100) / 100,
        a.grpA,
        a.grpB,
        a.unit,
        a.cheapest === idA ? supA.name : (a.cheapest === idB ? supB.name : 'Lika')
    ]);

    const wsArticles = xlsx.utils.aoa_to_sheet([articleHeaders, ...articleRows]);
    wsArticles['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }
    ];
    xlsx.utils.book_append_sheet(wb, wsArticles, 'Artiklar');

    // ── Sheet 3: Group Analysis ───────────────────────
    const groupHeaders = [
        'Rabattgrupp', 'Leverantör', 'Antal artiklar',
        'Snitt markup (%)', 'Total besparing (kr)'
    ];
    const groupRows = [];

    for (const [id, groups] of Object.entries(results.groups)) {
        const sup = SUPPLIERS[id];
        for (const [grp, data] of Object.entries(groups)) {
            groupRows.push([
                grp,
                sup.name,
                data.count,
                Math.round(data.avgMarkup * 100) / 100,
                Math.round(data.sumSavingsKr)
            ]);
        }
    }

    // Sort by total savings descending
    groupRows.sort((a, b) => b[4] - a[4]);

    const wsGroups = xlsx.utils.aoa_to_sheet([groupHeaders, ...groupRows]);
    wsGroups['!cols'] = [
        { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
    ];
    xlsx.utils.book_append_sheet(wb, wsGroups, 'Gruppanalys');

    // ── Sheet 4: Negotiation ──────────────────────────
    const negHeaders = [
        'Leverantör', 'Rabattgrupp', 'Artiklar',
        'Nuvarande rabatt %', 'Mål rabatt %', 'Total påverkan (kr)'
    ];
    const negRows = [];

    for (const [id, recs] of Object.entries(results.recommendations)) {
        const sup = SUPPLIERS[id];
        recs.forEach(r => {
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
