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

// ---------------------------------------------------------------------------------------------
// Questions and consultation requests about a published quote.

export interface InquiryAnsweredEmailInput {
  receiptId: string;
  link: string;
  supportEmail?: string;
}

// To the customer when the staff answered a question. The answer itself is on the site, behind the login.
export function buildInquiryAnsweredEmail(input: InquiryAnsweredEmailInput): { subject: string; body: string } {
  const receipt = escapeHtml(input.receiptId);
  const link = escapeHtml(input.link);
  const support = input.supportEmail ? `<p>문의사항이 있으시면 ${escapeHtml(input.supportEmail)}로 연락주세요.</p>` : '';
  return {
    subject: `[Bridge Path] 남기신 질문에 답변이 달렸어요 (접수번호 ${input.receiptId})`,
    body: `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>남기신 질문에 답변이 달렸어요</h2>
        <p>담당자가 질문에 답변을 남겼어요.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수번호</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${receipt}</td>
          </tr>
        </table>
        <p><a href="${link}" style="display: inline-block; padding: 12px 22px; background: #151515; color: #fff; text-decoration: none; border-radius: 6px;">내 견적에서 확인하기</a></p>
        <p>답변은 로그인한 뒤 확인할 수 있어요. 위 버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.</p>
        <p style="word-break: break-all; color: #666;">${link}</p>
        ${support}
      </body>
    </html>
  `
  };
}

export interface AdminInquiryEmailInput {
  receiptId: string;
  kind: 'question' | 'consultation';
}

// To the staff when a customer asks something. Not a word of what the customer wrote and not the
// phone number: they are on the admin screen.
export function buildAdminInquiryEmail(input: AdminInquiryEmailInput): { subject: string; body: string } {
  const what = input.kind === 'consultation' ? '심층상담 요청' : '질문';
  const receipt = escapeHtml(input.receiptId);
  return {
    subject: `[Bridge Path] 새 ${what}: ${input.receiptId}`,
    body: `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>새 ${what}</h2>
        <p>상세견적에 대한 고객의 ${what}이 들어왔습니다.${input.kind === 'consultation' ? ' 담당자가 고객에게 전화해 주세요.' : ''}</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; background: #f9f9f9;">접수번호</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${receipt}</td>
          </tr>
        </table>
        <p>내용은 관리자 화면의 해당 접수에서 확인하세요.</p>
      </body>
    </html>
  `
  };
}
