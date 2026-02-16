// app.js — Prisjämförelse: Filterable Article List

// === Global State ===
let items = {};
let matchedArticles = []; // flat array of all matched, valid articles

const DEBUG_IDS = ['1820296'];

// === DOM ===
const btnProcess = document.getElementById('btn-process');
const statusMsg = document.getElementById('status-msg');
const dashboard = document.getElementById('dashboard');

btnProcess.addEventListener('click', startProcess);

// === Main Process ===
async function startProcess() {
    statusMsg.textContent = "Laddar filer från server...";
    dashboard.classList.add('hidden');
    items = {};
    matchedArticles = [];

    try {
        const [ahlGnp, ahlAvt, rexGnp, rexAvt] = await Promise.all([
            fetchText('ahlsell_gnp.txt'),
            fetchText('ahlsell_avtal.txt'),
            fetchText('rexel_gnp.txt'),
            fetchText('rexel_avtal.txt')
        ]);

        if (!ahlGnp || !ahlAvt || !rexGnp || !rexAvt) {
            throw new Error("Kunde inte ladda alla filer.");
        }

        statusMsg.textContent = "Bearbetar Ahlsell...";
        await tick();
        const ahlDiscounts = parseAhlsellAgreements(ahlAvt);
        parseAhlsellGNP(ahlGnp, ahlDiscounts);

        statusMsg.textContent = "Bearbetar Rexel...";
        await tick();
        const rexDiscounts = parseRexelAgreements(rexAvt);
        parseRexelGNP(rexGnp, rexDiscounts);

        statusMsg.textContent = "Beräknar jämförelser...";
        await tick();
        buildMatchedArticles();

        renderDashboard();
        statusMsg.textContent = "Klar!";

    } catch (err) {
        statusMsg.textContent = "Fel: " + err.message;
        console.error(err);
    }
}

function tick() { return new Promise(r => setTimeout(r, 10)); }

// === File Helpers ===
async function fetchText(filename) {
    const response = await fetch(filename);
    if (!response.ok) throw new Error(`Failed to load ${filename}`);
    const buffer = await response.arrayBuffer();
    return new TextDecoder('iso-8859-1').decode(buffer);
}

function getRange(id) {
    const parts = document.getElementById(id).value.split('-');
    return [parseInt(parts[0]) - 1, parseInt(parts[1])];
}

// === Ahlsell Parsing ===
function parseAhlsellAgreements(content) {
    const discMap = {};
    const lines = content.split('\n');
    const [gStart, gEnd] = getRange('cfg-ahl-grp-avt');
    const [dStart, dEnd] = getRange('cfg-ahl-disc');
    const discDec = parseInt(document.getElementById('cfg-ahl-disc-dec').value) || 0;

    lines.forEach(line => {
        if (line.length < 40) return;
        const grp = line.substring(gStart, gEnd).trim();
        const discStr = line.substring(dStart, dEnd).trim().replace(',', '.');
        const disc = parseFloat(discStr) / Math.pow(10, discDec);
        if (grp && !isNaN(disc)) discMap[grp] = disc;
    });
    return discMap;
}

function parseAhlsellGNP(content, discMap) {
    const lines = content.split('\n');
    const [aStart, aEnd] = getRange('cfg-ahl-art');
    const [pStart, pEnd] = getRange('cfg-ahl-price');
    const [gStart, gEnd] = getRange('cfg-ahl-grp-gnp');
    const [uStart, uEnd] = getRange('cfg-ahl-unit');
    const priceDec = parseInt(document.getElementById('cfg-ahl-price-dec').value) || 0;

    lines.forEach(line => {
        if (line.length < 10) return;
        const artNo = line.substring(aStart, aEnd).trim().replace(/\s/g, '');
        const priceStr = line.substring(pStart, pEnd).trim().replace(',', '.');
        const grp = line.substring(gStart, gEnd).trim();
        const unit = line.length >= uEnd ? line.substring(uStart, uEnd).trim() : '';
        const price = parseFloat(priceStr) / Math.pow(10, priceDec);
        const disc = discMap[grp] ?? null;
        const net = disc !== null ? price * (1 - disc / 100) : null;

        if (artNo && !isNaN(price)) {
            if (!items[artNo]) items[artNo] = {};
            items[artNo].ahl = { list: price, grp, disc, net, unit };
        }
    });
}

