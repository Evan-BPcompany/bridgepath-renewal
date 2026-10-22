// The e-mail that tells a customer that the staff published (or changed) their detailed quote.
//
// It carries no amount and nothing of the quote: only that it is there and a link to "내 견적", where
// the customer reads it after signing in. An e-mail can be forwarded, kept and read by others; the
// quote is behind the login.

export interface QuotePublishedEmailInput {
  receiptId: string;
  version: number;
  // The page of the request on the site, built by the caller (the front end address of the
  // configuration and the receipt number, encoded).
  link: string;
  supportEmail?: string;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function quoteLink(frontendBaseUrl: string, receiptId: string): string {
  return `${frontendBaseUrl.replace(/\/+$/, '')}/my-quotes.html?r=${encodeURIComponent(receiptId)}`;
}

// The first publication is "arrived"; a later one is "changed", so the customer knows to look again.
export function buildQuotePublishedEmail(input: QuotePublishedEmailInput): { subject: string; body: string } {
  const changed = input.version > 1;
  const subject = changed
    ? `[Bridge Path] 담당자 상세견적이 수정되었어요 (접수번호 ${input.receiptId})`
    : `[Bridge Path] 담당자 상세견적이 도착했어요 (접수번호 ${input.receiptId})`;
  const lead = changed
    ? '담당자가 상세견적을 수정해서 다시 올렸어요. 바뀐 내용을 확인해 주세요.'
    : '요청하신 담당자 상세견적이 준비되었어요.';
  const receipt = escapeHtml(input.receiptId);
  const link = escapeHtml(input.link);
  const support = input.supportEmail ? `<p>문의사항이 있으시면 ${escapeHtml(input.supportEmail)}로 연락주세요.</p>` : '';

  const body = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>${escapeHtml(changed ? '담당자 상세견적이 수정되었어요' : '담당자 상세견적이 도착했어요')}</h2>
        <p>${lead}</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수번호</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${receipt}</td>
          </tr>
        </table>
        <p><a href="${link}" style="display: inline-block; padding: 12px 22px; background: #151515; color: #fff; text-decoration: none; border-radius: 6px;">내 견적에서 확인하기</a></p>
        <p>견적 내용은 로그인한 뒤 확인할 수 있어요. 위 버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.</p>
        <p style="word-break: break-all; color: #666;">${link}</p>
        ${support}
      </body>
    </html>
  `;
  return { subject, body };
}
