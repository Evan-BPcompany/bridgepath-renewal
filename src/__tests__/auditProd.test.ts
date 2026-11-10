import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ACCEPTED, advisories, checkAudit } = require('../../scripts/audit-prod.js');

const ROOT = path.join(__dirname, '..', '..');

interface Advisory {
  id: string;
  package: string;
  severity: string;
}

// A piece of an `npm audit --json` report: the package with the advisory, and one that only depends on it.
const finding = (name: string, ghsa: string, severity: string, dependent?: string): Record<string, unknown> => ({
  [name]: {
    name,
    severity,
    via: [{ source: 1, name, title: `${name} has a problem`, url: `https://github.com/advisories/${ghsa}`, severity, range: '>=1.0.0' }]
  },
  ...(dependent ? { [dependent]: { name: dependent, severity, via: [name] } } : {})
});

const report = (...findings: Array<Record<string, unknown>>): { vulnerabilities: Record<string, unknown> } => ({
  vulnerabilities: Object.assign({}, ...findings)
});

const DEEPMERGE = finding('deepmerge', 'GHSA-gcqx-w48m-w2h4', 'low', '@sendgrid/helpers');

describe('the audit of the production dependencies (npm run audit:prod)', () => {
  it('passes a clean report, and says which accepted advisory is no longer reported', () => {
    const result = checkAudit(report());

    expect(result.failures).toEqual([]);
    expect(result.allowed).toEqual([]);
    expect(result.unused.map((item: Advisory) => item.id)).toEqual(ACCEPTED.map((item: Advisory) => item.id));
  });

  it('passes the accepted advisory, counted once however many packages depend on it', () => {
    const result = checkAudit(report(DEEPMERGE));

    expect(result.failures).toEqual([]);
    expect(result.allowed.map((item: Advisory) => [item.package, item.id, item.severity])).toEqual([['deepmerge', 'GHSA-gcqx-w48m-w2h4', 'low']]);
    expect(result.unused).toEqual([]);
  });

  it('fails on any other advisory, also a low one, next to the accepted one', () => {
    for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
      const result = checkAudit(report(DEEPMERGE, finding('qs', 'GHSA-aaaa-bbbb-cccc', severity, 'express')));

      expect(result.failures.map((item: Advisory) => [item.package, item.id, item.severity])).toEqual([['qs', 'GHSA-aaaa-bbbb-cccc', severity]]);
      expect(result.allowed).toHaveLength(1);
    }
  });

  it('fails on the accepted advisory when its severity rises, or when it is reported for another package', () => {
    for (const severity of ['moderate', 'high', 'critical', 'something-new', '']) {
      expect(checkAudit(report(finding('deepmerge', 'GHSA-gcqx-w48m-w2h4', severity))).failures).toHaveLength(1);
    }
    expect(checkAudit(report(finding('lodash', 'GHSA-gcqx-w48m-w2h4', 'low'))).failures).toHaveLength(1);
  });

  it('fails on a second advisory of the accepted package', () => {
    const second = { deepmerge: { name: 'deepmerge', severity: 'low', via: [
      { name: 'deepmerge', url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4', severity: 'low' },
      { name: 'deepmerge', url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx', severity: 'low' }
    ] } };

    const result = checkAudit(report(second));

    expect(result.allowed.map((item: Advisory) => item.id)).toEqual(['GHSA-gcqx-w48m-w2h4']);
    expect(result.failures.map((item: Advisory) => item.id)).toEqual(['GHSA-zzzz-yyyy-xxxx']);
  });

  it('never passes what is not a report, or a report with findings and no advisory', () => {
    for (const broken of [null, undefined, 'text', {}, { error: { code: 'ENOTFOUND' } }, { vulnerabilities: null }]) {
      expect(() => checkAudit(broken)).toThrow('not an npm audit report');
    }
    expect(checkAudit(report({ express: { name: 'express', severity: 'high', via: ['qs'] } })).failures).toHaveLength(1);
  });

  it('lists each advisory once, with the package it is about', () => {
    expect(advisories(report(DEEPMERGE, finding('qs', 'GHSA-aaaa-bbbb-cccc', 'moderate', 'express'))).map((item: Advisory) => `${item.package} ${item.id}`)).toEqual([
      'deepmerge GHSA-gcqx-w48m-w2h4',
      'qs GHSA-aaaa-bbbb-cccc'
    ]);
  });
});

describe('the list of accepted advisories', () => {
  it('holds only low findings, each with its date, and each one explained in docs/SECURITY.md', () => {
    const security = fs.readFileSync(path.join(ROOT, 'docs', 'SECURITY.md'), 'utf8');

    expect(ACCEPTED.length).toBeLessThanOrEqual(1);
    for (const item of ACCEPTED) {
      expect(item.id).toMatch(/^GHSA(-[0-9a-z]{4}){3}$/);
      expect(item.severity).toBe('low');
      expect(item.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(security).toContain(item.id);
      expect(security).toContain(item.package);
    }
  });
});
