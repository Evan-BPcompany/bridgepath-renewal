import path from 'path';
import { Router, Request, Response } from 'express';
import { APPROVED_CONSENT_VERSIONS, DEV_DRAFT_CONSENT_VERSION } from '../config/privacyConsent';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listFrontFiles } = require('../../scripts/front-files.js');

// The project folder: the same two levels up from src/routes and from dist/routes.
const ROOT = path.join(__dirname, '..', '..');

// config.js is not a file here: the server writes it, so the pages call this same address (API_BASE is
// empty) and carry the consent version that the server accepts. Nothing in it is secret.
export function buildSiteConfig(nodeEnv: string): string {
  const preProduction = nodeEnv === 'development' || nodeEnv === 'test';
  const approved = APPROVED_CONSENT_VERSIONS[APPROVED_CONSENT_VERSIONS.length - 1];
  const version = approved ?? (preProduction ? DEV_DRAFT_CONSENT_VERSION : '');

  return [
    '(function () {',
    "    'use strict';",
    '    globalThis.BridgePathConfig = Object.freeze({',
    "        API_BASE: '',",
    `        PRIVACY_CONSENT_VERSION: ${JSON.stringify(version)},`,
    "        PRIVACY_CONSENT_URL: 'privacy-consent.html',",
    '        REQUEST_TIMEOUT_MS: 60000',
    '    });',
    '})();',
    ''
  ].join('\n');
}

export interface SitePagesOptions {
  nodeEnv: string;
  root?: string;
}

// The customer pages, served by this server so that pages and API share one address (the session
// cookie is then first-party and there is no CORS). Only the files that the pages themselves use
// (the same list as `npm run front:files`) are served: never package.json, the source, the
// documents or the .env file that sit in the same folder.
export function createSitePagesRouter(options: SitePagesOptions): Router {
  const root = options.root ?? ROOT;
  const { files } = listFrontFiles(root) as { files: string[] };
  const served = new Set(files.filter(name => name !== 'config.js'));
  const configSource = buildSiteConfig(options.nodeEnv);
  const router = Router();

  router.get('/config.js', (_req: Request, res: Response) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache').send(configSource);
  });

  router.get(['/', '/:file'], (req: Request, res: Response, next) => {
    const name = req.params.file === undefined ? 'index.html' : String(req.params.file);
    if (!served.has(name)) {
      next();
      return;
    }
    // no-cache: the browser asks again every time (cheap with an ETag), so a new version is never stale.
    res.set('Cache-Control', 'no-cache');
    res.sendFile(name, { root, dotfiles: 'deny' }, err => {
      if (err && !res.headersSent) {
        next();
      }
    });
  });

  return router;
}