// === Rexel Parsing ===
function parseRexelAgreements(content) {
    const discMap = {};
    const lines = content.split('\n');
    const idxGrp = parseInt(document.getElementById('cfg-rex-grp-avt').value);
    const idxDisc = parseInt(document.getElementById('cfg-rex-disc').value);
    const discDec = parseInt(document.getElementById('cfg-rex-disc-dec').value) || 0;
    const sep = document.getElementById('cfg-rex-sep').value;

    lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.split(sep);
        const grp = parts[idxGrp]?.trim();
        const discStr = parts[idxDisc]?.trim()?.replace(',', '.');
        if (grp && discStr) discMap[grp] = parseFloat(discStr) / Math.pow(10, discDec);
    });
    return discMap;
}

function parseRexelGNP(content, discMap) {
    const lines = content.split('\n');
    const idxArt = parseInt(document.getElementById('cfg-rex-art').value);
    const idxPrice = parseInt(document.getElementById('cfg-rex-price').value);
    const idxGrp = parseInt(document.getElementById('cfg-rex-grp-gnp').value);
    const idxUnit = parseInt(document.getElementById('cfg-rex-unit').value);
    const priceDec = parseInt(document.getElementById('cfg-rex-price-dec').value) || 0;
    const sep = document.getElementById('cfg-rex-sep').value;

    lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.split(sep);
        if (parts.length <= Math.max(idxArt, idxPrice, idxGrp)) return;

        const artNo = parts[idxArt].trim().replace(/\s/g, '');
        const grp = parts[idxGrp].trim();
        const unit = parts[idxUnit] ? parts[idxUnit].trim() : '';
        const priceStr = parts[idxPrice].trim().replace(',', '.');
        const price = parseFloat(priceStr) / Math.pow(10, priceDec);
        const disc = discMap[grp] ?? null;
        const net = disc !== null ? price * (1 - disc / 100) : null;

        if (artNo && !isNaN(price)) {
            if (!items[artNo]) items[artNo] = {};
            items[artNo].rex = { list: price, grp, disc, net, unit };
        }
    });
}

// === Build Matched Articles ===
function buildMatchedArticles() {
    matchedArticles = [];
    let ahlWins = 0, rexWins = 0, equal = 0;
    let unitMismatch = 0, onlyAhl = 0, onlyRex = 0, missingAgreement = 0, zeroPrice = 0;
    let totalDiffSum = 0;

    const normalizeUnit = u => {
        const upper = (u || '').toUpperCase();
        return (upper === 'FRP' || upper === 'FP') ? 'FP' : upper;
    };

    for (const [enr, data] of Object.entries(items)) {
        if (!data.ahl || !data.rex) {
            if (data.ahl && !data.rex) onlyAhl++;
            if (!data.ahl && data.rex) onlyRex++;
            continue;
        }
        if (data.ahl.disc === null || data.rex.disc === null) { missingAgreement++; continue; }
        if (data.ahl.net <= 0 || data.rex.net <= 0) { zeroPrice++; continue; }

        const aU = normalizeUnit(data.ahl.unit);
        const rU = normalizeUnit(data.rex.unit);
        if (aU && rU && aU !== rU) { unitMismatch++; continue; }

        const ahlNet = data.ahl.net;
        const rexNet = data.rex.net;
        const diffKr = ahlNet - rexNet;
        const refPrice = Math.max(ahlNet, rexNet);
        const diffPct = refPrice > 0 ? (diffKr / refPrice) * 100 : 0;

        if (Math.abs(diffPct) < 0.01) equal++;
        else if (diffKr > 0) rexWins++;
        else ahlWins++;

        totalDiffSum += diffPct;

        matchedArticles.push({
            enr, ahlNet, rexNet, diffKr, diffPct,
            ahlGrp: data.ahl.grp, rexGrp: data.rex.grp,
            unit: data.ahl.unit || data.rex.unit || ''
        });
    }

    // Sort by diff% descending (absolute)
    matchedArticles.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

    // Update summary cards
    const total = matchedArticles.length;
    document.getElementById('sum-matched').textContent = total.toLocaleString('sv-SE');
    document.getElementById('sum-ahl-wins').textContent = ahlWins.toLocaleString('sv-SE');
    document.getElementById('sum-rex-wins').textContent = rexWins.toLocaleString('sv-SE');
    document.getElementById('sum-equal').textContent = equal.toLocaleString('sv-SE');
    document.getElementById('sum-unit-skip').textContent = unitMismatch.toLocaleString('sv-SE');
    document.getElementById('sum-only-ahl').textContent = onlyAhl.toLocaleString('sv-SE');
    document.getElementById('sum-only-rex').textContent = onlyRex.toLocaleString('sv-SE');
    document.getElementById('sum-no-agreement').textContent = missingAgreement.toLocaleString('sv-SE');
    document.getElementById('sum-zero-price').textContent = zeroPrice.toLocaleString('sv-SE');

    if (total > 0) {
        const avgDiff = (totalDiffSum / total).toFixed(2);
        document.getElementById('sum-diff').textContent = avgDiff + '%';
        document.getElementById('sum-diff').className = 'big-number ' + (avgDiff > 0 ? 'positive' : 'negative');
        document.getElementById('sum-winner').textContent = avgDiff > 0 ? 'Rexel' : 'Ahlsell';
    }
}

