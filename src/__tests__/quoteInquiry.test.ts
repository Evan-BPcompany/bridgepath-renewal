import {
  INQUIRY_LIMITS,
  countCharacters,
  isValidPhone,
  parseAnswer,
  parseDoneNote,
  parseInquiryInput
} from '../utils/quoteInquiry';

const errorsOf = (body: unknown): string[] => {
  const result = parseInquiryInput(body);
  return result.valid ? [] : result.errors.map(e => e.field);
};

describe('a question about the quote', () => {
  it('is a short text, trimmed', () => {
    expect(parseInquiryInput({ kind: 'question', body: '  납기를 2주 줄일 수 있나요?  ' })).toEqual({
      valid: true,
      value: { kind: 'question', body: '납기를 2주 줄일 수 있나요?' }
    });
  });

  it('may have line breaks, but no other control character', () => {
    expect(errorsOf({ kind: 'question', body: '첫 줄\n둘째 줄' })).toEqual([]);
    expect(errorsOf({ kind: 'question', body: 'a\u0007b' })).toEqual(['body']);
    expect(errorsOf({ kind: 'question', body: 'a\u0000b' })).toEqual(['body']);
  });

  it('is at most 300 characters: Korean letters count one each, and 301 is too long', () => {
    expect(INQUIRY_LIMITS.questionLength).toBe(300);
    expect(errorsOf({ kind: 'question', body: '가'.repeat(300) })).toEqual([]);
    expect(errorsOf({ kind: 'question', body: '가'.repeat(301) })).toEqual(['body']);
    // An emoji is one character for the customer, though two UTF-16 units.
    expect(errorsOf({ kind: 'question', body: '😀'.repeat(300) })).toEqual([]);
    expect(errorsOf({ kind: 'question', body: '😀'.repeat(301) })).toEqual(['body']);
    expect(countCharacters('가😀a')).toBe(3);
  });

  it.each([undefined, null, '', '   ', '\n\n', 5, ['x'], { a: 1 }])('needs a text, not %j', body => {
    expect(errorsOf({ kind: 'question', body })).toEqual(['body']);
  });

  it('takes no phone, no time and nothing else along', () => {
    const result = parseInquiryInput({ kind: 'question', body: '질문', phone: '010-1234-5678', preferred_time: 'any', status: 'answered', answer: 'x' });

    expect(result).toEqual({ valid: true, value: { kind: 'question', body: '질문' } });
  });
});

describe('a request for a consultation', () => {
  it('needs the phone to call, and takes a time and a note', () => {
    expect(parseInquiryInput({ kind: 'consultation', phone: ' 010-1234-5678 ', preferred_time: 'weekday_pm', body: ' 납기 이야기 ' })).toEqual({
      valid: true,
      value: { kind: 'consultation', phone: '010-1234-5678', preferred_time: 'weekday_pm', body: '납기 이야기' }
    });
  });

  it('is "any time" without a note when nothing else is given', () => {
    expect(parseInquiryInput({ kind: 'consultation', phone: '010-1234-5678' })).toEqual({
      valid: true,
      value: { kind: 'consultation', phone: '010-1234-5678', preferred_time: 'any', body: null }
    });
  });

  it.each([undefined, '', '  ', 'call me', '12', '+'.repeat(21), 5])('refuses the phone %j', phone => {
    expect(errorsOf({ kind: 'consultation', phone })).toEqual(['phone']);
  });

  it('knows the three times and nothing else', () => {
    for (const time of ['any', 'weekday_am', 'weekday_pm']) {
      expect(errorsOf({ kind: 'consultation', phone: '010-1234-5678', preferred_time: time })).toEqual([]);
    }
    for (const time of ['night', 'ANY', 5, ['any']]) {
      expect(errorsOf({ kind: 'consultation', phone: '010-1234-5678', preferred_time: time })).toEqual(['preferred_time']);
    }
  });

  it('limits the note to 300 characters too', () => {
    expect(errorsOf({ kind: 'consultation', phone: '010-1234-5678', body: '가'.repeat(300) })).toEqual([]);
    expect(errorsOf({ kind: 'consultation', phone: '010-1234-5678', body: '가'.repeat(301) })).toEqual(['body']);
  });

  it('reports every wrong field at once', () => {
    expect(errorsOf({ kind: 'consultation', phone: 'x', preferred_time: 'night', body: 5 }).sort()).toEqual(['body', 'phone', 'preferred_time']);
  });
});

describe('the kind', () => {
  it.each([undefined, null, '', 'complaint', 'QUESTION', 5, ['question']])('refuses the kind %j', kind => {
    expect(errorsOf({ kind, body: 'x', phone: '010-1234-5678' })).toEqual(['kind']);
  });

  it.each([undefined, null, 'x', 5, []])('refuses the body %j', body => {
    expect(errorsOf(body)).toEqual(['kind']);
  });
});

describe('isValidPhone', () => {
  it('wants 7-15 digits and only digits, spaces, + - ( )', () => {
    expect(isValidPhone('010-1234-5678')).toBe(true);
    expect(isValidPhone('+82 (2) 123-4567')).toBe(true);
    expect(isValidPhone('123456')).toBe(false);
    expect(isValidPhone('1234567890123456')).toBe(false);
    expect(isValidPhone('010-1234-567a')).toBe(false);
  });
});

describe('the answer of the staff', () => {
  it('is required, trimmed and at most 500 characters', () => {
    expect(parseAnswer({ answer: '  가능합니다.  ' })).toEqual({ valid: true, value: '가능합니다.' });
    expect(parseAnswer({ answer: '가'.repeat(500) }).valid).toBe(true);
    expect(parseAnswer({ answer: '가'.repeat(501) }).valid).toBe(false);
    for (const body of [{}, { answer: '' }, { answer: '  ' }, { answer: 5 }, null, 'x']) {
      expect(parseAnswer(body).valid).toBe(false);
    }
  });

  it('may have line breaks, not other control characters', () => {
    expect(parseAnswer({ answer: '네.\n그렇게 하겠습니다.' }).valid).toBe(true);
    expect(parseAnswer({ answer: 'a\u0007b' }).valid).toBe(false);
  });
});

describe('the note after the call', () => {
  it('is optional, trimmed and at most 300 characters', () => {
    expect(parseDoneNote({})).toEqual({ valid: true, value: null });
    expect(parseDoneNote(undefined)).toEqual({ valid: true, value: null });
    expect(parseDoneNote({ note: '  통화함  ' })).toEqual({ valid: true, value: '통화함' });
    expect(parseDoneNote({ note: '가'.repeat(301) }).valid).toBe(false);
    expect(parseDoneNote({ note: 5 }).valid).toBe(false);
  });
});
