module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/../jest.setup.js'],
  // Coverage is measured with `npm run test:coverage`. Not measured: the tests themselves,
  // migrations (run only against a database), type declarations, the integration harness
  // (needs PostgreSQL) and the process entry points (index.ts, scripts/bootstrap-admin.ts, scripts/integration-schemas.ts).
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!__tests__/**',
    '!__integration__/**',
    '!db/migrations/**',
    '!types/**',
    '!index.ts',
    '!scripts/bootstrap-admin.ts',
    '!scripts/integration-schemas.ts'
  ],
  coverageThreshold: {
    global: {
      lines: 95,
      statements: 95,
      branches: 87,
      functions: 95
    }
  }
};
