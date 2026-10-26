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
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const html = read('index.html');
const css = read('home.css');

describe('index.html: the question and the way in', () => {
  it('opens with one question as the only h1, and the four ways to answer it', () => {
    expect((html.match(/<h1[ >]/g) || []).length).toBe(1);
    expect(html).toContain('어떤 제품을 만들고 싶으세요?');

    const choices = [...html.matchAll(/<a href="([^"]+)" data-word="([^"]+)">/g)].map(match => [match[1], match[2]]);
    expect(choices).toEqual([
      ['sunglasses-estimate.html', '선글라스'],
      ['shoes-estimate.html', '신발'],
      ['golf-estimate.html', '골프티'],
      ['other-inquiry.html', '기타']
    ]);
  });

  it('says the minimum orders next to the choices that have one', () => {
    expect(html).toContain('최소 주문 600켤레');
    expect(html).toContain('최소 주문 1,000패키지 (1패키지 50개입)');
  });

  it('has no company-introduction section and no link to one', () => {
    expect(html).not.toMatch(/id="about"|href="#about"|회사소개|우리의 강점/);
  });

  it('has no placeholder text a visitor would read, and no old year', () => {
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');

    expect(text).not.toMatch(/\((담당자|회사|사업자)[^)]*\)/);
    expect(text).not.toMatch(/Co\., Ltd\.|2024/);
  });
});

describe('index.html: the steps and the guide', () => {
  it('lists the five steps in order, as an ordered list (the content is a sequence)', () => {
    const list = html.slice(html.indexOf('<ol class="steps">'), html.indexOf('</ol>'));

    expect([...list.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1])).toEqual(['견적 요청', '사양 협의', '샘플 확인', '제품 생산', '검수·출고']);
  });

  it('explains the three ways to ask, with the 2-3 business days of the detailed quote', () => {
    const guide = html.slice(html.indexOf('id="guide"'), html.indexOf('</main>'));

    expect([...guide.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1])).toEqual(['AI 가상견적', '담당자 상세견적', '질문과 상담']);
    expect(guide).toContain('업무일 기준 2~3일');
    expect(guide).toContain('300자');
  });

  it('promises nothing the site does not do', () => {
    expect(html).not.toMatch(/실시간|카카오톡|생산 현황|생산 진행 현황/);
    expect(html).not.toMatch(/개인정보 처리방침/); // the privacy page is a placeholder until the text is approved
  });
});

describe('index.html: the footer', () => {
  it('gives the business details as in the registration papers of the company', () => {
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

    expect(footer).toContain('주식회사 브릿지패스');
    expect(footer).toContain('대표 옥보경');
    expect(footer).toContain('사업자등록번호 478-86-03621');
    expect(footer).toContain('통신판매업 신고번호 제 2025-수원팔달-0228호');
    expect(footer).toContain('경기도 화성시 병점구 병점노을5로 20, 골든스퀘어2 1223호');
    expect(footer).toContain('href="mailto:bptrade7@bptrade.co.kr"');
    // Not for visitors: the date of birth and the corporate registration number.
    expect(footer).not.toMatch(/1992|130111/);
  });
});

describe('index.html: structure and files', () => {
  it('links only to files that exist, and its anchors point to sections of the page', () => {
    const files = [...html.matchAll(/(?:href|src)="([^"#:]+?)"/g)].map(match => match[1]).filter(name => !/^https?:/.test(name));
    files.forEach(file => expect(fs.existsSync(path.join(ROOT, file))).toBe(true));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
    anchors.forEach(id => expect(html).toContain(`id="${id}"`));
    expect(anchors).toEqual(['start', 'process', 'guide']);
  });

  it('has no inline script and no inline style: the server only allows scripts and styles from its own files', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toMatch(/\sstyle="|<style|\son[a-z]+="/);
  });

  it('has a skip link, landmarks, a language and a phone-sized viewport', () => {
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0"');
    expect(html).toMatch(/<a class="skip" href="#start">/);
    expect(html).toMatch(/<header[\s\S]*<nav [^>]*aria-label="[^"]+"[\s\S]*<main>[\s\S]*<\/main>[\s\S]*<footer/);
  });

  it('keeps the front panel and its decoration out of the reading order of a screen reader', () => {
    expect(html).toMatch(/<div class="stack" aria-hidden="true">/);
  });

  it('keeps the old sections out: no tabs, no cards of services', () => {
    expect(html).not.toMatch(/role="tab/);
    expect(html).not.toContain('service-card');
  });
});

describe('home.css: the colours of the palette, and a quality floor', () => {
  it('uses the colours of the chosen picture, plus ink and paper, as variables', () => {
    expect(css).toMatch(/--blue:\s*#2779a7/i);
    expect(css).toMatch(/--gray:\s*#9c9c9c/i);
    expect(css).toMatch(/--ink:\s*#222222/i);
    expect(css).toMatch(/--paper:\s*#f8f8f8/i);
  });

  it('never uses the gray for a text (it has 2.75:1 with white)', () => {
    const textColours = [...css.matchAll(/(?:^|[\s;{])color:\s*([^;]+);/g)].map(match => match[1].trim());

    expect(textColours).not.toContain('var(--gray)');
    expect(textColours.join(' ')).not.toMatch(/#9c9c9c/i);
  });

  it('shows the keyboard focus, respects reduced motion and has a layout for a phone', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)/);
    expect(css).toMatch(/@media \(max-width: 520px\)/);
    expect(css).toMatch(/word-break:\s*keep-all/);
  });
});

describe('home.js and the old script', () => {
  it('builds no markup: no innerHTML, no fetch, no eval', () => {
    expect(read('home.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|fetch\(|eval\(|document\.write/);
  });

  it('script.js (the scroll animation of the old service cards) is gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'script.js'))).toBe(false);
  });
});

describe('the front panel (home.js)', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    loaded = loadPage('index.html', ['home.js']);
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
    delete g.BridgePathHome;
  });

  const fire = (element: any, type: string): void => {
    element.dispatchEvent(new g.Event(type));
  };

  it('starts with the neutral word', () => {
    expect($('#stackWord').textContent).toBe('제품');
    expect($('#stackLabel').textContent).toBe('내 제품');
  });

  it('shows the word of the choice under the pointer, and goes back when the pointer leaves', () => {
    const links = $$('#choices a');

    fire(links[1], 'mouseenter');
    expect($('#stackWord').textContent).toBe('신발');
    expect($('#stackLabel').textContent).toBe('이 제품으로');
    fire(links[2], 'mouseenter');
    expect($('#stackWord').textContent).toBe('골프티');
    fire(links[2], 'mouseleave');
    expect($('#stackWord').textContent).toBe('제품');
    expect($('#stackLabel').textContent).toBe('내 제품');
  });

  it('does the same for the keyboard focus', () => {
    const links = $$('#choices a');

    fire(links[0], 'focus');
    expect($('#stackWord').textContent).toBe('선글라스');
    fire(links[0], 'blur');
    expect($('#stackWord').textContent).toBe('제품');
  });

  it('puts the word in as text', () => {
    const link = $$('#choices a')[3];
    link.setAttribute('data-word', '<img src=x onerror=alert(1)>');

    fire(link, 'mouseenter');

    expect($('#stackWord').textContent).toBe('<img src=x onerror=alert(1)>');
    expect($('#stackWord img')).toBeNull();
  });

  it('does nothing, and does not fail, on a page without the panel', () => {
    g.document.body.innerHTML = '<p>other page</p>';

    expect(() => g.BridgePathHome.init()).not.toThrow();
  });
});
