import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listFrontFiles, localReferences } = require('../../scripts/front-files.js');

const ROOT = path.join(__dirname, '..', '..');

describe('the files of the customer pages to publish (npm run front:files)', () => {
  const { files, missing } = listFrontFiles(ROOT) as { files: string[]; missing: string[] };

  it('is every page of the root, and nothing a page refers to is missing', () => {
    const pages = fs.readdirSync(ROOT).filter(name => name.endsWith('.html')).sort();

    expect(missing).toEqual([]);
    expect(files.filter(name => name.endsWith('.html'))).toEqual(pages);
    expect(pages).toEqual(expect.arrayContaining(['index.html', 'login.html', 'my-quotes.html', 'sunglasses-estimate.html', 'privacy-consent.html']));
  });

  it('holds every script and stylesheet that a page loads, and config.js', () => {
    for (const page of files.filter(name => name.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      for (const match of html.matchAll(/<(?:script src|link[^>]*href)="([^"?#]+)"/g)) {
        if (!/^(https?:)?\/\//.test(match[1])) {
          expect(files).toContain(match[1]);
        }
      }
    }
    expect(files).toContain('config.js');
  });

  it('is only files of the root folder that exist, with no test, document, admin screen or backend file', () => {
    for (const file of files) {
      expect(file).not.toMatch(/[\\/]/);
      expect(fs.statSync(path.join(ROOT, file)).isFile()).toBe(true);
      expect(file).not.toMatch(/\.(ts|map|md|json|sh|env)$|^jest\.|^knexfile|^package|^\./);
    }
    expect(files.some(file => file.startsWith('admin-ui') || file.startsWith('src') || file.startsWith('docs'))).toBe(false);
  });

  it('has no file twice and is in order', () => {
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual([...files].sort());
  });

  it('holds no script that the pages do not need', () => {
    const loaded = new Set<string>();
    for (const page of files.filter(name => name.endsWith('.html'))) {
      for (const reference of localReferences(fs.readFileSync(path.join(ROOT, page), 'utf8'))) {
        loaded.add(reference);
      }
    }
    for (const file of files.filter(name => !name.endsWith('.html'))) {
      expect(loaded.has(file)).toBe(true);
    }
  });
});

describe('localReferences', () => {
  it('takes the files of this site, without the query and the anchor, and leaves the rest', () => {
    const html = `
      <link rel="stylesheet" href="style.css?v=3">
      <script src="app.js"></script>
      <a href="login.html#top">x</a><a href="login.html?next=%2Fa">y</a>
      <a href="#about">z</a><a href="https://example.com/x.js">w</a><a href="//cdn.example.com/a.js">v</a>
      <a href="mailto:a@b.co">m</a><a href="tel:010">t</a><a href="javascript:void(0)">j</a>
      <img src="data:image/png;base64,AAAA"><a href="">empty</a>`;

    expect(localReferences(html)).toEqual(['style.css', 'app.js', 'login.html', 'login.html']);
  });
});

describe('a folder with a broken page', () => {
  function folder(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'front-files-'));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it('names what is referred to and missing, and what climbs out of the folder or sits in a subfolder', () => {
    const dir = folder({
      'index.html': '<script src="gone.js"></script><script src="../secret.js"></script><script src="sub/app.js"></script><script src="/abs.js"></script><link href="ok.css">',
      'ok.css': 'a {}',
      'sub/app.js': '1',
      'abs.js': '2'
    });

    const result = listFrontFiles(dir) as { files: string[]; missing: string[] };

    expect(result.files).toEqual(['abs.js', 'index.html', 'ok.css']);
    expect(result.missing).toEqual([
      '../secret.js (in index.html: not a file of the root folder)',
      'gone.js (in index.html)',
      'sub/app.js (in index.html: not a file of the root folder)'
    ]);
  });

  it('follows a link to another page, once, also when the pages link to each other', () => {
    const dir = folder({
      'a.html': '<a href="b.html">b</a>',
      'b.html': '<a href="a.html">a</a><script src="b.js"></script>',
      'b.js': '1',
      'unused.js': '2'
    });

    expect((listFrontFiles(dir) as { files: string[] }).files).toEqual(['a.html', 'b.html', 'b.js']);
  });
});
