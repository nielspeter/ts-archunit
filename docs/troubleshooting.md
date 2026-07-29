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

Two different causes share this symptom:

**The rule asserts nothing.** A selector with no condition after `.should()` — or a
predicate like `areAsync()` used _after_ `.should()`, where it filters instead of
asserting — can never fail. Run `npx ts-archunit doctor <your rule files>`, or
`diagnose(rules)` for rules written inside a test: as of 0.22.0 both name the exact
shape and the fix for it.

**The rule never executes.** If a rule in `arch.rules.ts` seems to do nothing, check that it does **not** end in `.check()` (or `.warn()` / `.severity()`). In a CLI rule file, those terminals execute the rule immediately and return `undefined`, so the CLI silently skips it:

```typescript
export default [
  classes(p).that().extend('Base').should().notContain(call('parseInt')).check(), // ❌ never runs
  classes(p).that().extend('Base').should().notContain(call('parseInt')), // ✅ runs
]
```

Leave rule-file builders un-terminated; use `.asSeverity('warn')` for warnings. And note the sharp edge: if a stray `.check()` in the array _fails_, it throws mid-load and drops **every other rule in that file** — so a green run can mean nothing ran. See the [conversion guide](/running-in-tests#converting-between-the-two-forms). (In a _test file_ the opposite is true — you _do_ call `.check()`.)

## "Slice discovery matched no files" / a rule selects nothing

Almost always an **unanchored glob**. Globs are matched against the _absolute_ file
path, so `'src/services/**'` matches nothing — write `'**/src/services/**'`:

```typescript
slices(p).assignedFrom({ services: 'src/services/**' }) // ❌ 0 files
slices(p).assignedFrom({ services: '**/src/services/**' }) // ✅
```

The same applies to preset options (`layers`, `folders`, `shared`, `src`) and to
path predicates like `resideInFolder()`. Anchoring `layers` but forgetting
`shared` is the common half-fix: with `strict: true` that turns the no-op into a
_false positive_ on imports your config actually permits.

Import globs need it too, for the path-shaped ones. They are matched against **both**
the resolved absolute path and — for non-relative specifiers only — the specifier as
written, and either may match. So `notImportFrom('fastify')` works whether or not
fastify is installed, while `notImportFrom('**/src/repositories/**')` needs the anchor.

Three real exceptions: `matching()`, where `'src/features/*'`, `'src/features/*/'`
and `'**/src/features/*'` are interchangeable; `.excluding()`, which takes an exact
string or `RegExp`, not a glob; and GraphQL's `schema()` / `resolvers()`, whose globs
are relative to the tsconfig directory.

Since v0.18 this **fails** instead of passing silently, and the failure names the
glob at fault: a rule that discovers nothing enforces nothing. If a rule reports
no violations and you expected some, check the glob before concluding the codebase
is clean — see [Glob conventions](/slices#glob-conventions-read-this-first).

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

That's by design for **severity** warnings. Rules marked `.asSeverity('warn')` (and warn-severity preset rules) are reported but never fail the build — `check` exits non-zero only on **error**-severity violations. Promote a rule to failing with `.asSeverity('error')` (the default) or by removing the `warn` override.

Separately, a rule that **asserts nothing** never reports at all — no violation, no
warning — because there is nothing for it to check. `doctor` and `diagnose()` are what
surface those (see above); the next minor turns them into failures.

## Still stuck?

- [CLI reference](/cli) — every command, flag, and the config file.
- [Core Concepts](/core-concepts) — how projects, rules, and severity fit together.
- [Open an issue](https://github.com/NielsPeter/ts-archunit/issues).
