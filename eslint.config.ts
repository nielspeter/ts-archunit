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
    // `scripts/*.mjs` runs in the RELEASE path and was linted by nothing — prettier only.
    // Type-checked rules cannot apply (the files are not in any tsconfig project, which is
    // what `projectService` reported when pointed at them), so this block turns those off
    // and keeps the base rules, which is strictly better than the previous zero.
    //
    // `no-console` is off here on purpose: a release script's entire output channel is the
    // console, and the rule exists to keep it out of the LIBRARY.
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // `projectService: false` for this block: it is set globally above, and
      // `disableTypeChecked` turns off the type-aware RULES without stopping the PARSER
      // from demanding the file belong to a tsconfig project. These do not, by design.
      parserOptions: { projectService: false, project: null },
      // Declared explicitly rather than adding the `globals` package for five names. A
      // dependency for this would be more surface than the problem.
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
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
