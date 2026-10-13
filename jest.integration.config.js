// Integration tests: real PostgreSQL on THIS machine, through TEST_DATABASE_URL only.
// They are never part of `npm test`; run them with `npm run test:integration`.
// The same network guard as the unit tests applies (jest.setup.js): nothing but this machine
// is reachable, so a remote database, AWS and SendGrid stay blocked.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__integration__/**/*.int.test.ts'],
  setupFiles: ['<rootDir>/../jest.setup.js'],
  testTimeout: 30000,
  maxWorkers: 1
};
