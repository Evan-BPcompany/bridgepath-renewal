// Fixed wording shown to customers after they submit an estimate request. It replaces the
// internal status code, which customers must not see (PRD FR-4.9.3).
//
// Source: PRD FR-4.9.2, "고객 안내 문구 원칙"
// (_bmad-output/planning-artifacts/prds/prd-bridgepath-renewal-2026-09-06/prd.md, line 355).
// The sentence is the one the PRD gives, word for word. The PRD says the final copy may be
// polished in the UX and content step as long as the meaning stays, and that wording which
// could be read as a promise of time ("빠른 시일 내", "곧", "최대한 신속하게") must be avoided.
// It is the only place of this text: the API answers and the customer e-mail both use it.
export const CUSTOMER_GUIDANCE_MESSAGE =
  '견적 요청이 정상적으로 접수되었습니다. 담당자가 요청 내용과 제품 사양을 검토한 후 필요한 경우 추가정보를 요청하고, 공장 확인을 거쳐 정식견적을 안내드립니다.';
