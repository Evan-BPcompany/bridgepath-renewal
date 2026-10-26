// KakaoTalk notices (Alimtalk): the phone number and the texts.
//
// An Alimtalk text has to be the text that Kakao approved for the template, with only the #{...}
// places filled. So the texts are fixed here, one per template, and are to be submitted for approval
// as they are (docs/KAKAO-NOTICES.md). Like the e-mails they carry no amount and nothing of the quote:
// only that something is there, and a link to the page that is behind the login.

export type KakaoTemplateCode = 'receipt' | 'quote_published' | 'inquiry_answered';

export const KAKAO_TEMPLATE_CODES: readonly KakaoTemplateCode[] = ['receipt', 'quote_published', 'inquiry_answered'];

export interface KakaoTemplate {
  code: KakaoTemplateCode;
  // The text with its places, as it is submitted for approval.
  text: string;
  button: string;
}

export const KAKAO_TEMPLATES: Readonly<Record<KakaoTemplateCode, KakaoTemplate>> = Object.freeze({
  receipt: {
    code: 'receipt',
    text: '[Bridge Path] 견적 요청이 접수되었어요.\n접수번호: #{receipt_id}\n진행 상황은 아래 버튼에서 확인하실 수 있어요.',
    button: '내 견적 보기'
  },
  quote_published: {
    code: 'quote_published',
    text: '[Bridge Path] 담당자 상세견적이 준비되었어요.\n접수번호: #{receipt_id}\n로그인 후 아래 버튼에서 확인해 주세요.',
    button: '상세견적 보기'
  },
  inquiry_answered: {
    code: 'inquiry_answered',
    text: '[Bridge Path] 남겨주신 질문에 담당자가 답변했어요.\n접수번호: #{receipt_id}\n로그인 후 아래 버튼에서 확인해 주세요.',
    button: '답변 보기'
  }
});

export interface KakaoVariables {
  receipt_id: string;
  link: string;
}

export interface RenderedKakaoMessage {
  text: string;
  button: string;
  link: string;
}

export function renderKakaoMessage(code: KakaoTemplateCode, variables: KakaoVariables): RenderedKakaoMessage {
  const template = KAKAO_TEMPLATES[code];
  return {
    text: template.text.replace('#{receipt_id}', variables.receipt_id),
    button: template.button,
    link: variables.link
  };
}

// A Korean mobile number, as digits only and starting with 0 (01012345678), or undefined when the
// number is not one: +82 and 0082 forms, spaces, dashes and brackets are accepted; a landline or a
// foreign number cannot receive a KakaoTalk notice and gets none.
export function normalizeKoreanMobile(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+82')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('0082')) {
    digits = `0${digits.slice(4)}`;
  }
  // 010 followed by 8 digits; the old 011/016/017/018/019 followed by 7 or 8.
  return /^01[016-9]\d{7,8}$/.test(digits) && (digits.startsWith('010') ? digits.length === 11 : true) ? digits : undefined;
}

// For the log: never the whole number.
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}
