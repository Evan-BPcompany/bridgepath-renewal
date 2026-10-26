#!/usr/bin/env node
// Lists the files of the customer pages that have to be published to the web hosting of the front end
// (`npm run front:files`). The list is not written by hand: it is every page (*.html of the root) and
// everything the pages load (scripts, stylesheets, other pages they link to), so it cannot drift away
// from the pages. Nothing outside the root folder is ever listed, and neither are the tests, the
// documents, the admin screen (the API serves that itself) or the backend.
//
//   npm run front:files          one path a line
//   npm run front:files -- --json
//
// Exit code 1 when a page refers to a file that does not exist.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// src="..." and href="..." that point to a file of this site.
function localReferences(html) {
  const found = [];
  const pattern = /\s(?:src|href)="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    const raw = match[1].trim();
    match = pattern.exec(html);
    if (raw === '' || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      continue; // an anchor, another site, mailto:, tel:, javascript:, data:
    }
    const clean = decodeURIComponent(raw.split('#')[0].split('?')[0]);
    if (clean !== '') {
      found.push(clean);
    }
  }
  return found;
}

// pages: the files of the root that start the walk (every .html). Returns { files, missing }.
function listFrontFiles(root = ROOT) {
  const pages = fs.readdirSync(root).filter(name => name.endsWith('.html')).sort();
  const files = new Set(pages);
  const missing = new Set();
  const queue = pages.slice();

  while (queue.length > 0) {
    const page = queue.shift();
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const reference of localReferences(html)) {
      const resolved = path.normalize(reference.replace(/^\/+/, ''));
      // Only files of the root folder itself: nothing that climbs out of it or sits in a subfolder.
      if (resolved.startsWith('..') || path.isAbsolute(resolved) || resolved.includes(path.sep)) {
        missing.add(`${reference} (in ${page}: not a file of the root folder)`);
        continue;
      }
      if (!fs.existsSync(path.join(root, resolved)) || !fs.statSync(path.join(root, resolved)).isFile()) {
        missing.add(`${reference} (in ${page})`);
        continue;
      }
      if (!files.has(resolved)) {
        files.add(resolved);
        if (resolved.endsWith('.html')) {
          queue.push(resolved);
        }
      }
    }
  }

  return { files: [...files].sort(), missing: [...missing].sort() };
}

module.exports = { listFrontFiles, localReferences };

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
