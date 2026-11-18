import { MAX_LISTING_SPREAD, parseEvidenceFile, storeEvidence, validateEvidence, type EvidenceRow } from '../utils/priceEvidence';

const listing = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  category: 'shoes',
  product_type: 'spike',
  region: 'overseas',
  price_kind: 'listing',
  price_min: 21.69,
  price_max: 22.58,
  currency: 'USD',
  moq: 50,
  trade_terms: 'FOB',
  source_url: 'https://www.globalsources.com/category/golf-shoes-for-sale-price_21070/',
  source_title: 'New Style Microfiber Leather Golf Shoes',
  collected_at: '2026-11-17',
  status: 'approved',
  ...extra
});

describe('validateEvidence', () => {
  it('accepts a complete listing and fills the defaults: pair, unknown supplier, empty optional fields', () => {
    const { row, errors } = validateEvidence(listing());

    expect(errors).toEqual([]);
    expect(row).toMatchObject({ unit: 'pair', supplier_type: 'unknown', moq: 50, price_date: null, note: null, outsole: null });
  });

  it('takes the frame and the lens of a sunglasses row (migration 024), each empty when not named', () => {
    const sunglasses = listing({ category: 'sunglasses', product_type: 'golf_sunglasses', unit: 'piece', frame_material: 'plastic', lens_type: 'polarized' });

    expect(validateEvidence(sunglasses).row).toMatchObject({ unit: 'piece', frame_material: 'plastic', lens_type: 'polarized' });
    expect(validateEvidence(listing()).row).toMatchObject({ frame_material: null, lens_type: null });
  });

  it('rejects a row that is not an object, unknown fields (typos) and missing required fields', () => {
    expect(validateEvidence('x').errors).toEqual(['a row must be an object']);
    expect(validateEvidence(listing({ price_mim: 1 })).errors).toContain('unknown field "price_mim"');
    expect(validateEvidence({}).errors).toEqual(expect.arrayContaining(['category is required', 'source_title is required']));
  });

  it('rejects prices that are not numbers above 0, or a top price below the bottom price', () => {
    expect(validateEvidence(listing({ price_min: '21' })).errors).toContain('price_min must be a number above 0');
    expect(validateEvidence(listing({ price_min: 0 })).errors).toContain('price_min must be a number above 0');
    expect(validateEvidence(listing({ price_min: 30, price_max: 20 })).errors).toContain('price_max is below price_min');
  });

  it('rejects a listing range that is too wide to be a price, but not a wide quote', () => {
    expect(MAX_LISTING_SPREAD).toBe(1.35);
    expect(validateEvidence(listing({ price_min: 2.54, price_max: 79.71 })).errors[0]).toContain('not a price');
    expect(validateEvidence(listing({ price_min: 20, price_max: 27 })).errors).toEqual([]);
    expect(validateEvidence(listing({ price_kind: 'quote', price_min: 20, price_max: 60, source_url: null })).errors).toEqual([]);
  });

  it('needs a web address unless the row is a real quote, and the address must be http or https', () => {
    expect(validateEvidence(listing({ source_url: null })).errors).toContain('source_url is required unless the row is a real quote');
    expect(validateEvidence(listing({ source_url: 'ftp://example.com/a' })).errors).toContain('source_url must start with http:// or https://');
    expect(validateEvidence(listing({ source_url: 'not a url' })).errors).toContain('source_url is not a web address');
    expect(validateEvidence(listing({ price_kind: 'quote', source_url: null })).errors).toEqual([]);
  });

  it('checks the kinds, the currency, the dates and the minimum order', () => {
    expect(validateEvidence(listing({ region: 'mars' })).errors[0]).toContain('region must be one of');
    expect(validateEvidence(listing({ currency: 'EUR' })).errors[0]).toContain('currency must be one of');
    expect(validateEvidence(listing({ collected_at: '2026-02-30' })).errors).toContain('collected_at must be a date like 2026-11-17');
    expect(validateEvidence(listing({ collected_at: undefined })).errors).toContain('collected_at must be a date like 2026-11-17');
    expect(validateEvidence(listing({ price_date: '17/11/2026' })).errors).toContain('price_date must be a date like 2026-11-17');
    expect(validateEvidence(listing({ moq: 1.5 })).errors).toContain('moq must be a whole number above 0');
    expect(validateEvidence(listing({ moq: 0 })).errors).toContain('moq must be a whole number above 0');
  });

  it('keeps retail prices as retail (a reference), not as OEM prices', () => {
    const { row } = validateEvidence(listing({ price_kind: 'retail', region: 'domestic', currency: 'KRW', price_min: 209990, price_max: 209990 }));

    expect(row?.price_kind).toBe('retail');
  });
});

describe('parseEvidenceFile', () => {
  it('takes the approved rows, skips candidates and rejected rows, and reports invalid rows by their number', () => {
    const text = JSON.stringify([
      listing(),
      listing({ status: 'candidate', source_title: 'b' }),
      listing({ status: 'rejected', source_title: 'c' }),
      listing({ price_min: 'x', source_title: 'd' })
    ]);
    const result = parseEvidenceFile(text);

    expect(result.approved).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.problems).toEqual(['row 4: price_min must be a number above 0']);
  });

  it('reports a file that is not JSON or not an array', () => {
    expect(parseEvidenceFile('{').problems).toEqual(['the file is not valid JSON']);
    expect(parseEvidenceFile('{}').problems).toEqual(['the file must be a JSON array of rows']);
  });
});

describe('storeEvidence', () => {
  const row = validateEvidence(listing()).row as EvidenceRow;

  it('inserts each row as approved, in the order of the columns, and leaves a row that is already there alone', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return { rowCount: calls.length === 1 ? 1 : 0 };
      }
    };

    const result = await storeEvidence(db, [row, row]);

    expect(result).toEqual({ stored: 1, duplicates: 1 });
    expect(calls[0].sql).toContain('INSERT INTO price_evidence');
    expect(calls[0].sql).toContain("'approved', CURRENT_TIMESTAMP");
    expect(calls[0].sql).toContain('ON CONFLICT');
    expect(calls[0].sql).toContain('DO NOTHING');
    expect(calls[0].values).toHaveLength(22);
    expect(calls[0].values.slice(0, 6)).toEqual(['shoes', 'spike', 'overseas', 'listing', 21.69, 22.58]);
  });
});
