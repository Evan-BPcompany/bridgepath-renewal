import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listFrontFiles, localReferences, cssReferences } = require('../../scripts/front-files.js');

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

  it('is only files of the root folder and of assets/ that exist, with no test, document, admin screen or backend file', () => {
    for (const file of files) {
      expect(file).toMatch(/^(assets\/([^\\/]+\/)*)?[^\\/]+$/);
      expect(file).not.toContain('..');
      expect(fs.statSync(path.join(ROOT, file)).isFile()).toBe(true);
      expect(file).not.toMatch(/\.(ts|map|md|json|sh|env)$|^jest\.|^knexfile|^package|^\./);
    }
    expect(files.some(file => file.startsWith('admin-ui') || file.startsWith('src') || file.startsWith('docs'))).toBe(false);
  });

  it('has no file twice and is in order', () => {
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual([...files].sort());
  });

  it('holds no file that neither a page nor a stylesheet of the list needs', () => {
    const loaded = new Set<string>();
    for (const page of files.filter(name => name.endsWith('.html'))) {
      for (const reference of localReferences(fs.readFileSync(path.join(ROOT, page), 'utf8'))) {
        loaded.add(reference);
      }
    }
    for (const sheet of files.filter(name => name.endsWith('.css'))) {
      for (const reference of cssReferences(fs.readFileSync(path.join(ROOT, sheet), 'utf8'))) {
        loaded.add(reference);
      }
    }
    for (const file of files.filter(name => !name.endsWith('.html'))) {
      expect(loaded.has(file)).toBe(true);
    }
  });

  it('holds the FINDER GREEN mark of the bar at the top, the logo of the closing and the icons of the tab, all in assets/, and no file of assets/ that no page uses', () => {
    expect(files).toContain('assets/logo/finder-green-symbol-green.svg');
    expect(files).toContain('assets/logo/finder-green-signature-white.svg');
    // The fonts and the home's pictures are there because a page or a stylesheet names them; the original PNGs the user
    // put in assets/media are not, because no page names them.
    expect(files.filter(file => file.startsWith('assets/'))).toEqual([
      'assets/fonts/Pretendard-Medium.subset.woff2',
      'assets/fonts/Pretendard-Regular.subset.woff2',
      'assets/fonts/Pretendard-SemiBold.subset.woff2',
      'assets/logo/apple-touch-icon.png',
      'assets/logo/favicon.ico',
      'assets/logo/favicon.svg',
      'assets/logo/finder-green-signature-white.svg',
      'assets/logo/finder-green-symbol-green.svg',
      'assets/media/choice-shoes.webp',
      'assets/media/choice-sunglasses.webp',
      'assets/media/choice-tees.webp',
      'assets/media/hero-fairway-poster.webp',
      'assets/media/hero-fairway.mp4',
      'assets/media/moq-shoes.webp',
      'assets/media/moq-sunglasses.webp',
      'assets/media/moq-tees.webp',
      'assets/media/process-dispatch.webp',
      'assets/media/process-material.webp',
      'assets/media/process-production.webp',
      'assets/media/process-sample.webp',
      'assets/media/process-spec.webp'
    ]);
  });
});

describe('cssReferences', () => {
  it('takes the files of url(), quoted or not, and leaves data:, other sites and the comments', () => {
    const css = `
      /* url("in-a-comment.png") and an empty url() */
      .a { background: url("assets/a.png?v=2") no-repeat, url('assets/b.svg#mark'); }
      .b { background-image: url(assets/c.jpg); }
      .c { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"); }
      .d { background: url(https://example.com/x.png), url("//cdn.example.com/y.png"); }`;

    expect(cssReferences(css)).toEqual(['assets/a.png', 'assets/b.svg', 'assets/c.jpg']);
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

  it('lists the files of assets/ that a page or its stylesheet uses, and names the ones that are missing or elsewhere', () => {
    const dir = folder({
      'index.html': '<link rel="stylesheet" href="site.css"><img src="assets/logo/mark.png"><img src="assets/gone.png"><img src="photos/shoe.jpg"><img src="assets/../secret.png">',
      'site.css': '.a { background: url("assets/arch.svg"); } .b { background: url("assets/no-such.jpg"); } .c { background: url("../outside.png"); }',
      'assets/logo/mark.png': '1',
      'assets/arch.svg': '2',
      'assets/unused.png': '3',
      'photos/shoe.jpg': '4',
      'secret.png': '5'
    });

    const result = listFrontFiles(dir) as { files: string[]; missing: string[] };

    // assets/../secret.png is the file secret.png of the root folder: listed by the path it really has.
    expect(result.files).toEqual(['assets/arch.svg', 'assets/logo/mark.png', 'index.html', 'secret.png', 'site.css']);
    expect(result.missing).toEqual([
      '../outside.png (in site.css: not a file of the root folder)',
      'assets/gone.png (in index.html)',
      'assets/no-such.jpg (in site.css)',
      'photos/shoe.jpg (in index.html: not a file of the root folder)'
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
