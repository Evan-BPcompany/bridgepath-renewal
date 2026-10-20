import fs from 'fs';
import path from 'path';

// Helpers for the tests that run the browser scripts of the root folder in jsdom.
// The scripts are plain browser scripts, so they are evaluated in the global scope of the page
// (indirect eval) in the order of the HTML, not required as modules.
const ROOT = path.join(__dirname, '..', '..', '..');

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

export function readRoot(name: string): string {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

export function runScript(name: string): void {
  // estimate-common.js declares `let selectedCategory` at the top level; a second evaluation in
  // the same page would be a SyntaxError, so it is turned into a var here (the browser loads it once).
  const source = readRoot(name).replace(/^let selectedCategory/m, 'var selectedCategory');
  (0, eval)(source);
}

export interface LoadedPage {
  dispose: () => void;
}

// Puts the real HTML of a page into the document and runs the scripts as the browser would:
// they are evaluated while the document is "loading" and DOMContentLoaded is dispatched at the end.
export function loadPage(htmlName: string, scripts: string[]): LoadedPage {
  const html = readRoot(htmlName);
  const parsed = new g.DOMParser().parseFromString(html, 'text/html');
  g.document.documentElement.replaceChild(g.document.importNode(parsed.body, true), g.document.body);

  const registered: Array<(event: unknown) => void> = [];
  const original = g.document.addEventListener.bind(g.document);
  g.document.addEventListener = (type: string, listener: (event: unknown) => void, options?: unknown) => {
    if (type === 'DOMContentLoaded') {
      registered.push(listener);
    }
    return original(type, listener, options);
  };
  Object.defineProperty(g.document, 'readyState', { value: 'loading', configurable: true });
  try {
    scripts.forEach(runScript);
    g.document.dispatchEvent(new g.Event('DOMContentLoaded'));
  } finally {
    g.document.addEventListener = original;
    delete g.document.readyState;
  }
  return {
    dispose() {
      registered.forEach(listener => g.document.removeEventListener('DOMContentLoaded', listener));
      g.document.body.innerHTML = '';
    }
  };
}

export const API_SCRIPTS = ['config.js', 'estimate-api.js'];
export const PAGE_SCRIPTS = (page: string): string[] => [
  'config.js',
  'estimate-api.js',
  'estimate-common.js',
  'estimate-customer-step.js',
  'estimate-submit.js',
  'estimate-flow.js',
  `${page}-estimate.js`
];
