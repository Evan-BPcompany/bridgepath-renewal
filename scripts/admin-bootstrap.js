// Starts the compiled bootstrap command (dist/scripts/bootstrap-admin.js) with plain Node.
// Written in plain JavaScript on purpose: it needs neither ts-node nor TypeScript, so it also
// works on an install that only has the production dependencies.
const fs = require('fs');
const path = require('path');

const compiled = path.join(__dirname, '..', 'dist', 'scripts', 'bootstrap-admin.js');

if (!fs.existsSync(compiled)) {
  process.stderr.write(
    'The compiled bootstrap command was not found (dist/scripts/bootstrap-admin.js).\n' +
      'Run "npm run build" first, then run "npm run admin:bootstrap" again. Nothing was changed.\n'
  );
  process.exitCode = 1;
} else {
  try {
    require(compiled);
  } catch (err) {
    // Never print the error message: it could contain connection details.
    const code = err && typeof err.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(err.code) ? err.code : 'unknown';
    process.stderr.write(
      `The bootstrap command could not be started (error code: ${code}). ` +
        'Run "npm run build" and try again. Nothing was changed.\n'
    );
    process.exitCode = 1;
  }
}
