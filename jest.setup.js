// Test-only defaults so suites do not depend on a developer's local .env.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-0123456789abcdef-0123456789';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