// === Filtering ===
function getCheckedCategories() {
    const checked = [];
    document.querySelectorAll('.cat-l2-cb:checked').forEach(cb => checked.push(cb.value));
    return checked;
}

function getFilteredArticles() {
    const enrFrom = document.getElementById('f-enr-from').value.trim();
    const enrTo = document.getElementById('f-enr-to').value.trim();
    const diffMin = document.getElementById('f-diff-min').value;
    const diffMax = document.getElementById('f-diff-max').value;
    const cheapest = document.getElementById('f-cheapest').value;
    const groupFilterRaw = document.getElementById('f-group').value.trim().toUpperCase();
    const groupFilters = groupFilterRaw ? groupFilterRaw.split(',').map(g => g.trim()).filter(Boolean) : [];
    const useGroups = groupFilters.length > 0;
    const cats = getCheckedCategories();
    const useCats = cats.length > 0;

    return matchedArticles.filter(a => {
        if (enrFrom && a.enr < enrFrom) return false;
        if (enrTo && a.enr > enrTo) return false;

        // Category checkboxes
        if (useCats && !cats.some(prefix => a.enr.startsWith(prefix))) return false;

        // Diff % range
        if (diffMin !== '' && a.diffPct < parseFloat(diffMin)) return false;
        if (diffMax !== '' && a.diffPct > parseFloat(diffMax)) return false;

        if (cheapest === 'ahl' && a.diffKr >= 0) return false;
        if (cheapest === 'rex' && a.diffKr <= 0) return false;

        // Group filter (multi)
        if (useGroups && !groupFilters.includes(a.ahlGrp.toUpperCase()) && !groupFilters.includes(a.rexGrp.toUpperCase())) return false;

        return true;
    });
}

function applyFilters() {
    const filtered = getFilteredArticles();
    document.getElementById('filter-count').textContent =
        `Visar ${filtered.length.toLocaleString('sv-SE')} av ${matchedArticles.length.toLocaleString('sv-SE')} artiklar`;
    renderFilteredSummary(filtered);
    renderArticleTable(filtered);
}

