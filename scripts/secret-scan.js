// Looks for credentials that should never be committed. Plain Node, no dependencies, and it
// only reads files: nothing is sent anywhere.
//
//   node scripts/secret-scan.js          scan the files git knows about (tracked + untracked,
//                                         minus anything ignored)
//
// Exit code 0: nothing found. 1: findings (printed as path:line and rule only, never the value).
// A line that holds a deliberate fake value can end with the marker "secret-scan:allow".
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ALLOW_MARKER = 'secret-scan:allow';
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '_bmad-output']);
const SKIPPED_FILES = new Set(['package-lock.json']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|mov)$/i;

// Database hosts and passwords that are obviously placeholders.
const SAFE_DB_HOSTS = /^(localhost|127\.0\.0\.1|\[?::1\]?|.*\.invalid|.*\.example|example\.(com|org|net)|host|hostname|db|postgres)$/i;
const PLACEHOLDER_PASSWORD = /^(password|pass|pwd|secret|changeme|change_me|xxx+|\*+|user|postgres|<.*>|\$\{.*\}|\$[A-Z_]+|%s)$/i;

const RULES = [
  { id: 'aws-access-key-id', pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  {
    id: 'aws-secret-access-key',
    pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i
  },
  { id: 'sendgrid-api-key', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { id: 'private-key-block', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { id: 'json-web-token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    id: 'jwt-secret-value',
    pattern: /\bJWT_SECRET\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{32,}/
  }
];

const DB_URL = /\bpostgres(?:ql)?:\/\/([^\s:/@'"`]+):([^\s@'"`]+)@([^\s:/'"`?]+)/gi;

// Test code is full of made-up database URLs (u:p@db.local); that one rule is not applied there.
// Every other rule still is.
const TEST_CODE = /(^|\/)(__tests__|__integration__)\//;

function scanLine(line, options = {}) {
  if (line.includes(ALLOW_MARKER)) {
    return [];
  }

  const found = [];
  for (const rule of RULES) {
    if (rule.pattern.test(line)) {
      found.push(rule.id);
    }
  }

  DB_URL.lastIndex = 0;
  let match;
  while (!options.testCode && (match = DB_URL.exec(line)) !== null) {
    const [, , password, host] = match;
    // Template placeholders such as ${password} are not secrets either.
    if (!PLACEHOLDER_PASSWORD.test(password) && !SAFE_DB_HOSTS.test(host)) {
      found.push('database-url-with-password');
    }
  }

  return found;
}

// Returns [{ file, line, rule }] for one file's text. The matching text is never returned.
function scanText(file, text) {
  const findings = [];
  const options = { testCode: TEST_CODE.test(file) };
  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of scanLine(line, options)) {
      findings.push({ file, line: index + 1, rule });
    }
  });
  return findings;
}

function listFilesWithGit(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return out.split('\0').filter(Boolean);
}

function listFilesByWalking(root, dir = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        result.push(...listFilesByWalking(root, relative));
      }
    } else {
      result.push(relative);
    }
  }
  return result;
}

function listFiles(root) {
  let files;
  try {
    files = listFilesWithGit(root);
  } catch {
    files = listFilesByWalking(root);
  }
  return files.filter(file => {
    const parts = file.split('/');
    return (
      !parts.some(part => SKIPPED_DIRS.has(part)) &&
      !SKIPPED_FILES.has(parts[parts.length - 1]) &&
      !BINARY_EXTENSIONS.test(file)
    );
  });
}

function scanProject(root) {
  const findings = [];
  for (const file of listFiles(root)) {
    const full = path.join(root, file);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      continue;
    }
    findings.push(...scanText(file, fs.readFileSync(full, 'utf8')));
  }
  return findings;
}

function main() {
  const root = path.join(__dirname, '..');
  const findings = scanProject(root);

  if (findings.length === 0) {
    console.log('secret-scan: no credentials found.');
    return 0;
  }

  console.error(`secret-scan: ${findings.length} possible credential(s) found (values are not printed):`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`);
  }
  console.error(`If a value is a deliberate fake, end that line with "${ALLOW_MARKER}".`);
  return 1;
}

module.exports = { scanLine, scanText, scanProject, listFiles, ALLOW_MARKER };

if (require.main === module) {
  process.exitCode = main();
}
