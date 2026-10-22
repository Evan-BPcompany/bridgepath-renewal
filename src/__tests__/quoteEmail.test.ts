import { buildQuotePublishedEmail, quoteLink } from '../utils/quoteEmail';

const LINK = 'https://www.example.com/my-quotes.html?r=BP20261021001';
const input = (over: Record<string, unknown> = {}) => ({ receiptId: 'BP20261021001', version: 1, link: LINK, ...over });

describe('quoteLink', () => {
  it('points to the request on "내 견적", with the receipt number encoded and no double slash', () => {
    expect(quoteLink('https://www.example.com', 'BP20261021001')).toBe(LINK);
    expect(quoteLink('https://www.example.com/', 'BP20261021001')).toBe(LINK);
    expect(quoteLink('http://localhost:3000', 'a b&c')).toBe('http://localhost:3000/my-quotes.html?r=a%20b%26c');
  });
});

describe('buildQuotePublishedEmail', () => {
  it('tells the customer that the quote has arrived, with the receipt number and the link', () => {
    const { subject, body } = buildQuotePublishedEmail(input());

    expect(subject).toBe('[Bridge Path] 담당자 상세견적이 도착했어요 (접수번호 BP20261021001)');
    expect(body).toContain('요청하신 담당자 상세견적이 준비되었어요');
    expect(body).toContain('BP20261021001');
    expect(body).toContain(`href="${LINK}"`);
    expect(body).toContain('내 견적에서 확인하기');
    expect(body).toContain('로그인한 뒤 확인할 수 있어요');
  });

  it('says "changed" for a later publication, so the customer looks again', () => {
    const { subject, body } = buildQuotePublishedEmail(input({ version: 2 }));

    expect(subject).toContain('수정되었어요');
    expect(body).toContain('바뀐 내용을 확인해 주세요');
    expect(body).not.toContain('도착했어요');
  });

  it('carries no amount and nothing of the quote: the quote is behind the login', () => {
    const { subject, body } = buildQuotePublishedEmail(input());

    expect(`${subject} ${body}`).not.toMatch(/원|KRW|합계|단가|total|price/i);
  });

  it('puts the support address in only when there is one', () => {
    expect(buildQuotePublishedEmail(input()).body).not.toContain('문의사항');
    expect(buildQuotePublishedEmail(input({ supportEmail: 'help@example.com' })).body).toContain('help@example.com로 연락주세요');
  });

  it('escapes what goes into the page, even if a value were not what it should be', () => {
    const { body } = buildQuotePublishedEmail(
      input({ receiptId: '<img src=x onerror=alert(1)>', link: 'https://x.test/?a="b"&c=<d>', supportEmail: '<b>x</b>' })
    );

    expect(body).not.toContain('<img');
    expect(body).not.toContain('<b>');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).toContain('href="https://x.test/?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
  });
});
