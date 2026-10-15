import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (name: string): string => fs.readFileSync(path.join(ROOT, name), 'utf8');

const PAGES = ['sunglasses', 'shoes', 'golf'];
const REQUIRED_SELECTS: Record<string, string[]> = {
  sunglasses: ['lensType', 'frameMaterial'],
  shoes: ['material'],
  golf: ['material']
};

describe.each(PAGES)('%s-estimate.html: three steps', page => {
  const html = read(`${page}-estimate.html`);
  const section = (id: string): string => {
    const start = html.indexOf(`<section class="step-content`, html.indexOf(`id="${id}"`) - 60);
    const end = html.indexOf('</section>', start);
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, end);
  };

  it('names its page on the body for estimate-flow.js', () => {
    expect(html).toContain(`<body data-estimate-page="${page}">`);
  });

  it('has three steps in the indicator with a line between each', () => {
    expect([...html.matchAll(/<div class="step(?: active)?" id="(step\d)">/g)].map(match => match[1])).toEqual(['step1', 'step2', 'step3']);
    expect((html.match(/class="step-line"/g) || []).length).toBe(2);
    expect(html).toContain('<span class="step-name">고객 정보</span>');
  });

  it('has the three step sections, each once', () => {
    ['step1-content', 'step2-content', 'step3-content'].forEach(id => {
      expect((html.match(new RegExp(`id="${id}"`, 'g')) || []).length).toBe(1);
    });
  });

  it('moves to step 3 from step 2 and submits from step 3 only', () => {
    const two = section('step2-content');
    const three = section('step3-content');
    expect(two).toContain('id="nextBtn2"');
    expect(two).not.toContain('id="submitBtn"');
    expect(two).not.toContain('id="successMessage"');
    expect(three).toContain('id="submitBtn"');
    expect(three).toContain('id="successMessage"');
    expect(three).toContain('id="customerStep"');
    expect(three).toContain('onclick="goToStep(2)"');
    expect(two).toContain('onclick="goToStep(1)"');
  });

  it('keeps every id once', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loads the scripts in the order they need', () => {
    const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
    expect(scripts).toEqual([
      'config.js',
      'estimate-api.js',
      'estimate-common.js',
      'estimate-customer-step.js',
      'estimate-flow.js',
      `${page}-estimate.js`
    ]);
    scripts.forEach(file => expect(fs.existsSync(path.join(ROOT, file))).toBe(true));
  });

  it('loads the new stylesheet after the common one', () => {
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
    expect(styles).toEqual(['style.css', 'estimate-common.css', 'estimate-customer.css']);
  });

  it('offers "잘 모르겠음" in the required selects and marks them required', () => {
    REQUIRED_SELECTS[page].forEach(id => {
      const select = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`));
      expect(select).not.toBeNull();
      expect(select![0]).toContain('<option value="unknown">잘 모르겠음</option>');
      expect(html).toMatch(new RegExp(`<label for="${id}">[^<]* \\*</label>`));
    });
  });

  it('has no behaviour of its own in the page script any more (no fake submit, no redirect)', () => {
    const code = read(`${page}-estimate.js`).replace(/^\s*\/\/.*$/gm, '').trim();
    expect(code).toBe('');
  });

  it('has the success screen with places for the receipt number, the time and the message of the server', () => {
    const three = section('step3-content');
    expect(three).toContain('id="successMessage" class="success-message" role="status"');
    ['receiptId', 'receiptTime', 'receiptMessage'].forEach(id => expect(three).toContain(`id="${id}"`));
    expect(three).toContain('접수번호를 메모해 주세요.');
    expect(three).toContain('<a href="index.html">홈으로 돌아가기</a>');
    expect(three).not.toMatch(/빠른 시간|곧 |이내|영업일|연락드리겠/);
  });
});

describe('the new scripts', () => {
  it.each(['estimate-customer-step.js', 'estimate-flow.js'])('%s never writes markup', file => {
    const code = read(file).replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });

  it('estimate-customer-step.js sends and stores nothing', () => {
    const code = read('estimate-customer-step.js').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|FormData|submitEstimate|localStorage|sessionStorage|console\./);
  });

  it('estimate-flow.js sends only through submitEstimate, and stores and logs nothing', () => {
    const code = read('estimate-flow.js').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/XMLHttpRequest|sendBeacon|FormData|localStorage|sessionStorage|indexedDB|document\.cookie|console\.|alert\(|setTimeout|location/);
    expect((code.match(/(?<![.\w])fetch\(/g) || []).length).toBe(0);
    expect((code.match(/globalThis\.fetch\(/g) || []).length).toBe(1);
    expect((code.match(/submitEstimate\(/g) || []).length).toBe(1);
    expect(code).not.toMatch(/access_token|accessToken|\.status/);
  });
});

describe('privacy-consent.html', () => {
  const html = read('privacy-consent.html');

  it('is only a notice for development: not final, no script, not indexed', () => {
    expect(html).toContain('안내문은 확정 전입니다');
    expect(html).toContain('실제 서비스에서는 사용할 수 없습니다');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it('is the page the consent link of the config points to', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../../../config.js');
    expect(fs.existsSync(path.join(ROOT, config.PRIVACY_CONSENT_URL))).toBe(true);
  });
});

describe('estimate-customer.css', () => {
  const css = read('estimate-customer.css');

  it('styles the second next button like the others and the errors', () => {
    expect(css).toMatch(/#nextBtn2\s*\{[^}]*width:\s*100%/);
    expect(css).toContain('.field-error');
    expect(css).toContain(':focus-visible');
  });

  it('keeps the three steps in a row on a narrow screen, only for the estimate pages', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/body\[data-estimate-page\] \.step-indicator\s*\{[^}]*flex-direction:\s*row/);
  });
});

describe('what this change leaves alone', () => {
  it('does not put the new scripts on other-inquiry or the home page', () => {
    ['other-inquiry.html', 'index.html'].forEach(file => {
      const html = read(file);
      expect(html).not.toContain('estimate-customer-step.js');
      expect(html).not.toContain('estimate-flow.js');
      expect(html).not.toContain('estimate-customer.css');
    });
  });

  it('adds jest-environment-jsdom in the version of jest', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.devDependencies['jest-environment-jsdom']).toBe('^30.5.2');
    const major = (version: string): string => version.replace(/^[^\d]*/, '').split('.')[0];
    expect(major(pkg.devDependencies['jest-environment-jsdom'])).toBe(major(pkg.devDependencies.jest));
  });
});
