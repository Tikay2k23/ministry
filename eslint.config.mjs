import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Architecture rule (docs/02 §2): domain modules are framework-agnostic.
    files: ['src/server/modules/**/*.ts', 'src/server/policy/**/*.ts', 'src/server/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['next', 'next/*'], message: 'Domain code must not depend on Next.js.' },
            { group: ['react', 'react-dom'], message: 'Domain code must not depend on React.' },
            { group: ['@/components/*', '@/app/*'], message: 'Domain code must not import UI code.' },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'drizzle/**', 'coverage/**', '.data/**', 'next-env.d.ts']),
]);
