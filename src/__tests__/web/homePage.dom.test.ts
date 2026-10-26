/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { loadPage, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = path.join(__dirname, '..', '..', '..');
const read = (name: string): string => fs.readFileSync(path.join(ROOT, name), 'utf8');
const g = globalThis as any;
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const html = read('index.html');

describe('index.html: what the page says', () => {
  it('has no company-introduction section and no link to one', () => {
    expect(html).not.toMatch(/id="about"|href="#about"|회사소개|우리의 강점/);
  });

  it('has no placeholder text in brackets that a visitor would read', () => {
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');

    expect(text).not.toMatch(/\((담당자|회사|사업자)[^)]*\)/);
    expect(text).not.toMatch(/Co\., Ltd\.|2024/);
  });

  it('names the company in the footer and promises nothing the site does not do', () => {
    expect(html).toContain('주식회사 브릿지패스');
    // No live production tracking, no KakaoTalk notices, no phone call without a request.
    expect(html).not.toMatch(/실시간|카카오톡|생산 현황|생산 진행 현황/);
    expect(html).not.toMatch(/개인정보 처리방침/); // the privacy page is a placeholder until the text is approved
  });

  it('shows the minimum orders and the 2-3 business days of the detailed quote', () => {
    expect(html).toContain('600켤레');
    expect(html).toContain('1,000패키지');
    expect(html).toContain('업무일 기준 2~3일');
  });

  it('marks every example picture as an example', () => {
    const panels = html.match(/role="tabpanel"/g) || [];

    expect(panels).toHaveLength(5);
    expect((html.match(/<span class="mock-example">예시 화면<\/span>/g) || []).length).toBe(5);
  });

  it('links only to files that exist, and its anchors point to sections of the page', () => {
    const files = [...html.matchAll(/(?:href|src)="([^"#:]+?)"/g)].map(match => match[1]).filter(name => !/^https?:/.test(name));
    files.forEach(file => expect(fs.existsSync(path.join(ROOT, file))).toBe(true));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
    anchors.forEach(id => expect(html).toContain(`id="${id}"`));
    expect(anchors).toEqual(['process', 'services', 'contact']);
  });

  it('puts the services after the process and keeps the golf tee page link', () => {
    expect(html.indexOf('id="process"')).toBeLessThan(html.indexOf('id="services"'));
    expect(html).toContain("golf-estimate.html");
    expect(html).toContain("shoes-estimate.html");
    expect(html).toContain("sunglasses-estimate.html");
  });
});

describe('home.js and script.js', () => {
  it('build no markup: no innerHTML, no fetch, no eval', () => {
    for (const file of ['home.js', 'script.js']) {
      expect(read(file).replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|fetch\(|eval\(|document\.write/);
    }
  });

  it('script.js no longer reads a form that the page does not have', () => {
    expect(read('script.js')).not.toMatch(/estimateForm|getElementById/);
  });
});

describe('the five steps (home.js)', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.IntersectionObserver = undefined;
    loaded = loadPage('index.html', ['home.js']);
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
    delete g.BridgePathHome;
  });

  const selected = (): number => $$('.process-tabs [role="tab"]').findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const visible = (): number[] => $$('.process-panel').map((panel, index) => (panel.hidden ? -1 : index)).filter(index => index >= 0);
  const key = (tab: any, name: string): void => {
    tab.dispatchEvent(new g.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  };

  it('starts on the first step, with the first panel only', () => {
    expect(selected()).toBe(0);
    expect(visible()).toEqual([0]);
    expect($$('.process-tab').map(tab => tab.getAttribute('tabindex'))).toEqual([null, '-1', '-1', '-1', '-1']);
  });

  it('has a tab for each panel, joined both ways', () => {
    $$('.process-tab').forEach((tab, index) => {
      const panel = $$('.process-panel')[index];
      expect(tab.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    });
  });

  it('shows the panel of the tab that is clicked, and only that one', () => {
    $$('.process-tab')[3].click();

    expect(selected()).toBe(3);
    expect(visible()).toEqual([3]);
    expect($$('.process-tab').map(tab => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0', '-1']);
  });

  it('moves with the arrow keys, around the ends, and with Home and End, and moves the focus', () => {
    const tabs = $$('.process-tab');

    key(tabs[0], 'ArrowDown');
    expect(selected()).toBe(1);
    expect(g.document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'ArrowUp');
    key(tabs[0], 'ArrowUp');
    expect(selected()).toBe(4);
    key(tabs[4], 'ArrowRight');
    expect(selected()).toBe(0);
    key(tabs[0], 'End');
    expect(selected()).toBe(4);
    key(tabs[4], 'Home');
    expect(selected()).toBe(0);
    expect(visible()).toEqual([0]);
  });

  it('leaves other keys alone', () => {
    const event = new g.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    $$('.process-tab')[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(selected()).toBe(0);
  });

  it('does nothing, and does not fail, on a page without the tabs', () => {
    g.document.body.innerHTML = '<p>other page</p>';

    expect(() => g.BridgePathHome.init()).not.toThrow();
  });
});
