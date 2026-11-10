#!/usr/bin/env node
// The audit of the production dependencies (`npm run audit:prod`, a CI step). It is
// `npm audit --omit=dev` with one difference: an advisory listed in ACCEPTED does not fail the run.
// Every other advisory does, whatever its severity, so the rule stays "no finding in production that
// nobody has looked at". An advisory is accepted only when no fixed version exists, and the reason is
// written in docs/SECURITY.md ("Dependency audit"). It fails again when its severity rises above the
// one it was accepted with. Take an entry out as soon as the run says it is no longer reported.
'use strict';

const { spawnSync } = require('child_process');

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

const ACCEPTED = Object.freeze([
  // deepmerge 4.3.1 is the newest release and is inside the range of the advisory: there is nothing to
  // update to. @sendgrid/helpers calls it in one place, to merge dynamicTemplateData, and this server
  // sends plain subject + html and never sets that (src/services/emailWorker.ts).
  Object.freeze({ id: 'GHSA-gcqx-w48m-w2h4', package: 'deepmerge', severity: 'low', since: '2026-11-10' })
]);

const rank = severity => SEVERITIES.indexOf(severity);

// The advisories of an `npm audit --json` report, each once: [{ id, package, severity, title, url }].
// A package that is only listed because it depends on a vulnerable one carries a name, not an advisory.
function advisories(report) {
  const found = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities || {})) {
    for (const via of entry.via || []) {
      if (via === null || typeof via !== 'object') {
        continue;
      }
      const url = String(via.url || '');
      const ghsa = url.match(/GHSA(?:-[0-9a-z]{4}){3}/i);
      const id = ghsa ? ghsa[0] : String(via.source || url || 'unknown');
      const pkg = String(via.name || name);
      found.set(`${id.toLowerCase()} ${pkg}`, { id, package: pkg, severity: String(via.severity || entry.severity || ''), title: String(via.title || ''), url });
    }
  }
  return [...found.values()].sort((a, b) => `${a.package} ${a.id}`.localeCompare(`${b.package} ${b.id}`));
}

// failures: what fails the run. allowed: reported and accepted. unused: accepted and no longer reported.
function checkAudit(report, accepted = ACCEPTED) {
  if (report === null || typeof report !== 'object' || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('not an npm audit report');
  }
  const list = advisories(report);
  const failures = [];
  const allowed = [];
  for (const advisory of list) {
    const rule = accepted.find(item => item.id.toLowerCase() === advisory.id.toLowerCase() && item.package === advisory.package);
    const known = rank(advisory.severity) >= 0;
    if (rule && known && rank(advisory.severity) <= rank(rule.severity)) {
      allowed.push(advisory);
    } else {
      failures.push(advisory);
    }
  }
  // A report that counts findings and names no advisory cannot be judged: it fails.
  const packages = Object.keys(report.vulnerabilities).length;
  if (packages > 0 && list.length === 0) {
    failures.push({ id: 'unknown', package: Object.keys(report.vulnerabilities).join(', '), severity: '', title: 'findings without an advisory', url: '' });
  }
  const unused = accepted.filter(item => !list.some(advisory => advisory.id.toLowerCase() === item.id.toLowerCase() && advisory.package === item.package));
  return { failures, allowed, unused };
}

module.exports = { ACCEPTED, advisories, checkAudit };

if (require.main === module) {
  const line = advisory => `  ${advisory.package}  ${advisory.severity || '?'}  ${advisory.id}  ${advisory.title}`.trimEnd();
  const run = spawnSync('npm audit --omit=dev --json', { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let result;
  try {
    result = checkAudit(JSON.parse(run.stdout));
  } catch (error) {
    // No report (no network, a registry error): never a pass.
    process.stderr.write(`npm audit gave no report that can be read (${error.message}).\n${run.stderr || ''}`);
    process.exit(1);
  }
  if (result.allowed.length > 0) {
    process.stdout.write(`Accepted (no fixed version, see docs/SECURITY.md):\n${result.allowed.map(line).join('\n')}\n`);
  }
  if (result.unused.length > 0) {
    process.stdout.write(`No longer reported, take out of ACCEPTED in scripts/audit-prod.js:\n${result.unused.map(item => `  ${item.package}  ${item.id}`).join('\n')}\n`);
  }
  if (result.failures.length > 0) {
    process.stderr.write(`Production dependencies with a finding:\n${result.failures.map(line).join('\n')}\nRun "npm audit --omit=dev" for the details.\n`);
    process.exit(1);
  }
  process.stdout.write('Production dependencies: no finding besides the accepted ones.\n');
}