function renderFilteredSummary(articles) {
    const n = articles.length;
    document.getElementById('fs-count').textContent = n.toLocaleString('sv-SE');

    if (n === 0) {
        document.getElementById('fs-avg-diff').textContent = '-';
        document.getElementById('fs-median-diff').textContent = '-';
        document.getElementById('fs-ahl-wins').textContent = '0';
        document.getElementById('fs-rex-wins').textContent = '0';
        document.getElementById('fs-total-kr').textContent = '0';
        document.getElementById('fs-top-groups').innerHTML = '<em>Inga artiklar</em>';
        return;
    }

    // Stats
    let sumDiffPct = 0, ahlW = 0, rexW = 0, totalDiffKr = 0;
    const diffs = [];
    const ahlGroupCount = {}, rexGroupCount = {};

    articles.forEach(a => {
        sumDiffPct += a.diffPct;
        diffs.push(a.diffPct);
        totalDiffKr += a.diffKr;
        if (a.diffKr > 0) rexW++; else if (a.diffKr < 0) ahlW++;

        ahlGroupCount[a.ahlGrp] = (ahlGroupCount[a.ahlGrp] || 0) + 1;
        rexGroupCount[a.rexGrp] = (rexGroupCount[a.rexGrp] || 0) + 1;
    });

    // Average
    const avg = (sumDiffPct / n).toFixed(2);
    const avgEl = document.getElementById('fs-avg-diff');
    avgEl.textContent = avg + '%';
    avgEl.className = 'fs-value ' + (avg > 0 ? 'positive' : 'negative');

    // Median
    diffs.sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const median = (n % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid]).toFixed(2);
    const medEl = document.getElementById('fs-median-diff');
    medEl.textContent = median + '%';
    medEl.className = 'fs-value ' + (median > 0 ? 'positive' : 'negative');

    document.getElementById('fs-ahl-wins').textContent = ahlW.toLocaleString('sv-SE');
    document.getElementById('fs-rex-wins').textContent = rexW.toLocaleString('sv-SE');

    // Total merkostnad (positive = Ahlsell dyrare, show absolute)
    const tkEl = document.getElementById('fs-total-kr');
    tkEl.textContent = totalDiffKr.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' kr';
    tkEl.className = 'fs-value ' + (totalDiffKr > 0 ? 'positive' : 'negative');

    // Per-supplier group stats
    const buildGroupStats = (articles, grpKey) => {
        const groups = {};
        articles.forEach(a => {
            const grp = a[grpKey];
            if (!groups[grp]) groups[grp] = { count: 0, sumDiffKr: 0, sumDiffPct: 0 };
            groups[grp].count++;
            groups[grp].sumDiffKr += a.diffKr;
            groups[grp].sumDiffPct += a.diffPct;
        });
        for (const g of Object.values(groups)) g.avgPct = g.sumDiffPct / g.count;
        return groups;
    };

    const ahlStats = buildGroupStats(articles, 'ahlGrp');
    const rexStats = buildGroupStats(articles, 'rexGrp');

    const renderGroupTags = (containerId, entries) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        entries.forEach(([grp, s]) => {
            const cls = s.avgPct > 0 ? 'positive' : 'negative';
            const tag = document.createElement('div');
            tag.className = 'fs-group-tag clickable';
            tag.title = `Klicka för att filtrera på ${grp}`;
            tag.innerHTML = `
                <strong>${grp}</strong>
                <span>${s.count} art.</span>
                <span class="${cls}">${s.avgPct.toFixed(1)}%</span>
                <span>${s.sumDiffKr.toFixed(0)} kr</span>
            `;
            tag.addEventListener('click', () => {
                document.getElementById('f-group').value = grp;
                applyFilters();
            });
            container.appendChild(tag);
        });
    };

    // Ahlsell: only groups where Rexel is cheaper (avgPct > 0 = Ahlsell dyrare)
    const ahlLosing = Object.entries(ahlStats).filter(([, s]) => s.avgPct > 0);
    const ahlByCount = ahlLosing.sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    const ahlByKr = [...ahlLosing].sort((a, b) => b[1].sumDiffKr - a[1].sumDiffKr).slice(0, 5);
    renderGroupTags('fs-ahl-top-count', ahlByCount);
    renderGroupTags('fs-ahl-top-kr', ahlByKr);

    // Rexel: only groups where Ahlsell is cheaper (avgPct < 0 = Rexel dyrare)
    const rexLosing = Object.entries(rexStats).filter(([, s]) => s.avgPct < 0);
    const rexByCount = rexLosing.sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    const rexByKr = [...rexLosing].sort((a, b) => a[1].sumDiffKr - b[1].sumDiffKr).slice(0, 5);
    renderGroupTags('fs-rex-top-count', rexByCount);
    renderGroupTags('fs-rex-top-kr', rexByKr);
}

