import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('CI workflow', () => {
  it('builds, tests, audits production dependencies and scans for secrets', () => {
    for (const step of ['npm run build', 'npm test', 'npm run audit:prod', 'npm run secret-scan']) {
      expect(workflow).toContain(step);
    }
  });

  it('audits development dependencies in a separate job', () => {
    expect(workflow).toMatch(/audit-dev:/);
    expect(workflow).toContain('npm run audit:dev');
  });

  it('never gives the pipeline AWS or SendGrid credentials', () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/AWS_|SENDGRID_|S3_BUCKET|[ 	]DATABASE_URL:/);
  });

  it('keeps the integration job off by default and local-only', () => {
    expect(workflow).toMatch(/run_integration:[\s\S]*default: false/);
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.run_integration == true");
    expect(workflow).toContain('postgres://ci:ci@127.0.0.1:5432/bridgepath_test');
    expect(workflow).toContain("REQUIRE_INTEGRATION: 'true'");
    // The unit test job does not run the integration tests.
    expect(workflow.split('integration:')[0]).not.toContain('test:integration');
  });

  it('uses Node 20, the lowest supported version', () => {
    expect(workflow).toContain('node-version: 20');
    expect(pkg.engines).toEqual({ node: '>=20' });
  });

  it('the npm scripts the workflow calls exist', () => {
    for (const name of ['build', 'test', 'audit:prod', 'audit:dev', 'secret-scan', 'test:integration']) {
      expect(pkg.scripts[name]).toBeDefined();
    }
    expect(pkg.scripts['audit:prod']).toContain('--omit=dev');
    expect(pkg.scripts.test).not.toContain('integration');
  });
});
