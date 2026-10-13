// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanText, scanLine, scanProject } = require('../../scripts/secret-scan.js');

// Fake credentials are assembled at run time so this file itself is clean for the scanner.
const aws = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const sendgrid = ['SG', 'a'.repeat(22), 'b'.repeat(43)].join('.');
const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJhIjoiYiIsImMiOiJkIn0', 'c2lnbmF0dXJlMTIzNDU2'].join('.');
const pem = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');

describe('secret scan rules', () => {
  it.each([
    ['AWS access key id', `key = "${aws}"`, 'aws-access-key-id'],
    ['SendGrid key', `SENDGRID_API_KEY=${sendgrid}`, 'sendgrid-api-key'],
    ['JWT', `token: ${jwt}`, 'json-web-token'],
    ['private key block', pem, 'private-key-block'],
    ['JWT_SECRET value', `JWT_SECRET=${'x'.repeat(40)}`, 'jwt-secret-value'],
    ['AWS secret', `aws_secret_access_key = ${'A'.repeat(40)}`, 'aws-secret-access-key'],
    ['real-looking database URL', 'DATABASE_URL=postgres://admin:R3alPassw0rd@ec2-1-2-3-4.compute.amazonaws.com:5432/d', 'database-url-with-password']
  ])('finds %s', (_name, line, rule) => {
    expect(scanLine(line)).toEqual([rule]);
  });

  it.each([
    'DATABASE_URL=postgresql://user:password@localhost:5432/bridgepath_dev',
    'DATABASE_URL=postgres://u:p@127.0.0.1:5432/app_test',
    'url = postgres://u:pw@host.example.invalid/app',
    'const url = `postgres://user:${password}@host:5432/db`',
    'JWT_SECRET=',
    'JWT_SECRET=<generate a long random value>',
    'SENDGRID_API_KEY=',
    'AWS_ACCESS_KEY_ID='
  ])('ignores placeholders: %s', line => {
    expect(scanLine(line)).toEqual([]);
  });

  it('honours the allow marker', () => {
    expect(scanLine(`key = "${aws}" // secret-scan:allow`)).toEqual([]);
  });

  it('reports file and line, never the value', () => {
    const findings = scanText('src/a.ts', `line one\nkey = "${aws}"\n`);

    expect(findings).toEqual([{ file: 'src/a.ts', line: 2, rule: 'aws-access-key-id' }]);
    expect(JSON.stringify(findings)).not.toContain(aws);
  });

  it('does not apply the database URL rule to test code, but every other rule', () => {
    const dbLine = 'postgres://admin:R3alPassw0rd@ec2-1-2-3-4.compute.amazonaws.com/d';

    expect(scanText('src/__tests__/x.test.ts', dbLine)).toEqual([]);
    expect(scanText('src/config.ts', dbLine)).toHaveLength(1);
    expect(scanText('src/__tests__/x.test.ts', aws)).toHaveLength(1);
  });

  it('the project itself is clean', () => {
    expect(scanProject(require('path').join(__dirname, '..', '..'))).toEqual([]);
  });
});
