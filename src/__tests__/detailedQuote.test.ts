import { QUOTE_LIMITS, isRealDate, missingContact, parseQuoteInput, priceItems, todayInKorea } from '../utils/detailedQuote';

const TODAY = '2026-10-21';
const good = (over: Record<string, unknown> = {}) => ({
  items: [{ name: '선글라스 아세테이트 프레임', quantity: 500, unit_price: 12000 }],
  fx_currency: 'USD',
  fx_rate: 1330.79,
  valid_until: '2026-11-20',
  lead_time: '주문 후 약 6주',
  customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.',
  contact_name: '김담당',
  contact_email: 'Staff@Bridgepath.co.kr',
  contact_phone: '010-1234-5678',
  ...over
});
const errorsOf = (body: unknown): string[] => {
  const result = parseQuoteInput(body, TODAY);
  return result.valid ? [] : result.errors.map(e => e.field);
};

describe('priceItems', () => {
  it('counts every amount and the total from quantity x unit price', () => {
    expect(
      priceItems([
        { name: 'a', quantity: 500, unit_price: 12000 },
        { name: 'b', quantity: 2, unit_price: 0 },
        { name: 'c', quantity: 1, unit_price: 350 }
      ])
    ).toEqual({
      items: [
        { name: 'a', quantity: 500, unit_price: 12000, amount: 6000000 },
        { name: 'b', quantity: 2, unit_price: 0, amount: 0 },
        { name: 'c', quantity: 1, unit_price: 350, amount: 350 }
      ],
      total: 6000350
    });
  });
});

