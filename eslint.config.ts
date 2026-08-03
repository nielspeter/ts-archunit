import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    // `tests/__generated__/**`: probe files written at runtime by
    // `warn-survives-the-test-runner.test.ts` and deleted in `afterAll`. A KILLED
    // run leaves them behind, and because they are excluded from `tsconfig.json`
    // the type-checked parser then errors on them — so `npm run lint` fails on a
    // file nobody wrote, before the test step that prunes them ever runs. They are
    // gitignored, so `git status` shows nothing to explain it.
    //
    // The vitest half of the same hazard is pruned at config load; this is the
    // lint half, and it was found by planting the leftovers and watching validate
    // fail one step earlier than expected.
    ignores: [
      'dist/**',
      'coverage/**',
      'tests/fixtures/**',
      'tests/__generated__/**',
      'docs/.vitepress/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  prettierConfig,
)
