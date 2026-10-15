import fs from 'fs';
import path from 'path';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';

const PRD = path.join(
  __dirname,
  '..',
  '..',
  '_bmad-output',
  'planning-artifacts',
  'prds',
  'prd-bridgepath-renewal-2026-09-06',
  'prd.md'
);

// The fixed text customers see instead of the internal status. Its source is PRD FR-4.9.2.
describe('customer guidance message', () => {
  it('is the sentence of PRD FR-4.9.2, word for word', () => {
    expect(CUSTOMER_GUIDANCE_MESSAGE).toBe(
      '견적 요청이 정상적으로 접수되었습니다. 담당자가 요청 내용과 제품 사양을 검토한 후 필요한 경우 추가정보를 요청하고, 공장 확인을 거쳐 정식견적을 안내드립니다.'
    );
  });

  it('appears verbatim in the PRD (so a change of the PRD wording is noticed here)', () => {
    const prd = fs.readFileSync(PRD, 'utf8');

    expect(prd).toContain('FR-4.9.2');
    expect(prd).toContain(`"${CUSTOMER_GUIDANCE_MESSAGE}"`);
  });

  it('promises no time: none of the vague phrases the PRD says to avoid', () => {
    expect(CUSTOMER_GUIDANCE_MESSAGE).not.toMatch(/빠른 시일|곧|최대한 신속|신속|즉시|영업일|\d+\s*(일|시간)/);
  });

  it('names no internal status code', () => {
    expect(CUSTOMER_GUIDANCE_MESSAGE).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('is plain text: nothing that would need escaping in the HTML e-mail', () => {
    expect(CUSTOMER_GUIDANCE_MESSAGE).not.toMatch(/[<>&"']/);
  });
});
