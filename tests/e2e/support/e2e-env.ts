/** Shared settings for the end-to-end tests (playwright.config.ts, tests/e2e/server.ts). */

export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Everything the test server writes lives here, apart from your development database. */
export const E2E_DATA_DIR = '.data/e2e';
export const E2E_OUTBOX_DIR = `${E2E_DATA_DIR}/outbox`;

export const E2E_ADMIN_EMAIL = 'admin@e2e.gentouch.test';

/** A member placed under a leader, who journals with their mobile number. */
export const E2E_MEMBER = { firstName: 'Grace', lastName: 'Mendoza', phone: '0917 555 0142' } as const;
export const E2E_LEADER = { firstName: 'Anna', lastName: 'Lim' } as const;
export const E2E_PASTOR = { firstName: 'Eduardo', lastName: 'Villanueva' } as const;