describe('parseQuoteInput', () => {
  it('accepts a complete quote and trims the texts', () => {
    const result = parseQuoteInput(good({ lead_time: '  주문 후 약 6주 ', expected_edit_seq: 3 }), TODAY);

    expect(result).toEqual({
      valid: true,
      value: {
        items: [{ name: '선글라스 아세테이트 프레임', quantity: 500, unit_price: 12000 }],
        fx_currency: 'USD',
        fx_rate: 1330.79,
        valid_until: '2026-11-20',
        lead_time: '주문 후 약 6주',
        customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.',
        contact_name: '김담당',
        contact_email: 'staff@bridgepath.co.kr',
        contact_phone: '010-1234-5678',
        expected_edit_seq: 3
      }
    });
  });

  it('needs only the items: the rest is optional and comes back as null', () => {
    const result = parseQuoteInput({ items: [{ name: 'a', quantity: 1, unit_price: 100 }] }, TODAY);

    expect(result).toEqual({
      valid: true,
      value: {
        items: [{ name: 'a', quantity: 1, unit_price: 100 }],
        fx_currency: null, fx_rate: null, valid_until: null, lead_time: null, customer_note: null,
        contact_name: null, contact_email: null, contact_phone: null, expected_edit_seq: null
      }
    });
  });

  it('never takes an amount or a total from the client', () => {
    const result = parseQuoteInput(
      { items: [{ name: 'a', quantity: 2, unit_price: 100, amount: 1 }], total_amount: 1, total: 1 },
      TODAY
    );

    expect(result.valid && result.value.items).toEqual([{ name: 'a', quantity: 2, unit_price: 100 }]);
    expect(JSON.stringify(result)).not.toContain('total');
  });

  it.each([undefined, null, [], 'x', 5, { items: [] }, { items: 'x' }, { items: [null] }, { items: [[]] }])('refuses the body %j', body => {
    expect(errorsOf(body).length).toBeGreaterThan(0);
  });

  it('refuses too many items', () => {
    const items = Array.from({ length: QUOTE_LIMITS.items + 1 }, () => ({ name: 'a', quantity: 1, unit_price: 1 }));
    expect(errorsOf({ items })).toEqual(['items']);
    expect(errorsOf({ items: items.slice(1) })).toEqual([]);
  });

  it.each([
    [{ name: '' }, 'items[0].name'],
    [{ name: '   ' }, 'items[0].name'],
    [{ name: 5 }, 'items[0].name'],
    [{ name: 'a\nb' }, 'items[0].name'],
    [{ name: 'x'.repeat(QUOTE_LIMITS.nameLength + 1) }, 'items[0].name'],
    [{ quantity: 0 }, 'items[0].quantity'],
    [{ quantity: 1.5 }, 'items[0].quantity'],
    [{ quantity: '5' }, 'items[0].quantity'],
    [{ quantity: QUOTE_LIMITS.quantityMax + 1 }, 'items[0].quantity'],
    [{ unit_price: -1 }, 'items[0].unit_price'],
    [{ unit_price: 10.5 }, 'items[0].unit_price'],
    [{ unit_price: '100' }, 'items[0].unit_price'],
    [{ unit_price: QUOTE_LIMITS.unitPriceMax + 1 }, 'items[0].unit_price'],
    [{ unit_price: null }, 'items[0].unit_price']
  ])('refuses the item change %j', (change, field) => {
    expect(errorsOf({ items: [{ name: 'a', quantity: 1, unit_price: 100, ...change }] })).toEqual([field]);
  });

  it('accepts a free item (unit price 0) and the largest values', () => {
    expect(errorsOf({ items: [{ name: 'sample', quantity: 1, unit_price: 0 }] })).toEqual([]);
    expect(errorsOf({ items: [{ name: 'a', quantity: QUOTE_LIMITS.quantityMax, unit_price: QUOTE_LIMITS.unitPriceMax }] })).toEqual([]);
  });

  it('refuses a total that is too large to keep exactly', () => {
    const items = Array.from({ length: QUOTE_LIMITS.items }, () => ({
      name: 'a', quantity: QUOTE_LIMITS.quantityMax, unit_price: QUOTE_LIMITS.unitPriceMax
    }));
    expect(errorsOf({ items })).toEqual(['items']);
  });

  it('keeps the exchange rate and its currency together, with up to 4 decimals', () => {
    expect(errorsOf(good({ fx_currency: undefined }))).toEqual(['fx_currency']);
    expect(errorsOf(good({ fx_rate: undefined }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_currency: 'usd' }))).toEqual(['fx_currency']);
    expect(errorsOf(good({ fx_currency: 'DOLLAR' }))).toEqual(['fx_currency']);
    expect(errorsOf(good({ fx_rate: 0 }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_rate: -5 }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_rate: '1330' }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_rate: 1330.12345 }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_rate: QUOTE_LIMITS.fxRateMax + 1 }))).toEqual(['fx_rate']);
    expect(errorsOf(good({ fx_currency: null, fx_rate: null }))).toEqual([]);
    expect(errorsOf(good({ fx_currency: '', fx_rate: '' }))).toEqual([]);
  });

  it('wants a real date for the validity, not in the past (today is still fine)', () => {
    expect(errorsOf(good({ valid_until: TODAY }))).toEqual([]);
    expect(errorsOf(good({ valid_until: '2026-10-20' }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: '2026-02-30' }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: '2026-13-01' }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: '20261120' }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: '2026-11-20T00:00:00Z' }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: 20261120 }))).toEqual(['valid_until']);
    expect(errorsOf(good({ valid_until: null }))).toEqual([]);
  });

  it('limits the lead time and the note, and allows line breaks in the note only', () => {
    expect(errorsOf(good({ lead_time: 'x'.repeat(QUOTE_LIMITS.leadTimeLength + 1) }))).toEqual(['lead_time']);
    expect(errorsOf(good({ lead_time: '6주\n후' }))).toEqual(['lead_time']);
    expect(errorsOf(good({ customer_note: 'x'.repeat(QUOTE_LIMITS.noteLength + 1) }))).toEqual(['customer_note']);
    expect(errorsOf(good({ customer_note: 'a\u0007b' }))).toEqual(['customer_note']);
    expect(errorsOf(good({ customer_note: 7 }))).toEqual(['customer_note']);
    expect(errorsOf(good({ customer_note: '  ' }))).toEqual([]);
  });

  it('checks the contact of the staff member: a name, an e-mail (kept in lowercase) and a phone', () => {
    expect(errorsOf(good())).toEqual([]);
    expect(errorsOf(good({ contact_name: 'x'.repeat(QUOTE_LIMITS.contactNameLength + 1) }))).toEqual(['contact_name']);
    expect(errorsOf(good({ contact_name: 5 }))).toEqual(['contact_name']);
    expect(errorsOf(good({ contact_email: 'nope' }))).toEqual(['contact_email']);
    expect(errorsOf(good({ contact_email: 'a@b' }))).toEqual(['contact_email']);
    expect(errorsOf(good({ contact_email: `${'x'.repeat(100)}@b.co` }))).toEqual(['contact_email']);
    expect(errorsOf(good({ contact_phone: 'call me' }))).toEqual(['contact_phone']);
    expect(errorsOf(good({ contact_phone: '12' }))).toEqual(['contact_phone']);
    expect(errorsOf(good({ contact_phone: '+82 2-123-4567' }))).toEqual([]);
  });

  it('lets a draft lack the contact, and says what a quote lacks before it is published', () => {
    expect(errorsOf(good({ contact_name: null, contact_email: '', contact_phone: undefined }))).toEqual([]);
    expect(missingContact({ contact_name: null, contact_email: null, contact_phone: null })).toEqual(['contact_name', 'contact_email', 'contact_phone']);
    expect(missingContact({ contact_name: '김', contact_email: 'a@b.co', contact_phone: null })).toEqual(['contact_phone']);
    expect(missingContact({ contact_name: '김', contact_email: 'a@b.co', contact_phone: '010-1234-5678' })).toEqual([]);
  });

  it('wants a whole number for the save it was made from', () => {
    expect(errorsOf(good({ expected_edit_seq: 0 }))).toEqual(['expected_edit_seq']);
    expect(errorsOf(good({ expected_edit_seq: 1.5 }))).toEqual(['expected_edit_seq']);
    expect(errorsOf(good({ expected_edit_seq: '2' }))).toEqual(['expected_edit_seq']);
  });

  it('reports every wrong field at once', () => {
    expect(errorsOf({ items: [{ name: '', quantity: 0, unit_price: -1 }], valid_until: 'x', fx_currency: 'x' }).sort()).toEqual([
      'fx_currency', 'fx_rate', 'items[0].name', 'items[0].quantity', 'items[0].unit_price', 'valid_until'
    ]);
  });
});

describe('dates', () => {
  it('knows a real calendar date', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('0000-00-00')).toBe(false);
  });

  it('gives today in Korea: after 15:00 UTC it is already the next day there', () => {
    expect(todayInKorea(new Date('2026-10-21T14:59:00Z'))).toBe('2026-10-21');
    expect(todayInKorea(new Date('2026-10-21T15:00:00Z'))).toBe('2026-10-22');
  });
});
