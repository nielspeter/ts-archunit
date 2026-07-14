# Troubleshooting

The predictable first-day snags and how to get past them.

## My first `npm run arch` reported hundreds of violations

Expected on an existing codebase — the [`recommended`](/presets#recommended) floor and any presets you added are seeing years of accumulated code at once. Don't fix them all before you can use the tool. **Baseline them:**

```bash
npm run arch:baseline          # records current violations as accepted debt
git add arch-baseline.json && git commit -m "chore: arch baseline"
npm run arch                    # now only NEW violations fail
```

Then fix the legacy violations down over time and regenerate the baseline to ratchet. See [Setup & Best Practices](/setup-best-practices#adopting-on-an-existing-codebase).

## A rule I added isn't firing

If a rule in `arch.rules.ts` seems to do nothing, check that it does **not** end in `.check()` (or `.warn()` / `.severity()`). In a CLI rule file, those terminals execute the rule immediately and return `undefined`, so the CLI silently skips it:

```typescript
export default [
  classes(p).that().extend('Base').should().notContain(call('parseInt')).check(), // ❌ never runs
  classes(p).that().extend('Base').should().notContain(call('parseInt')), // ✅ runs
]
```

Leave rule-file builders un-terminated; use `.asSeverity('warn')` for warnings. And note the sharp edge: if a stray `.check()` in the array _fails_, it throws mid-load and drops **every other rule in that file** — so a green run can mean nothing ran. See the [conversion guide](/running-in-tests#converting-between-the-two-forms). (In a _test file_ the opposite is true — you _do_ call `.check()`.)

## `init` refuses because a file already exists

`init` is non-destructive by default — it won't overwrite your config or rules. Preview what it would do, or overwrite deliberately:

```bash
npx ts-archunit init --dry-run   # show what would be created, write nothing
npx ts-archunit init --force     # overwrite existing files
```

## `tsconfig not found` / the project won't load

`project('tsconfig.json')` resolves the path relative to the current working directory. Pass the path you actually run from, or an absolute/relative path to the right config:

```typescript
const p = project('./config/tsconfig.build.json')
```

In a monorepo, load the specific package's tsconfig, or use [`workspace()`](/core-concepts#monorepo-workspace) to unify several.

## Violations point at `tsconfig.json:1` for a compiler-option rule

Expected. [`tsconfig()`](/config-rules) checks the resolved options object, which has no source position, so every violation references the config file at line 1 rather than the offending JSON line. The message names the exact option to fix.

## Warnings show up but CI still passes

That's by design. Rules marked `.asSeverity('warn')` (and warn-severity preset rules) are reported but never fail the build — `check` exits non-zero only on **error**-severity violations. Promote a rule to failing with `.asSeverity('error')` (the default) or by removing the `warn` override.

## Still stuck?

- [CLI reference](/cli) — every command, flag, and the config file.
- [Core Concepts](/core-concepts) — how projects, rules, and severity fit together.
- [Open an issue](https://github.com/NielsPeter/ts-archunit/issues).
