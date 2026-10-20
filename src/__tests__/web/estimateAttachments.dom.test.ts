/**
 * @jest-environment jsdom
 */
import { runScript } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const MB = 1024 * 1024;

const file = (name: string, size = 100, type = 'image/png'): any => {
  const made = new g.File([new Uint8Array(1)], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

let changes: number;
let attachments: any;

beforeEach(() => {
  runScript('config.js');
  runScript('estimate-api.js');
  runScript('estimate-attachments.js');
  g.document.body.innerHTML = '<div id="attachments"></div>';
  changes = 0;
  attachments = g.BridgePathAttachments.mount($('#attachments'), { onChange: () => { changes += 1; } });
});

afterEach(() => {
  g.document.body.innerHTML = '';
  delete g.BridgePathAttachments;
});

const names = (): string[] => $$('.attachments-name').map(element => element.textContent);
const problems = (): string[] => $$('.attachments-problems p').map(element => element.textContent);

describe('the attachments component', () => {
  it('starts empty, with the rules written out and nothing to send', () => {
    expect(attachments.getFiles()).toEqual([]);
    expect($('.attachments-summary').textContent).toBe('첨부한 파일이 없어요.');
    expect($('.attachments-hint').textContent).toContain('JPG, PNG, WEBP, PDF');
    expect($('.attachments-hint').textContent).toContain('10MB');
    expect($('.attachments-hint').textContent).toContain('최대 5개');
    expect($('.attachments-hint').textContent).toContain('30MB');
    expect($('.attachments-problems').hidden).toBe(true);
  });

  it('accepts the types of the PRD and lists them with their size', () => {
    attachments.addFiles([file('logo.png', 2048), file('photo.jpg', 3 * MB, 'image/jpeg'), file('spec.pdf', 100, 'application/pdf'), file('a.webp', 100, 'image/webp')]);

    expect(names()).toEqual(['logo.png', 'photo.jpg', 'spec.pdf', 'a.webp']);
    expect($$('.attachments-size').map(element => element.textContent).slice(0, 2)).toEqual(['2KB', '3MB']);
    expect($('.attachments-summary').textContent).toContain('4/5개');
    expect(attachments.getFiles()).toHaveLength(4);
    expect(changes).toBe(1);
  });

  it('refuses a type that is not allowed, by name, and keeps the others', () => {
    attachments.addFiles([file('logo.png'), file('anim.gif', 100, 'image/gif'), file('design.psd', 100, 'image/vnd.adobe.photoshop')]);

    expect(names()).toEqual(['logo.png']);
    expect(problems()).toHaveLength(2);
    expect(problems()[0]).toContain('anim.gif');
    expect(problems()[0]).toContain('JPG, PNG, WEBP, PDF');
    expect($('.attachments-problems').hidden).toBe(false);
  });

  it('refuses a file over 10 MB and an empty file', () => {
    attachments.addFiles([file('big.png', 10 * MB + 1), file('empty.png', 0), file('ok.png', 10 * MB)]);

    expect(names()).toEqual(['ok.png']);
    expect(problems().join(' ')).toContain('10MB');
    expect(problems().join(' ')).toContain('비어 있는');
  });

  it('takes five files at most, and says so for the sixth', () => {
    attachments.addFiles(['1', '2', '3', '4', '5', '6'].map(n => file(`${n}.png`)));

    expect(names()).toHaveLength(5);
    expect(problems()).toEqual(['파일은 최대 5개까지 첨부할 수 있어요.']);
  });

  it('takes 30 MB together at most', () => {
    attachments.addFiles([file('a.png', 10 * MB), file('b.png', 10 * MB), file('c.png', 10 * MB), file('d.png', 1)]);

    expect(names()).toEqual(['a.png', 'b.png', 'c.png']);
    expect(problems().join(' ')).toContain('30MB');
  });

  it('marks a file of the same name and size, so the customer can take it away', () => {
    attachments.addFiles([file('logo.png', 500)]);
    attachments.addFiles([file('logo.png', 500)]);

    expect(names()).toEqual(['logo.png', 'logo.png']);
    expect($$('.attachments-tag-warning')).toHaveLength(1);
    expect($('.attachments-tag-warning').textContent).toBe('같은 파일이 이미 있어요');
  });

  it('removes a file, keeps the focus on the add button, and drops a duplicate mark that is no longer true', () => {
    attachments.addFiles([file('logo.png', 500), file('logo.png', 500), file('b.png')]);
    expect($$('.attachments-tag-warning')).toHaveLength(1);

    $$('.attachments-remove')[0].click();

    expect(names()).toEqual(['logo.png', 'b.png']);
    expect($$('.attachments-tag-warning')).toHaveLength(0);
    expect(g.document.activeElement).toBe($('.attachments-add'));
    expect($('.attachments-remove').getAttribute('aria-label')).toBe('logo.png 삭제');
  });

  it('clears the messages of a refused file when the list changes again', () => {
    attachments.addFiles([file('anim.gif', 100, 'image/gif')]);
    expect($('.attachments-problems').hidden).toBe(false);

    attachments.addFiles([file('ok.png')]);

    expect($('.attachments-problems').hidden).toBe(true);
  });

  it('shows a file name as text, never as markup', () => {
    attachments.addFiles([file('<img src=x onerror=alert(1)>.png')]);

    expect($('.attachments-name').textContent).toBe('<img src=x onerror=alert(1)>.png');
    expect($('#attachments img')).toBeNull();
  });

  it('adds what the file chooser gives, and lets the same file be chosen again', () => {
    const input = $('.attachments-input');
    Object.defineProperty(input, 'files', { value: [file('chosen.png')], configurable: true });

    input.dispatchEvent(new g.Event('change', { bubbles: true }));

    expect(names()).toEqual(['chosen.png']);
    expect(input.value).toBe('');
  });

  it('opens the file chooser with the button, and only the allowed types are offered', () => {
    const input = $('.attachments-input');
    const open = jest.spyOn(input, 'click').mockImplementation(() => undefined);

    $('.attachments-add').click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(input.accept).toContain('.webp');
    expect(input.accept).not.toContain('gif');
    expect(input.multiple).toBe(true);
  });

  it('adds files dropped on it', () => {
    const drop = new g.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file('dropped.png')] } });

    $('#attachments').dispatchEvent(drop);

    expect(names()).toEqual(['dropped.png']);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('takes no file while locked, and gives the controls back after', () => {
    attachments.lock(true);
    const drop = new g.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file('late.png')] } });
    $('#attachments').dispatchEvent(drop);

    expect(names()).toEqual([]);
    expect($('.attachments-add').disabled).toBe(true);

    attachments.lock(false);
    expect($('.attachments-add').disabled).toBe(false);
  });

  it('empties the list on reset', () => {
    attachments.addFiles([file('a.png'), file('b.png')]);

    attachments.reset();

    expect(attachments.getFiles()).toEqual([]);
    expect($('.attachments-summary').textContent).toBe('첨부한 파일이 없어요.');
  });

  describe('the photo that the AI analysed', () => {
    it('is put first, marked, and counts as one of the files', () => {
      attachments.addFiles([file('design.pdf', 100, 'application/pdf')]);

      attachments.setAutoFile(file('glasses.jpg', 100, 'image/jpeg'));

      expect(names()).toEqual(['glasses.jpg', 'design.pdf']);
      expect($('.attachments-tag').textContent).toBe('AI 분석에 쓴 사진');
      expect(attachments.getFiles().map((f: any) => f.name)).toEqual(['glasses.jpg', 'design.pdf']);
    });

    it('is replaced by the next one, and the files the customer added stay', () => {
      attachments.addFiles([file('design.pdf', 100, 'application/pdf')]);
      attachments.setAutoFile(file('first.jpg', 100, 'image/jpeg'));

      attachments.setAutoFile(file('second.jpg', 100, 'image/jpeg'));

      expect(names()).toEqual(['second.jpg', 'design.pdf']);
    });

    it('goes away with null, and the customer can take it out like any file', () => {
      attachments.setAutoFile(file('first.jpg', 100, 'image/jpeg'));
      attachments.setAutoFile(null);
      expect(names()).toEqual([]);

      attachments.setAutoFile(file('second.jpg', 100, 'image/jpeg'));
      $('.attachments-remove').click();
      expect(attachments.getFiles()).toEqual([]);
    });

    it('says it could not be attached when the list is full, and keeps the five files of the customer', () => {
      attachments.addFiles(['1', '2', '3', '4', '5'].map(n => file(`${n}.png`)));

      attachments.setAutoFile(file('glasses.jpg', 100, 'image/jpeg'));

      expect(names()).toEqual(['1.png', '2.png', '3.png', '4.png', '5.png']);
      expect(problems()).toEqual(['분석한 사진은 첨부하지 못했어요.']);
    });
  });

  it('is reachable as the one instance of the page', () => {
    expect(g.BridgePathAttachments.instance).toBe(attachments);
  });
});
