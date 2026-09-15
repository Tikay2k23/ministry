// Deterministic environment for tests (no real secrets, no network).
process.env.APP_URL ??= 'http://localhost:3000';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.DATABASE_URL ??= 'pglite://memory';
process.env.EMAIL_PROVIDER ??= 'console';