// === Rendering ===
let referensEnr = [];

function renderDashboard() {
    dashboard.classList.remove('hidden');
    buildCategoryCheckboxes();
    setupFilterListeners();
    setupDebugSearch();
    applyFilters();
    loadReferensMall();
}

let filtersInitialized = false;
function setupFilterListeners() {
    if (filtersInitialized) return;
    filtersInitialized = true;

    // Apply on button click
    document.getElementById('btn-apply-filters').addEventListener('click', applyFilters);

    // Also apply on Enter key in any filter input
    document.querySelectorAll('.filter-row input, .filter-row select').forEach(el => {
        el.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
    });

    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        ['f-enr-from', 'f-enr-to', 'f-diff-min', 'f-diff-max', 'f-group', 'f-lookup-enr'].forEach(id => {
            document.getElementById(id).value = '';
        });
        document.getElementById('f-cheapest').selectedIndex = 0;
        document.querySelectorAll('.cat-l1-cb, .cat-l2-cb').forEach(cb => {
            cb.checked = false;
            cb.indeterminate = false;
        });
        applyFilters();
    });

    // E-nummer group lookup
    document.getElementById('btn-lookup-enr').addEventListener('click', lookupEnrGroups);
    document.getElementById('f-lookup-enr').addEventListener('keydown', e => {
        if (e.key === 'Enter') lookupEnrGroups();
    });
}

function lookupEnrGroups() {
    const enr = document.getElementById('f-lookup-enr').value.trim();
    if (!enr) return;
    const data = items[enr];
    if (!data) {
        alert(`E-nummer ${enr} hittades inte.`);
        return;
    }
    const groups = new Set();
    if (data.ahl) groups.add(data.ahl.grp);
    if (data.rex) groups.add(data.rex.grp);
    if (groups.size === 0) {
        alert(`Inga rabattgrupper hittades för ${enr}.`);
        return;
    }
    document.getElementById('f-group').value = [...groups].join(', ');
    applyFilters();
}

