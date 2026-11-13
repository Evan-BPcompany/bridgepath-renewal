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
// jsdom does not play media: the page asks its clip to play, and the tests watch that call instead.
const played: any[] = [];
beforeAll(() => {
  g.HTMLMediaElement.prototype.play = function play(this: any) {
    played.push(this);
    return Promise.resolve();
  };
});
beforeEach(() => {
  played.length = 0;
});
// The home page loads the shared base (tokens, the bar at the top, the focus ring) and then its own sheet.
const css = read('style.css') + read('home.css');

describe('index.html: the question and the way in', () => {
  it('opens with one question as the only h1, and the three golf goods that answer it (2026-11-11)', () => {
    expect((html.match(/<h1[ >]/g) || []).length).toBe(1);
    expect(html).toContain('<h2 class="board-title">빠른 AI 가상견적이 가능한 대표 품목</h2>');
    expect(html).toContain('골프용품 소싱 에이전트');
    // The line of the service, as the user wrote it for FINDER GREEN (2026-11-11).
    expect(html).toContain('<p class="hero-slogan">골프 브랜드를 위한 소싱·제작 파트너, 파인더그린</p>');

    const choices = [...html.matchAll(/<a href="([^"]+)" data-word="([^"]+)">/g)].map(match => [match[1], match[2]]);
    expect(choices).toEqual([
      ['sunglasses-estimate.html', '선글라스'],
      ['shoes-estimate.html', '골프화'],
      ['golf-estimate.html', '골프티']
    ]);
  });

  it('says the three are the quick AI estimate, not everything sourced, and keeps the way to other goods as a block under them, not as a card', () => {
    const board = html.slice(html.indexOf('<div class="hero-board">'), html.indexOf('<div class="stack"'));

    expect((board.match(/<li>\s*<a href=/g) || []).length).toBe(3);
    expect(board).toContain('<p class="other-title">그 외 골프용품도 소싱할 수 있습니다.</p>');
    expect(board).toContain('골프모자, 골프장갑, 볼마커, 볼타월 등 원하는 제품을 문의해 주세요.');
    expect(board).toContain('<span>AI 견적이 아닌 담당자 소싱 상담입니다.</span>');
    expect(board).toContain('<a class="other-link" href="other-inquiry.html">다른 골프용품 문의하기</a>');
    // the block comes after the three rows, and is not a fourth row
    expect(board.indexOf('class="board-other"')).toBeGreaterThan(board.indexOf('</ul>'));
  });

  it('is a sourcing agent: it does not say that it makes the goods itself, and promises no export service', () => {
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');

    expect(text).not.toMatch(/직접 제조|자체 공장|수출 대행|해외 수출/);
  });

  it('has the product rows without a line of text under the names, and says the order sizes once, in the section under the steps', () => {
    expect(html).not.toContain('choice-hint');
    const outside = html.replace(/<section class="figures"[\s\S]*?<\/section>/, '');
    expect(outside).not.toMatch(/최소 ?주문|600켤레|1,000패키지/);
    expect(html).toContain('data-count="500" data-from="1200"');
    expect(html).toContain('data-count="1000" data-from="5000"');
    expect(html).toContain('data-count="800" data-from="2000"');
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

    // The service is FINDER GREEN (2026-11-11); the company that runs it is still named in full.
    expect(footer).toContain('FINDER GREEN · 파인더그린');
    expect(footer).toContain('주식회사 브릿지패스');
    expect(html).toMatch(/<a class="site-brand" href="index\.html"><img src="assets\/logo\/finder-green-symbol-green\.svg" alt="" width="40" height="40"><span>FINDER GREEN<\/span><\/a>/);
    expect(html.slice(0, html.indexOf('<footer'))).not.toMatch(/Bridge Path|브릿지패스/);
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

  it('shows no placeholder client or review: the two sections stay hidden until there is something real', () => {
    expect(html).toMatch(/<section class="partners"[^>]*\shidden>/);
    expect(html).toMatch(/<section class="reviews"[^>]*\shidden>/);
    const shown = html.replace(/<section class="(?:partners|reviews)"[\s\S]*?<\/section>/g, '');
    expect(shown).not.toMatch(/LOGO 0\d|후기가 준비되면/);
  });

  it('starts an estimate from the button of the hero and from each of the four products', () => {
    expect(html).toMatch(/<a class="hero-cta" href="estimate\.html">/);
    // The mark of the bar, the logo of the closing, and the three small mood shots beside the products (made with AI,
    // decorative: empty alt), the three photos of the order-size cases and the five of the steps (they have a description).
    // No other picture.
    expect((html.match(/<img /g) || []).length).toBe(13);
    expect((html.match(/<img class="choice-photo"[^>]*alt=""/g) || []).length).toBe(3);
    expect((html.match(/<figure class="moq-photo"><img src="assets\/media\/moq-[a-z]+\.webp" alt="[^"]{8,}" width="720" height="540" loading="lazy"/g) || []).length).toBe(3);
  });

  it('keeps the old sections out: no tabs, no cards of services', () => {
    expect(html).not.toMatch(/role="tab/);
    expect(html).not.toContain('service-card');
  });
});

describe('style.css and home.css: the colours of the palette, and a quality floor', () => {
  it('loads the shared base before its own sheet', () => {
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
    expect(styles).toEqual(['style.css', 'home.css']);
  });

  it('takes its colours from the FINDER GREEN logo kit: Pine on white and Ivory, Sage for washes (2026-11-11)', () => {
    expect(css).toMatch(/--ink:\s*#183d35/i);
    expect(css).toMatch(/--paper:\s*#f5f2e9/i);
    expect(css).toMatch(/--accent:\s*#183d35/i);
    expect(css).toMatch(/--sage:\s*#a7b5a2/i);
    // The orange and the black of 2026-11-10 and the blue of the design before it are gone.
    expect(css).not.toMatch(/--blue|#5a76a8|#c2410c|#9a330a|#222222/i);
    // Sage is too light for a text (2.2:1 on white).
    expect(css).not.toMatch(/(?:^|[\s;{])color:\s*(?:var\(--sage\)|#a7b5a2)/i);
  });

  it('keeps the accent for what matters: the main button and small marks, never a block of text', () => {
    const homeOnly = read('home.css');
    const accentText = [...homeOnly.matchAll(/([^{}]+)\{[^}]*(?:^|[\s;])color:\s*var\(--accent\)[^}]*\}/g)].map(match => match[1].trim());

    // Only the generated numbers and the hover of the arrow take the accent as a colour of text or line.
    accentText.forEach(selector => expect(selector).toMatch(/::before|::after/));
    expect((homeOnly.match(/background:\s*var\(--accent\)/g) || []).length).toBeLessThanOrEqual(2);
  });

  it('never uses a light gray for a text', () => {
    const textColours = [...css.matchAll(/(?:^|[\s;{])color:\s*([^;]+);/g)].map(match => match[1].trim());

    expect(textColours).not.toContain('var(--gray)');
    expect(textColours.join(' ')).not.toMatch(/#9c9c9c/i);
  });

  it('is square and light, as in the logo kit: no pill button, no heavy weight (2026-11-11)', () => {
    expect(css).toMatch(/--radius:\s*2px/);
    expect(css).toMatch(/--radius-s:\s*2px/);
    expect(css).not.toMatch(/font-weight:\s*(?:700|800|900|bold)/);
    // The one round shape left is the wash behind the hero; no control is a pill.
    const round = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^}]*border-radius:\s*999px[^}]*\}/g)].map(match => match[1].trim());
    expect(round).toEqual(['.hero::before']);
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
    expect($('#stackWord').textContent).toBe('골프화');
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
    const link = $$('#choices a')[2];
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

describe('the stepper on the five steps (home.js)', () => {
  let loaded: LoadedPage | undefined;

  const start = (): void => {
    loaded = loadPage('index.html', ['home.js']);
  };

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
    delete g.BridgePathHome;
    delete g.matchMedia;
  });

  const items = (): any[] => $$('#process .steps li');
  const views = (): any[] => $$('#process .step-view');
  const ended = (bar: any): void => {
    const event = new g.Event('animationend', { bubbles: true });
    event.animationName = 'fill';
    bar.dispatchEvent(event);
  };

  it('shows the first step and its view, and marks the section so the panel and the controls appear', () => {
    start();

    expect($('#process').classList.contains('js-stepper')).toBe(true);
    expect(items().map(item => item.classList.contains('is-active'))).toEqual([true, false, false, false, false]);
    expect(views().map(view => view.classList.contains('is-active'))).toEqual([true, false, false, false, false]);
    expect($('#process .steps').classList.contains('is-running')).toBe(true);
  });

  it('keeps one view for each step, so the panel can follow the list', () => {
    expect(html.match(/class="step-view/g)?.length).toBe(5);
    expect(html.match(/<li>\s*<h3>/g)?.length).toBe(5);
  });

  it('jumps to a step that is picked, with the steps before it done', () => {
    start();

    items()[2].querySelector('.step-pick').click();

    expect(items().map(item => item.classList.contains('is-active'))).toEqual([false, false, true, false, false]);
    expect(items().map(item => item.classList.contains('is-done'))).toEqual([true, true, false, false, false]);
    expect(views()[2].classList.contains('is-active')).toBe(true);
    expect(items()[2].querySelector('.step-pick').getAttribute('aria-pressed')).toBe('true');
  });

  it('moves on when the line under the shown step has filled, once through, and stops at the end', () => {
    start();

    items().forEach(item => ended(item.querySelector('.step-bar')));

    expect(items().every(item => item.classList.contains('is-done'))).toBe(true);
    expect($('#process .steps').classList.contains('is-running')).toBe(false);
    expect($('#process .step-toggle').textContent).toBe('처음부터 다시 보기');

    $('#process .step-toggle').click();

    expect(items()[0].classList.contains('is-active')).toBe(true);
    expect($('#process .steps').classList.contains('is-running')).toBe(true);
  });

  it('pauses and plays again with the button, and says which it will do', () => {
    start();
    const toggle = $('#process .step-toggle');

    expect(toggle.textContent).toBe('자동 넘김 멈춤');
    toggle.click();
    expect($('#process .steps').classList.contains('is-paused')).toBe(true);
    expect(toggle.textContent).toBe('자동 넘김 재생');
    toggle.click();
    expect($('#process .steps').classList.contains('is-paused')).toBe(false);
  });

  it('does not advance by itself for a visitor who asked for less motion, and hides the pause button', () => {
    g.matchMedia = () => ({ matches: true });
    start();

    expect($('#process .steps').classList.contains('is-running')).toBe(false);
    expect($('#process .step-toggle').hidden).toBe(true);
    items()[3].querySelector('.step-pick').click();
    expect(views()[3].classList.contains('is-active')).toBe(true);
  });

  it('does nothing, and does not fail, on a page without the steps', () => {
    start();
    g.document.body.innerHTML = '<p>other page</p>';

    expect(() => g.BridgePathHome.init()).not.toThrow();
  });
});

describe('the finder ring, the figures and the samples beside the ways to ask (home.js)', () => {
  let loaded: LoadedPage | undefined;

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
    delete g.BridgePathHome;
    delete g.matchMedia;
    delete g.IntersectionObserver;
    delete g.requestAnimationFrame;
  });

  it('puts a ring around the row that has the pointer, and takes it away when the pointer leaves', () => {
    loaded = loadPage('index.html', ['home.js']);
    const link = $$('#choices a')[1];

    link.dispatchEvent(new g.Event('mouseenter'));
    expect($('#choices').classList.contains('has-ring')).toBe(true);
    expect($('#choices').style.getPropertyValue('--ring-y')).toMatch(/px$/);

    link.dispatchEvent(new g.Event('mouseleave'));
    expect($('#choices').classList.contains('has-ring')).toBe(false);
  });

  it('shows three cases with only the order sizes the company gave: the factory minimum, the lower start, and the difference', () => {
    const figures = html.slice(html.indexOf('<section class="figures"'), html.indexOf('</section>', html.indexOf('<section class="figures"')));

    expect([...figures.matchAll(/<p class="moq-name">([^<]+)<\/p>/g)].map(match => match[1])).toEqual(['골프화', '골프티', '골프 선글라스']);
    expect([...figures.matchAll(/<span class="moq-num">([\d,]+)<span class="unit">([^<]+)</g)].map(match => match[1] + match[2])).toEqual(['1,200켤레', '5,000패키지', '2,000개']);
    expect([...figures.matchAll(/data-from="\d+">([^<]+)</g)].map(match => match[1])).toEqual(['500', '1,000', '800']);
    expect([...figures.matchAll(/<p class="moq-bridge"><span>([^<]+)<\/span>/g)].map(match => match[1])).toEqual(['기본보다 700켤레 적게', '기본보다 4,000패키지 적게', '기본보다 1,200개 적게']);
    expect([...figures.matchAll(/class="moq-tag">([^<]+)</g)].map(match => match[1])).toEqual(['공장 기본', '협의 예시', '공장 기본', '협의 예시', '공장 기본', '협의 예시']);
    expect(figures).toContain('1패키지는 50개입');
  });

  it('says in the five cards what the user asked to understand: AI estimate is the start, products without it are handled too, the final sample is confirmed before production, and the trade work is supported not promised', () => {
    const panel = html.slice(html.indexOf('<div class="step-panel">'), html.indexOf('</section>', html.indexOf('<div class="step-panel">')));
    const cards = panel.split('<div class="step-view').slice(1);

    expect(cards).toHaveLength(5);
    // every card: a short description and exactly three rows of a label and a sentence
    for (const card of cards) {
      expect(card).toContain('<p class="view-desc">');
      expect((card.match(/<div><dt>/g) || []).length).toBe(3);
    }
    expect(cards[0]).toContain('견적이 제공되지 않는 제품도 요청 접수 후 담당 에이전트가 제작 조건과 가격을 확인해 안내합니다');
    expect(cards[0]).toContain('회원가입 후 상세견적 요청');
    expect(cards[1]).toContain('화상미팅 또는 비대면 상담');
    expect(cards[2]).toContain('2~3차 샘플');
    expect(cards[2]).toContain('최종 컨펌');
    expect(cards[3]).toContain('최종 컨펌이 끝나면 생산을 시작합니다');
    expect(cards[3]).toContain('제조국·시즌·공장 상황에 따른 변동 가능성');
    expect(cards[4]).toContain('대면 또는 비대면');
    expect(cards[4]).toContain('수출입 서류·운송·통관 절차 지원');
    // none of the old wording that made one product look like the only one with a quote, and no promise of a service
    expect(panel).not.toMatch(/선글라스·골프티|골프화<\/dt>|수정할 곳 전달|대행|보장/);
  });

  it('says in the ways to ask that all three products show a price range (as their pages do), not that the golf shoe waits for the agent', () => {
    const guide = html.slice(html.indexOf('<dl class="guide-list">'), html.indexOf('</dl>', html.indexOf('<dl class="guide-list">')));

    expect(guide).toContain('선글라스·골프화·골프티는 로그인 없이 소재와 수량 등 기본 정보를 입력하면 예상 가격 범위를 바로 확인합니다.');
    expect(guide).toContain('범위를 안내하기 어려운 조건은 요청 접수 후 담당 에이전트가 확인합니다.');
    expect(guide).not.toMatch(/골프화는 요청을 접수/);
  });

  it('gives each of the five steps one photo that changes with its text, from one set of files', () => {
    const panel = html.slice(html.indexOf('<div class="step-panel">'), html.indexOf('</section>', html.indexOf('<div class="step-panel">')));
    const photos = [...panel.matchAll(/<figure class="view-photo"><img src="assets\/media\/process-([a-z]+)\.webp" alt="([^"]{8,})" width="960" height="720" loading="lazy"/g)];

    expect(photos.map(match => match[1])).toEqual(['material', 'spec', 'sample', 'production', 'dispatch']);
    // the photo is inside its view, before the text of the step
    expect((panel.match(/<div class="step-view[^"]*">\s*<figure class="view-photo">/g) || []).length).toBe(5);
  });

  it('says in the section that the lower numbers are examples and what they depend on', () => {
    const figures = html.slice(html.indexOf('<section class="figures"'), html.indexOf('</section>', html.indexOf('<section class="figures"')));

    expect(figures).toContain('협의 예시이며 확정 수량이 아닙니다');
    expect(figures).toContain('제품, 소재, 사양, 공장 조건에 따라 달라지고 견적에서 확정됩니다');
    expect(figures).not.toMatch(/보장|항상|무조건/);
  });

  it('counts the figures up once when they come into view and ends on the number of the page', () => {
    const frames: Array<(now: number) => void> = [];
    let report: (entries: Array<{ isIntersecting: boolean }>) => void = () => undefined;
    g.IntersectionObserver = class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        report = callback;
      }
      observe(): void {}
      disconnect(): void {}
    };
    g.requestAnimationFrame = (callback: (now: number) => void) => frames.push(callback);
    loaded = loadPage('index.html', ['home.js']);
    const counted = $$('.figures [data-count]');

    expect(counted.map(node => node.textContent)).toEqual(['500', '1,000', '800']);
    expect($('.figures').classList.contains('js-figures')).toBe(true);
    expect($('.figures').classList.contains('is-counting')).toBe(false);

    report([{ isIntersecting: true }]);
    expect($('.figures').classList.contains('is-counting')).toBe(true);
    frames.shift()?.(0);
    expect(counted.map(node => node.textContent)).toEqual(['1,200', '5,000', '2,000']);
    // the lower number is revealed 850ms in, and each case starts 100ms after the one before
    frames.shift()?.(1000);
    expect(Number((counted[0].textContent ?? '').replace(',', ''))).toBeGreaterThan(500);
    expect(Number((counted[0].textContent ?? '').replace(',', ''))).toBeLessThan(1200);
    expect(counted[2].textContent).toBe('2,000');
    frames.shift()?.(2000);
    expect(counted.map(node => node.textContent)).toEqual(['500', '1,000', '800']);
    expect(frames).toHaveLength(0);
  });

  it('leaves the figures as they are for a visitor who asked for less motion', () => {
    g.matchMedia = () => ({ matches: true });
    g.IntersectionObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    g.requestAnimationFrame = () => 0;
    loaded = loadPage('index.html', ['home.js']);

    expect($$('.figures [data-count]').map(node => node.textContent)).toEqual(['500', '1,000', '800']);
    expect($('.figures').classList.contains('js-figures')).toBe(false);
  });

  it('shows the sample of the way to ask that is picked or under the pointer, and marks that way', () => {
    loaded = loadPage('index.html', ['home.js']);
    const entries = $$('#guide .guide-list > div');
    const views = $$('#guide .guide-view');
    const picks = $$('#guide .guide-pick');

    expect($('#guide').classList.contains('js-guide')).toBe(true);
    expect(views.map(view => view.classList.contains('is-active'))).toEqual([true, false, false]);

    picks[2].click();
    expect(views.map(view => view.classList.contains('is-active'))).toEqual([false, false, true]);
    expect(entries.map(entry => entry.classList.contains('is-active'))).toEqual([false, false, true]);
    expect(picks.map(pick => pick.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);

    entries[1].dispatchEvent(new g.Event('mouseenter'));
    expect(views[1].classList.contains('is-active')).toBe(true);
  });

  it('has a mood clip behind the hero that is silent, hidden from a screen reader, has no loop and no autoplay, and a poster', () => {
    const video = html.slice(html.indexOf('<video class="hero-video"'), html.indexOf('</video>'));

    expect(video).toMatch(/\smuted\s/);
    expect(video).toContain('aria-hidden="true"');
    expect(video).toContain('poster="assets/media/hero-fairway-poster.webp"');
    expect(video).toContain('<source src="assets/media/hero-fairway.mp4" type="video/mp4">');
    expect(video).not.toMatch(/\sloop[\s>]|\sautoplay[\s>]/);
    expect((html.match(/<video /g) || []).length).toBe(1);
  });

  it('says in the foot that the pictures and the clip of the home are AI mood images, not products', () => {
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

    expect(footer).toContain('AI로 만든 분위기 이미지이며 실제 제품이 아닙니다');
  });

  it('starts the clip once, and not at all for a visitor who asked for less motion', () => {
    loaded = loadPage('index.html', ['home.js']);
    expect(played).toHaveLength(1);
    expect(played[0].classList.contains('hero-video')).toBe(true);
    expect(played[0].preload).toBe('auto');
    loaded.dispose();
    delete g.BridgePathHome;

    played.length = 0;
    g.matchMedia = () => ({ matches: true });
    loaded = loadPage('index.html', ['home.js']);
    expect(played).toHaveLength(0);
    expect($('.hero-video').preload).toBe('none');
  });

  it('does not start the clip for a visitor who turned on data saving', () => {
    Object.defineProperty(g.navigator, 'connection', { value: { saveData: true }, configurable: true });
    try {
      loaded = loadPage('index.html', ['home.js']);
      expect(played).toHaveLength(0);
    } finally {
      delete g.navigator.connection;
    }
  });

  it('serves the shots above the fold at once and names the browser surface and the brand in the foot for translators', () => {
    expect((html.match(/<img class="choice-photo"[^>]*loading="lazy"/g) || []).length).toBe(0);
    expect(html).toContain('<meta name="theme-color" content="#f5f2e9">');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('<p class="foot-name" translate="no">FINDER GREEN · 파인더그린</p>');
  });

  it('serves its own typeface: the three weights as files with their license, one preloaded, and nothing from another host', () => {
    const style = read('style.css');

    ['Regular', 'Medium', 'SemiBold'].forEach(weight => {
      const file = `assets/fonts/Pretendard-${weight}.subset.woff2`;

      expect(style).toContain(`url("${file}")`);
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    });
    expect(fs.existsSync(path.join(ROOT, 'assets/fonts/Pretendard-OFL.txt'))).toBe(true);
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" href="assets/fonts/Pretendard-Regular.subset.woff2" crossorigin>');
    expect(style).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/);
  });

  it('names the one action the same on the bar, the hero and the closing', () => {
    const label = 'AI 가상견적 받기';

    expect(html).toContain(`<a class="hero-cta" href="estimate.html">${label}</a>`);
    expect(html).toContain(`<a class="closing-cta" href="estimate.html">${label}</a>`);
    expect(html).toContain(`<span class="cta-long">${label}</span>`);
  });

  it('keeps the guide to its three ways to ask, with no sample taking the place of a term', () => {
    const guide = html.slice(html.indexOf('id="guide"'), html.indexOf('</main>'));

    expect([...guide.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1])).toEqual(['AI 가상견적', '담당자 상세견적', '질문과 상담']);
    expect(html.match(/class="guide-pick"/g)?.length).toBe(3);
    expect(html.match(/class="guide-view"/g)?.length).toBe(3);
  });
});
