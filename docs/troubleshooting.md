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

To find them without evaluating their conditions: `npx ts-archunit doctor <your rule files>`, or
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

## New violations after an upgrade, on a file nobody touched: "dynamically imports" or "references the type from"

You did not write the dependency this run is reporting. It was there before, and the release you
just took is the reason it is visible now — this is the expected outcome of an
enforcement-widening release, not a false positive and not a regression in your code.

**Since 0.56.0**, `notDependOn()` and `respectLayerOrder()` count two edge kinds they previously
ignored:

| Message                                          | The edge it found                                   |
| ------------------------------------------------ | --------------------------------------------------- |
| `Slice "x" dynamically imports … slice "y"`      | `import('…')` — a lazy import, still a dependency   |
| `Slice "x" references the type from … slice "y"` | `type T = import('…').Y` — a type-expression import |

A lazy import of a forbidden slice is still coupling: it still breaks when the target is deleted,
and nobody is applying a remedy by writing it. So the finding is true; it was simply unreachable
before.

**`beFreeOfCycles()` is deliberately not affected.** A dynamic import cannot deadlock
initialization and is often the deliberate _fix_ for a cycle, so reporting it there would fail a
rule for applying its own remedy. If you see a dynamic import in a cycle finding, that is a bug —
please report it.

A second, rarer source of new red in the same release: if one file reaches one module **twice by the
same specifier** (two `import('./x.js')` calls, say), those two findings used to share a single
baseline entry, so accepting one silently accepted the other. They are now separate entries and the
hidden one is reported — in `notImportFrom()`/`onlyImportFrom()`/`dependOn()` as well as the slice
conditions.

**By the same specifier, in 0.56.0 only.** In that release, two _different_ spellings resolving to
one file — a `paths` alias, or a workspace package name, beside a relative path — still shared one
entry. **0.57.0 fixes that**, so if it is your layout, read the 0.57.0 section below: your exposure
did change, one release later than this paragraph originally said it would.

**What to do:** triage them, or hold the rule at `.asSeverity('warn')` and ratchet down. Do **not**
regenerate the baseline to absorb them — see [Upgrading](/upgrading) for why that is the one action
this project asks you never to take. Nothing needs regenerating for this release: no existing
baseline entry moves.

## After upgrading to 0.57.0: a violation I already accepted is reported again, or a file I never touched went red

Neither is a regression, and in both cases the violation is real.

Until 0.57.0, two findings of one rule could be **indistinguishable to the baseline** — two orphan
`index.ts` files under `noDeadModules()`, two `import('./x.js')` calls in one file, two spellings of
one module, two duplicate bodies. They shared a single entry, so accepting one silently accepted the
other, including a sibling that appeared months later. They now get separate entries.

**"A violation identical to one I accepted is reported again."** It is not the same violation — it is
the sibling that was hiding behind it, and it has been real the whole time. The one you accepted still
matches; nothing was invalidated.

**"A file I never touched went red, and the one I just added is silent."** Within a colliding group
the suffix follows source order, so adding a member above the first shifts which one holds the
unsuffixed identity. The **number** of new findings is always correct — you added one violation and
you got one red. The **file named** may be a sibling. Fix any member of the group and the count drops
by one; the group is the unit, not the individual file.

**To see which findings this affects, before you upgrade**, on 0.56.0:

```bash
jq -r '(.violations|length) as $n | ([.violations[].hash]|unique|length) as $d
  | "\($n) entries, \($d) distinct — \($n - $d) finding(s) hidden inside another entry"' \
  arch-baseline.json
```

Duplicate `hash` values in `arch-baseline.json` **are** the collisions. Refresh the baseline on 0.56.0
**first** — the command only sees collisions that existed when the file was written, so a sibling
added since the last refresh is invisible to it. `0 finding(s) hidden` after a fresh refresh means
this release adds nothing for you.

**Do not regenerate the baseline to make the new red go away.** See [Upgrading](/upgrading).

## A rule that passed for months now fails: "selector can never match" or "matched 0 subjects"

**0.34.0** turned two silent passes into failures. Both mean the rule was never enforcing anything; neither is a new problem in your code.

**"This rule's selector … can never match anything in this project"** — the glob is unsatisfiable: no file or directory in the project can match it, whatever you write in your source. Usually a typo or a stale path. `ts-archunit doctor` reported this before 0.34.0 and still does, without evaluating any condition.

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

That's by design for **severity** warnings. Rules marked `.asSeverity('warn')` (and warn-severity preset rules) are reported but never fail the build — `check` exits non-zero only on **error**-severity violations. **One exception, since 0.34.0 and now much easier to meet:** a _configuration_ finding — a rule that cannot enforce anything, such as a dead glob or one that examined zero units — is `error` regardless of severity and fails the build. `'warn'` grades violations of a rule that works; it does not grade a rule that does not. Promote a rule to failing with `.asSeverity('error')` (the default) or by removing the `warn` override.

A rule that **asserts nothing** is the one thing `warn` cannot cover: through 0.22.0 it
reported nothing at all, and since 0.23.0 it fails at `error` severity whatever you asked
for, because a rule that cannot fire has no violations to be advisory about. `doctor` and
`diagnose()` find them without evaluating their conditions (see above).

## Still stuck?

- [CLI reference](/cli) — every command, flag, and the config file.
- [Core Concepts](/core-concepts) — how projects, rules, and severity fit together.
- [Open an issue](https://github.com/NielsPeter/ts-archunit/issues).
