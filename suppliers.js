// suppliers.js — Supplier registry with auto-detection and parsing logic
// Each supplier is a config object. Adding a new supplier = adding one object.

const SUPPLIERS = {
    ahlsell: {
        id: 'ahlsell',
        name: 'Ahlsell',
        color: '#E63946',
        colorLight: '#fce4e6',
        icon: 'A',
        gnpFile: 'ahlsell_gnp.txt',

        // Ahlsell agreement files are fixed-width with lines ≥ 40 chars
        detectAgreement(content) {
            const lines = content.split('\n').filter(l => l.length > 30);
            if (lines.length < 5) return false;
            // Ahlsell files are fixed-width (no semicolons), with numeric chars at positions 37-42
            const hasSemicolons = lines.slice(0, 10).some(l => l.includes(';'));
            if (hasSemicolons) return false;
            // Check that most lines are ≥ 40 chars (fixed-width)
            const longLines = lines.filter(l => l.length >= 40).length;
            return longLines / lines.length > 0.8;
        },

        parseGNP(content) {
            const articles = new Map(); // artNo → { list, grp, unit }
            const lines = content.split('\n');
            // Fixed-width positions (0-indexed): art=0-7, price=20-32, grp=32-38, unit=38-41
            const aStart = 0, aEnd = 7;
            const pStart = 20, pEnd = 32;
            const gStart = 32, gEnd = 38;
            const uStart = 38, uEnd = 41;
            const priceDec = 2;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.length < 10) continue;
                const artNo = line.substring(aStart, aEnd).trim().replace(/\s/g, '');
                const priceStr = line.substring(pStart, pEnd).trim().replace(',', '.');
                const grp = line.substring(gStart, gEnd).trim();
                const unit = line.length >= uEnd ? line.substring(uStart, uEnd).trim() : '';
                const price = parseFloat(priceStr) / Math.pow(10, priceDec);

                if (artNo && !isNaN(price) && price > 0) {
                    articles.set(artNo, { list: price, grp, unit });
                }
            }
            return articles;
        },

        parseAgreement(content) {
            const discMap = new Map(); // grp → discount%
            const lines = content.split('\n');
            // Fixed-width positions (0-indexed): grp=30-36, disc=36-42
            const gStart = 30, gEnd = 36;
            const dStart = 36, dEnd = 42;
            const discDec = 3;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.length < 40) continue;
                const grp = line.substring(gStart, gEnd).trim();
                const discStr = line.substring(dStart, dEnd).trim().replace(',', '.');
                const disc = parseFloat(discStr) / Math.pow(10, discDec);
                if (grp && !isNaN(disc)) {
                    discMap.set(grp, disc);
                }
            }
            return discMap;
        }
    },

    rexel: {
        id: 'rexel',
        name: 'Rexel',
        color: '#457B9D',
        colorLight: '#dbeaf3',
        icon: 'R',
        gnpFile: 'rexel_gnp.txt',

        detectAgreement(content) {
            const lines = content.split('\n').filter(l => l.trim().length > 0);
            if (lines.length < 3) return false;
            // Rexel files are semicolon-delimited
            const semiLines = lines.slice(0, 10).filter(l => l.includes(';'));
            return semiLines.length / Math.min(lines.length, 10) > 0.7;
        },

        parseGNP(content) {
            const articles = new Map(); // artNo → { list, grp, unit }
            const lines = content.split('\n');
            const sep = ';';
            const idxArt = 0, idxUnit = 2, idxGrp = 3, idxPrice = 4;
            const priceDec = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                const parts = line.split(sep);
                if (parts.length <= Math.max(idxArt, idxPrice, idxGrp)) continue;

                const artNo = parts[idxArt].trim().replace(/\s/g, '');
                const grp = parts[idxGrp].trim();
                const unit = parts[idxUnit] ? parts[idxUnit].trim() : '';
                const priceStr = parts[idxPrice].trim().replace(',', '.');
                const price = parseFloat(priceStr) / Math.pow(10, priceDec);

                if (artNo && !isNaN(price) && price > 0) {
                    articles.set(artNo, { list: price, grp, unit });
                }
            }
            return articles;
        },

        parseAgreement(content) {
            const discMap = new Map(); // grp → discount%
            const lines = content.split('\n');
            const sep = ';';
            const idxGrp = 0, idxDisc = 1;
            const discDec = 1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                const parts = line.split(sep);
                const grp = parts[idxGrp]?.trim();
                const discStr = parts[idxDisc]?.trim()?.replace(',', '.');
                if (grp && discStr) {
                    discMap.set(grp, parseFloat(discStr) / Math.pow(10, discDec));
                }
            }
            return discMap;
        }
    }
};

// Auto-detect which supplier an agreement file belongs to
function detectSupplier(content) {
    for (const [id, supplier] of Object.entries(SUPPLIERS)) {
        if (supplier.detectAgreement(content)) return id;
    }
    return null;
}

export { SUPPLIERS, detectSupplier };
