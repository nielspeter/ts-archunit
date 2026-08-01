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
asserting — can never fail. **As of 0.23.0 it does not "do nothing" — it fails**, as a
[configuration finding](/violation-reporting#a-rule-must-assert-something) that no
terminal, severity, exclusion, baseline or diff filter can suppress. If you are reading
this because a rule started failing with "asserts nothing and can never fail", that is
the release, and the finding names the shape you wrote and what to add.

To find them without running the rules: `npx ts-archunit doctor <your rule files>`, or
`diagnose(rules)` for rules written inside a test.

**The rule never executes.** If a rule in `arch.rules.ts` seems to do nothing, check that it does **not** end in `.check()` (or `.warn()` / `.severity()`). In a CLI rule file, those terminals execute the rule immediately and return `undefined`, so the CLI silently skips it:

```typescript
export default [
  classes(p).that().extend('Base').should().notContain(call('parseInt')).check(), // ❌ never runs
  classes(p).that().extend('Base').should().notContain(call('parseInt')), // ✅ runs
]
```

Leave rule-file builders un-terminated; use `.asSeverity('warn')` for warnings. And note the sharp edge: if a stray `.check()` in the array _fails_, it throws mid-load and drops **every other rule in that file** — so a green run can mean nothing ran. See the [conversion guide](/running-in-tests#converting-between-the-two-forms). (In a _test file_ the opposite is true — you _do_ call `.check()`.)

## "Slice discovery matched no files" / a rule selects nothing

Since **0.36.1** a project-relative glob works on every surface, so this is
usually a folder that is genuinely missing or misspelled rather than an
anchoring problem:

```typescript
slices(p).assignedFrom({ services: 'src/services/**' }) // ✅ the one at the project root
slices(p).assignedFrom({ services: '**/src/services/**' }) // ✅ any services/, anywhere

modules(p).that().resideInFolder('src/services/**') // ✅ same rule, same meaning
```

Both spellings work everywhere and mean different things — the relative one is
the **root** folder, the anchored one is any folder of that name at any depth.
Check the folder exists and holds `.ts` files your tsconfig includes.

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

## A rule that passed for months now fails: "selector can never match" or "matched 0 subjects"

**0.34.0** turned two silent passes into failures. Both mean the rule was never enforcing anything; neither is a new problem in your code.

**"This rule's selector … can never match anything in this project"** — the glob is unsatisfiable: no file or directory in the project can match it, whatever you write in your source. Usually a typo or a stale path. `ts-archunit doctor` reported this before 0.34.0 and still does, without running any rule.

**"Selector matched 0 subjects"** — the glob is fine, but nothing matched _this run_. Either the selection is genuinely empty today, or the predicate chain is narrower than you meant.

If the emptiness is correct and intended, say so in the rule:

```typescript
classes(p)
  .that()
  .haveDecorator('Deprecated')
  .expectEmpty() // nothing is deprecated yet
  .should()
  .beExported()
  .check()
```

`.expectEmpty()` fails the day the selector matches something, so it cannot rot into a permanent silencer. If the rule is a pre-emptive ban — "nothing may ever appear here" — use `.notExist()` instead, which is exempt because zero subjects is what it asserts:

```typescript
modules(p).that().resideInFolder('**/legacy/**').should().notExist().check()
```

Neither finding can be suppressed by `.warn()`, `.asSeverity('warn')`, `.excluding()`, a baseline, or `--changed`. That is deliberate ([ADR-008](https://github.com/nielspeter/ts-archunit/blob/main/adr/008-agent-first-failure-surfaces.md)): a rule that cannot fail is counted as coverage, and accepting that into a baseline would make the gap permanent and invisible.

**Before upgrading**, run `ts-archunit doctor` on 0.33.x to see the dead-glob half of this list without a red build.

## One preset option produced dozens of identical findings

Fixed in **0.34.0** — a fan-out now collapses to one finding naming the option you wrote, with the number of generated rules it affects as context. If you are on an earlier version and see dozens of identical `preset/...` findings with the same glob, they are one edit: fix the option named in the message.

## Every rule passes, and `doctor` says the project loaded 0 source files

Your tsconfig is **solution-style** — `"files": []` plus `"references"` — which is what a monorepo root usually looks like. TypeScript loads no sources from it; it only points at the projects that do. So every glob in every rule matches nothing, every rule passes over an empty set, and the run is green while enforcing nothing.

Confirm it independently of ts-archunit:

```bash
tsc -p tsconfig.json --listFilesOnly    # prints nothing
```

Point `project()` at the tsconfig that actually holds your sources:

```typescript
const p = project('tsconfig.build.json')
```

Or cover several at once with [`workspace()`](/core-concepts#monorepo-workspace).

`doctor` reports this **once per project** rather than once per glob, because the globs are not the fault — they are left undiagnosed until something loads. `check` reports it too, on any slice rule. This was [bug 0031](https://github.com/nielspeter/ts-archunit/blob/main/bugs/0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md): before it was fixed, each glob was blamed individually and the advice suggested checking spelling.

## Violations point at `tsconfig.json:1` for a compiler-option rule

Expected. [`tsconfig()`](/config-rules) checks the resolved options object, which has no source position, so every violation references the config file at line 1 rather than the offending JSON line. The message names the exact option to fix.

## Warnings show up but CI still passes

That's by design for **severity** warnings. Rules marked `.asSeverity('warn')` (and warn-severity preset rules) are reported but never fail the build — `check` exits non-zero only on **error**-severity violations. Promote a rule to failing with `.asSeverity('error')` (the default) or by removing the `warn` override.

A rule that **asserts nothing** is the one thing `warn` cannot cover: through 0.22.0 it
reported nothing at all, and since 0.23.0 it fails at `error` severity whatever you asked
for, because a rule that cannot fire has no violations to be advisory about. `doctor` and
`diagnose()` find them without running the rules (see above).

## Still stuck?

- [CLI reference](/cli) — every command, flag, and the config file.
- [Core Concepts](/core-concepts) — how projects, rules, and severity fit together.
- [Open an issue](https://github.com/NielsPeter/ts-archunit/issues).
