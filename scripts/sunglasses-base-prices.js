// Computes the base price of each sunglasses frame material from the factory prices listed in
// docs/pricing/sunglasses-factory-prices-*.json: the median of the listings that pass the filters
// below, in USD and converted to KRW at the rate stored in the data file.
//
//   node scripts/sunglasses-base-prices.js [data-file] [--rate=1330.79] [--json]
//
// It reads a file and prints; it touches no database. The result is what migration
// 014_sunglasses_base_prices.ts puts into base_prices (check that the two agree after a change).
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'docs', 'pricing', 'sunglasses-factory-prices-2026-10-20.json');

// A listing is kept only when it looks like a factory price for adult sunglasses of one material.
const RULES = {
    minMoq: 6,                 // MOQ 1-5 are retail shops, not factories
    maxSpread: 3,              // price high / low; wider ranges are not a price for one product
    maxPerSupplier: 2,         // one factory must not decide the median alone
    excludeWords: /\b(kids?|child(?:ren)?'?s?|baby|party|pinhole|clover|shamrock|replicas?|magnet(?:ic)?|clip[- ]?on|clip)\b/i,
    material: {
        plastic: { need: /\bplastic\b|\bPC\b/i, forbid: /metal|stainless|acetate|wood|bamboo|tr90|nylon frame/i },
        metal: { need: /metal|stainless/i, forbid: /acetate|wood|bamboo|plastic|\bPC\b/i },
        acetate: { need: /acetate/i, forbid: /metal|stainless|wood|bamboo|tr90|plastic|\bPC\b/i },
        wood: { need: /\bwood(?:en)?\b|bamboo/i, forbid: /acetate|metal|plastic|\btr90\b|grain|effect|imitation|pattern|temples?\b/i },
        mixed: { need: /acetate/i, also: /metal|stainless/i, forbid: /plastic|\bPC\b|wood|bamboo/i }
    }
};

// The variant name in base_prices (config/sunglassesPricingRules.ts) of each material.
const VARIANTS = {
    plastic: 'Plastic Frame',
    metal: 'Metal Frame',
    acetate: 'Acetate Frame',
    wood: 'Wood Frame',
    mixed: 'Mixed Frame'
};

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function passes(material, row) {
    const [title, low, high, moq] = row;
    const rule = RULES.material[material];
    if (!(moq >= RULES.minMoq) || !(low > 0) || high / low > RULES.maxSpread) {
        return false;
    }
    if (RULES.excludeWords.test(title)) {
        return false;
    }
    if (!rule.need.test(title) || rule.forbid.test(title)) {
        return false;
    }
    return !rule.also || rule.also.test(title);
}

function pick(material, rows) {
    const perSupplier = {};
    const kept = [];
    rows.forEach(row => {
        if (!passes(material, row)) {
            return;
        }
        const supplier = row[4];
        perSupplier[supplier] = (perSupplier[supplier] || 0) + 1;
        if (perSupplier[supplier] <= RULES.maxPerSupplier) {
            kept.push(row);
        }
    });
    return kept;
}

// Rounded to 10 won: the figures are not more exact than that.
function toKrw(usd, rate) {
    return Math.round((usd * rate) / 10) * 10;
}

function compute(data, rate) {
    const result = {};
    Object.keys(VARIANTS).forEach(material => {
        const rows = data.listings[material] || [];
        const kept = pick(material, rows);
        // The price of one listing is the middle of its range: the low end is the largest tier, the
        // high end the MOQ tier.
        const usd = kept.map(row => (row[1] + row[2]) / 2);
        const mid = usd.length > 0 ? median(usd) : null;
        result[material] = {
            variant: VARIANTS[material],
            listings_read: rows.length,
            listings_used: kept.length,
            usd_min: usd.length ? Math.min.apply(null, usd) : null,
            usd_median: mid,
            usd_max: usd.length ? Math.max.apply(null, usd) : null,
            krw_median: mid === null ? null : toKrw(mid, rate)
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
    Object.keys(result).forEach(material => {
        const r = result[material];
        process.stdout.write(
            [material.padEnd(8), r.variant.padEnd(14), ('used ' + r.listings_used + '/' + r.listings_read).padEnd(10),
                r.usd_median === null ? 'no data' : '$' + r.usd_median.toFixed(2) + ' (' + r.usd_min.toFixed(2) + '-' + r.usd_max.toFixed(2) + ')  ->  ' + r.krw_median.toLocaleString('en-US') + ' KRW'].join('  ') + '\n'
        );
    });
}

if (require.main === module) {
    main(process.argv);
}

module.exports = { RULES, VARIANTS, compute, passes, pick, median, toKrw };
