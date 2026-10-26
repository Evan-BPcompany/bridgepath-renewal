import fs from 'fs';
import path from 'path';

// What the admin screen must keep: it is served by the backend under a Content-Security-Policy that
// allows only scripts from the same origin, it shows text from customers, and it holds a session
// that must not leak into the page or the browser's storage.
const ROOT = path.join(__dirname, '..', '..', '..', 'admin-ui');
const read = (name: string): string => fs.readFileSync(path.join(ROOT, name), 'utf8');
const withoutComments = (text: string): string => text.replace(/^\s*\/\/.*$/gm, '');

const SCRIPTS = ['admin-labels.js', 'admin-api.js', 'admin-app.js'];

describe('admin-ui/index.html', () => {
  const html = read('index.html');

  it('loads its scripts from files, in the order they need, and its one stylesheet', () => {
    const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
    expect(scripts).toEqual(SCRIPTS);
    expect([...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1])).toEqual(['admin.css']);
    for (const file of [...SCRIPTS, 'admin.css']) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }
  });

  it('has no inline script and no handler in an attribute: the policy would refuse them', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it('asks not to be indexed, and keeps every id once', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['app', 'notice', 'whoBox', 'whoName', 'logoutBtn', 'mainNav', 'inboxLink', 'inboxCount']) {
      expect(ids).toContain(id);
    }
  });

  it('loads nothing from another site', () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//i);
  });
});

describe('the scripts of the admin screen', () => {
  it.each(SCRIPTS)('%s never builds markup from a string or runs a string as code', file => {
    const code = withoutComments(read(file));

    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setTimeout\(\s*['"`]/);
  });

  it.each(SCRIPTS)('%s keeps nothing in the browser: no storage, no cookie, no console', file => {
    const code = withoutComments(read(file));

    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|alert\(|confirm\(|prompt\(/);
  });

  it('only admin-api.js sends anything, only through the fetch it is given, only to /admin', () => {
    const api = withoutComments(read('admin-api.js'));
    const app = withoutComments(read('admin-app.js'));
    const labels = withoutComments(read('admin-labels.js'));

    expect(api).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect((api.match(/fetchImpl\(/g) || []).length).toBe(1);
    expect(api).toContain("var BASE = '/admin';");
    expect(api).toContain("credentials: 'same-origin'");
    expect(api).not.toMatch(/Authorization|Bearer|access_token|refresh_token/i);
    expect(app).not.toMatch(/fetch\(\s*['"`]|XMLHttpRequest|sendBeacon/);
    expect((app.match(/globalThis\.fetch\(/g) || []).length).toBe(1);
    expect(labels).not.toMatch(/fetch|XMLHttpRequest/);
  });

  it('does not put a password anywhere but in a password field, and clears it after use', () => {
    const app = withoutComments(read('admin-app.js'));

    expect(app).not.toMatch(/type:\s*'text'[^}]*password/i);
    expect(app).toContain("pass.value = '';");
    expect(app).toContain("current.value = next.value = again.value = '';");
  });

  it('links only to its own addresses', () => {
    const app = withoutComments(read('admin-app.js'));
    const hrefs = [...app.matchAll(/href:\s*([^,}]+)/g)].map(match => match[1].trim());

    for (const href of hrefs) {
      expect(href).toMatch(/^'#\/estimates/);
    }
  });
});
