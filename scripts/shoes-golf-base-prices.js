// Computes the base price of each shoe type and each golf tee material from the factory prices listed in
// docs/pricing/shoes-golf-factory-prices-*.json: the median of the listings that pass the filters below,
// in USD and converted to KRW at the rate stored in the data file. The same method as the sunglasses
// (scripts/sunglasses-base-prices.js).
//
//   node scripts/shoes-golf-base-prices.js [data-file] [--rate=1323.9] [--json]
//
// It reads a file and prints; it touches no database. The result is what migration
// 020_shoes_golf_tee_base_prices.ts puts into base_prices (a test checks that the two agree).
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'docs', 'pricing', 'shoes-golf-factory-prices-2026-10-26.json');

// A listing is kept only when it looks like a factory price for an adult product of the kind.
const COMMON_EXCLUDE = /\b(kids?|child(?:ren)?'?s?|toddler|baby|girls?|boys?|hotel|disposable|amenities|safety|steel|rain|pvc|rescue|firefight\w*)\b/i;

const RULES = {
    // MOQ: pairs for shoes, pieces for tees. Below this the listing is a retail shop, not a factory.
    sneakers: { variant: 'Sneakers', category: 'shoes', minMoq: 100, maxSpread: 3, maxPerSupplier: 2 },
    heels: { variant: 'Heels', category: 'shoes', minMoq: 100, maxSpread: 3, maxPerSupplier: 2 },
    mens: { variant: 'Mens Dress', category: 'shoes', minMoq: 100, maxSpread: 3, maxPerSupplier: 2 },
    boots: { variant: 'Boots', category: 'shoes', minMoq: 100, maxSpread: 3, maxPerSupplier: 2 },
    sandals: { variant: 'Sandals', category: 'shoes', minMoq: 100, maxSpread: 3, maxPerSupplier: 2 },
    // Tees are sold by the thousand; a tee listing with a MOQ in the tens is a novelty item.
    tee_wood: { variant: 'Wood Tee', category: 'golf_products', minMoq: 500, maxSpread: 6, maxPerSupplier: 2, need: /wood/i, forbid: /bamboo|plastic/i },
    tee_bamboo: { variant: 'Bamboo Tee', category: 'golf_products', minMoq: 500, maxSpread: 6, maxPerSupplier: 2, need: /bamboo/i, forbid: /plastic|wood/i },
    tee_plastic: { variant: 'Plastic Tee', category: 'golf_products', minMoq: 500, maxSpread: 6, maxPerSupplier: 2, need: /plastic/i, forbid: /bamboo|wood/i }
};

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function passes(rule, row) {
    const [title, low, high, moq] = row;
    if (!(moq >= rule.minMoq) || !(low > 0) || high / low > rule.maxSpread) {
        return false;
    }
    if (COMMON_EXCLUDE.test(title)) {
        return false;
    }
    if (rule.need && !rule.need.test(title)) {
        return false;
    }
    return !(rule.forbid && rule.forbid.test(title));
}

function pick(rule, rows) {
    const perSupplier = {};
    const kept = [];
    rows.forEach(row => {
        if (!passes(rule, row)) {
            return;
        }
        const supplier = row[4];
        perSupplier[supplier] = (perSupplier[supplier] || 0) + 1;
        if (perSupplier[supplier] <= rule.maxPerSupplier) {
            kept.push(row);
        }
    });
    return kept;
}

// Shoes: rounded to 10 won (as the sunglasses). A golf tee costs a few ten won, so it is rounded to 0.1 won.
function toKrw(usd, rate, category) {
    return category === 'golf_products' ? Math.round(usd * rate * 10) / 10 : Math.round((usd * rate) / 10) * 10;
}

function compute(data, rate) {
    const result = {};
    Object.keys(RULES).forEach(key => {
        const rule = RULES[key];
        const rows = data.listings[key] || [];
        const kept = pick(rule, rows);
        const suppliers = new Set(kept.map(row => row[4])).size;
        // The price of one listing is the middle of its range: the low end is the largest tier, the high end the MOQ tier.
        const usd = kept.map(row => (row[1] + row[2]) / 2);
        const mid = usd.length > 0 ? median(usd) : null;
        result[key] = {
            category: rule.category,
            variant: rule.variant,
            listings_read: rows.length,
            listings_used: kept.length,
            suppliers_used: suppliers,
            usd_min: usd.length ? Math.min.apply(null, usd) : null,
            usd_median: mid,
            usd_max: usd.length ? Math.max.apply(null, usd) : null,
            krw_median: mid === null ? null : toKrw(mid, rate, rule.category)
        };
    });
    return result;
}

function main(argv) {
    const args = argv.slice(2);
    const file = args.find(arg => !arg.startsWith('--')) || DEFAULT_FILE;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rateArg = args.find(arg => arg.startsWith('--rate='));
    const rate = rateArg ? Number(rateArg.slice('--rate='.length)) : data.meta.usd_krw;
    if (!(rate > 0)) {
        throw new Error('The exchange rate must be a positive number');
    }
    const result = compute(data, rate);

    if (args.includes('--json')) {
        process.stdout.write(JSON.stringify({ retrieved: data.meta.retrieved, usd_krw: rate, result: result }, null, 2) + '\n');
        return;
    }
    process.stdout.write('USD/KRW ' + rate + ' (' + data.meta.retrieved + ')\n');
    Object.keys(result).forEach(key => {
        const r = result[key];
        process.stdout.write(
            [key.padEnd(12), r.variant.padEnd(12), ('used ' + r.listings_used + '/' + r.listings_read + ' of ' + r.suppliers_used + ' suppliers').padEnd(30),
                r.usd_median === null ? 'no data' : '$' + r.usd_median.toFixed(4) + ' (' + r.usd_min.toFixed(4) + '-' + r.usd_max.toFixed(4) + ')  ->  ' + r.krw_median.toLocaleString('en-US') + ' KRW'].join('  ') + '\n'
        );
    });
}

if (require.main === module) {
    main(process.argv);
}

module.exports = { RULES, COMMON_EXCLUDE, compute, passes, pick, median, toKrw };