function buildCategoryCheckboxes() {
    const container = document.getElementById('cat-checkboxes');
    container.innerHTML = '';

    for (let i = 0; i < 100; i += 10) {
        const from = String(i).padStart(2, '0');
        const to = String(i + 9).padStart(2, '0');
        const groupId = `cat-g-${i}`;

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
                // Update parent state
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

const MAX_RENDER = 500; // cap rows for performance

function renderArticleTable(articles) {
    const tbody = document.querySelector('#table-articles tbody');
    tbody.innerHTML = '';

    const toRender = articles.slice(0, MAX_RENDER);
    const fragment = document.createDocumentFragment();

    toRender.forEach(a => {
        const tr = document.createElement('tr');
        const cls = a.diffPct > 0.01 ? 'positive' : (a.diffPct < -0.01 ? 'negative' : '');
        tr.innerHTML = `
            <td>${a.enr}</td>
            <td>${a.ahlNet.toFixed(2)}</td>
            <td>${a.rexNet.toFixed(2)}</td>
            <td class="${cls}">${a.diffKr.toFixed(2)}</td>
            <td class="${cls}">${a.diffPct.toFixed(2)}%</td>
            <td>${a.ahlGrp}</td>
            <td>${a.rexGrp}</td>
            <td>${a.unit}</td>
        `;
        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);

    if (articles.length > MAX_RENDER) {
        document.getElementById('filter-count').textContent +=
            ` (visar max ${MAX_RENDER}, filtrera för fler)`;
    }
}

// === Debug Search ===
let debugSearchInitialized = false;
let debugTimer = null;
function setupDebugSearch() {
    if (debugSearchInitialized) return;
    debugSearchInitialized = true;

    const searchInput = document.getElementById('debug-search');
    searchInput.oninput = () => {
        clearTimeout(debugTimer);
        debugTimer = setTimeout(renderDebugSearch, 250);
    };
    renderDebugSearch();
}

function renderDebugSearch() {
    const tbody = document.querySelector('#table-debug tbody');
    tbody.innerHTML = '';
    const query = (document.getElementById('debug-search').value || '').trim();
    if (!query) {
        DEBUG_IDS.forEach(id => renderDebugRow(id, tbody));
        return;
    }
    const matches = Object.keys(items).filter(enr => enr.includes(query)).slice(0, 20);
    matches.forEach(enr => renderDebugRow(enr, tbody));
}

function renderDebugRow(enr, tbody) {
    const data = items[enr];
    if (!data) return;
    ['ahl', 'rex'].forEach(key => {
        if (!data[key]) return;
        const d = data[key];
        const supplier = key === 'ahl' ? 'Ahlsell' : 'Rexel';
        const discStr = d.disc !== null ? d.disc.toFixed(1) + '%' : 'Saknas';
        const netStr = d.net !== null ? d.net.toFixed(2) : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${enr}</td>
            <td>${supplier}</td>
            <td>${d.list.toFixed(2)}</td>
            <td>${d.grp}</td>
            <td>${discStr}</td>
            <td>${d.unit || ''}</td>
            <td>${netStr}</td>
        `;
        tbody.appendChild(tr);
    });
}

// === Referensmall ===
let referensInitialized = false;
function loadReferensMall() {
    fetch('referens_enummer.json')
        .then(r => r.json())
        .then(data => {
            referensEnr = data;
            if (!referensInitialized) {
                referensInitialized = true;
                document.getElementById('btn-ref-direct').addEventListener('click', showRefDirect);
                document.getElementById('btn-ref-groups').addEventListener('click', showRefGroups);
            }
        })
        .catch(e => console.warn('Referens-fil saknas:', e));
}

function showRefDirect() {
    const refSet = new Set(referensEnr);
    const refArticles = matchedArticles.filter(a => refSet.has(a.enr));
    renderRefResults('Referensartiklar (direkt matchning)', refArticles);
}

function showRefGroups() {
    const groups = new Set();
    referensEnr.forEach(enr => {
        const d = items[enr];
        if (d && d.ahl) groups.add(d.ahl.grp);
        if (d && d.rex) groups.add(d.rex.grp);
    });
    const groupArr = [...groups];
    const refArticles = matchedArticles.filter(a =>
        groupArr.includes(a.ahlGrp) || groupArr.includes(a.rexGrp)
    );
    renderRefResults(`Via rabattgrupper (${groupArr.length} grupper fr\u00e5n ${referensEnr.length} E-nr)`, refArticles);
}

function renderRefResults(title, articles) {
    document.getElementById('ref-summary').style.display = 'block';
    document.getElementById('ref-table-wrap').style.display = 'block';
    document.getElementById('ref-title').textContent = title;

    const n = articles.length;
    const statsEl = document.getElementById('ref-stats');

    if (n === 0) {
        statsEl.innerHTML = '<p>Inga matchande artiklar.</p>';
        document.querySelector('#ref-table tbody').innerHTML = '';
        document.getElementById('ref-ahl-groups').innerHTML = '';
        document.getElementById('ref-rex-groups').innerHTML = '';
        return;
    }

    let sumPct = 0, ahlW = 0, rexW = 0, totalKr = 0;
    const diffs = [];
    const ahlGC = {}, rexGC = {};

    articles.forEach(a => {
        sumPct += a.diffPct;
        diffs.push(a.diffPct);
        totalKr += a.diffKr;
        if (a.diffKr > 0) rexW++; else if (a.diffKr < 0) ahlW++;
        ahlGC[a.ahlGrp] = (ahlGC[a.ahlGrp] || 0) + 1;
        rexGC[a.rexGrp] = (rexGC[a.rexGrp] || 0) + 1;
    });

    const avg = (sumPct / n).toFixed(2);
    diffs.sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const median = (n % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid]).toFixed(2);

    statsEl.innerHTML = `
        <div class="fs-stat"><span class="fs-label">Artiklar</span><span class="fs-value">${n.toLocaleString('sv-SE')}</span></div>
        <div class="fs-stat"><span class="fs-label">Snitt diff</span><span class="fs-value ${avg > 0 ? 'positive' : 'negative'}">${avg}%</span></div>
        <div class="fs-stat"><span class="fs-label">Median diff</span><span class="fs-value ${median > 0 ? 'positive' : 'negative'}">${median}%</span></div>
        <div class="fs-stat"><span class="fs-label">Ahlsell billigare</span><span class="fs-value" style="color:var(--success)">${ahlW}</span></div>
        <div class="fs-stat"><span class="fs-label">Rexel billigare</span><span class="fs-value" style="color:var(--accent)">${rexW}</span></div>
        <div class="fs-stat"><span class="fs-label">Total diff</span><span class="fs-value ${totalKr > 0 ? 'positive' : 'negative'}">${totalKr.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} kr</span></div>
    `;

    // Group analysis
    const buildGrp = (articles, key) => {
        const stats = {};
        articles.forEach(a => {
            const grp = a[key];
            if (!stats[grp]) stats[grp] = { count: 0, sumDiffKr: 0, sumDiffPct: 0 };
            stats[grp].count++;
            stats[grp].sumDiffKr += a.diffKr;
            stats[grp].sumDiffPct += a.diffPct;
        });
        for (const g of Object.values(stats)) g.avgPct = g.sumDiffPct / g.count;
        return stats;
    };

    const renderTags = (containerId, entries) => {
        const c = document.getElementById(containerId);
        c.innerHTML = '';
        entries.forEach(([grp, s]) => {
            const cls = s.avgPct > 0 ? 'positive' : 'negative';
            const tag = document.createElement('div');
            tag.className = 'fs-group-tag clickable';
            tag.title = `Klicka f\u00f6r att filtrera p\u00e5 ${grp}`;
            tag.innerHTML = `<strong>${grp}</strong><span>${s.count} art.</span><span class="${cls}">${s.avgPct.toFixed(1)}%</span><span>${s.sumDiffKr.toFixed(0)} kr</span>`;
            tag.addEventListener('click', () => {
                document.getElementById('f-group').value = grp;
                applyFilters();
                document.getElementById('filtered-summary').scrollIntoView({ behavior: 'smooth' });
            });
            c.appendChild(tag);
        });
    };

    const ahlS = buildGrp(articles, 'ahlGrp');
    const rexS = buildGrp(articles, 'rexGrp');

    const ahlLosing = Object.entries(ahlS).filter(([, s]) => s.avgPct > 0).sort((a, b) => b[1].sumDiffKr - a[1].sumDiffKr).slice(0, 5);
    const rexLosing = Object.entries(rexS).filter(([, s]) => s.avgPct < 0).sort((a, b) => a[1].sumDiffKr - b[1].sumDiffKr).slice(0, 5);
    renderTags('ref-ahl-groups', ahlLosing);
    renderTags('ref-rex-groups', rexLosing);

    // Render table
    const tbody = document.querySelector('#ref-table tbody');
    tbody.innerHTML = '';
    const sorted = [...articles].sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
    const frag = document.createDocumentFragment();
    sorted.slice(0, MAX_RENDER).forEach(a => {
        const tr = document.createElement('tr');
        const cls = a.diffPct > 0.01 ? 'positive' : (a.diffPct < -0.01 ? 'negative' : '');
        tr.innerHTML = `
            <td>${a.enr}</td>
            <td>${a.ahlNet.toFixed(2)}</td>
            <td>${a.rexNet.toFixed(2)}</td>
            <td class="${cls}">${a.diffKr.toFixed(2)}</td>
            <td class="${cls}">${a.diffPct.toFixed(2)}%</td>
            <td>${a.ahlGrp}</td>
            <td>${a.rexGrp}</td>
            <td>${a.unit}</td>
        `;
        frag.appendChild(tr);
    });
    tbody.appendChild(frag);
}
