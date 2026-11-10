#!/usr/bin/env node
// Lists the files of the customer pages that have to be published to the web hosting of the front end
// (`npm run front:files`). The list is not written by hand: it is every page (*.html of the root) and
// everything the pages load (scripts, stylesheets, pictures, other pages they link to) and everything
// their stylesheets load with url(), so it cannot drift away from the pages. Only files of the root
// folder itself and of assets/ (the logo, the pictures) are ever listed: never the tests, the
// documents, the admin screen (the API serves that itself) or the backend.
//
//   npm run front:files          one path a line (forward slashes)
//   npm run front:files -- --json
//
// Exit code 1 when a page or a stylesheet refers to a file that does not exist.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The one subfolder the pages may load from.
const ASSET_FOLDER = 'assets';

// Another site, mailto:, tel:, javascript:, data:, an anchor: not a file of this site.
function isLocal(raw) {
  return !(raw === '' || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw));
}

function withoutQuery(raw) {
  return decodeURIComponent(raw.split('#')[0].split('?')[0]);
}

// src="..." and href="..." that point to a file of this site.
function localReferences(html) {
  const found = [];
  const pattern = /\s(?:src|href)="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    const raw = match[1].trim();
    match = pattern.exec(html);
    if (!isLocal(raw)) {
      continue;
    }
    const clean = withoutQuery(raw);
    if (clean !== '') {
      found.push(clean);
    }
  }
  return found;
}

// url(...) of a stylesheet that point to a file of this site (comments left out).
function cssReferences(css) {
  const found = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/g;
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match = pattern.exec(code);
  while (match) {
    const raw = (match[1] ?? match[2] ?? match[3]).trim();
    match = pattern.exec(code);
    if (!isLocal(raw)) {
      continue;
    }
    const clean = withoutQuery(raw);
    if (clean !== '') {
      found.push(clean);
    }
  }
  return found;
}

// The path of a reference inside the site, with forward slashes, or null when the site may not
// publish it: only files of the root folder itself and of assets/, nothing that climbs out.
function sitePath(reference, from) {
  const base = path.posix.dirname(from);
  const resolved = path.posix.normalize(path.posix.join(base, reference.replace(/\\/g, '/').replace(/^\/+/, '')));
  if (resolved.startsWith('..') || path.posix.isAbsolute(resolved)) {
    return null;
  }
  if (resolved.includes('/') && !resolved.startsWith(`${ASSET_FOLDER}/`)) {
    return null;
  }
  return resolved;
}

// pages: the files of the root that start the walk (every .html). Returns { files, missing }.
function listFrontFiles(root = ROOT) {
  const pages = fs.readdirSync(root).filter(name => name.endsWith('.html')).sort();
  const files = new Set(pages);
  const missing = new Set();
  const queue = pages.slice();

  while (queue.length > 0) {
    const file = queue.shift();
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const references = file.endsWith('.css') ? cssReferences(text) : localReferences(text);
    for (const reference of references) {
      const resolved = sitePath(reference, file);
      if (resolved === null) {
        missing.add(`${reference} (in ${file}: not a file of the root folder)`);
        continue;
      }
      if (!fs.existsSync(path.join(root, resolved)) || !fs.statSync(path.join(root, resolved)).isFile()) {
        missing.add(`${reference} (in ${file})`);
        continue;
      }
      if (!files.has(resolved)) {
        files.add(resolved);
        // A page leads to more pages and files, a stylesheet to its pictures.
        if (resolved.endsWith('.html') || resolved.endsWith('.css')) {
          queue.push(resolved);
        }
      }
    }
  }

  return { files: [...files].sort(), missing: [...missing].sort() };
}

module.exports = { listFrontFiles, localReferences, cssReferences };

if (require.main === module) {
  const { files, missing } = listFrontFiles();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ files, missing }, null, 2)}\n`);
  } else {
    process.stdout.write(`${files.join('\n')}\n`);
    process.stderr.write(`${files.length} files to publish. config.js must hold the real API address (npm run predeploy:check -- --front).\n`);
  }
  if (missing.length > 0) {
    process.stderr.write(`Referred to but missing:\n${missing.map(item => `  ${item}`).join('\n')}\n`);
    process.exitCode = 1;
  }
}
