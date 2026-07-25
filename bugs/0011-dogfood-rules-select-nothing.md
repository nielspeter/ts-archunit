# Bug 0011: 14 of our own dogfood rules select nothing

**Reported:** 2026-07-25
**Found in:** all versions through v0.18.1
**Severity:** High — most of this project's ADR enforcement on itself is conditionally or permanently vacuous, and one rule has never fired since it was written, hiding a live violation.

## Description

Two independent causes, both in `tests/archunit/arch-rules.test.ts`.

### (a) 13 rules depend on the checkout directory's NAME

Thirteen rules scope with `resideInFolder('**/ts-archunit/src/**')`. That glob
requires the checkout directory to be called `ts-archunit`, which is not a property
of the repository. Measured from a git worktree at a different path:

```
glob '**/ts-archunit/src/**'  ->  modules=0  functions=0  classes=0   (36 tests pass)
glob '**/src/**'              ->  modules=248  functions=955  classes=94
```

Clone into `arch/`, use a worktree, or rename the folder, and `adr005/no-any`,
`adr005/no-as-cast`, `security/no-eval`, `quality/typed-errors`,
`hygiene/no-empty-bodies`, `hygiene/no-stubs`, `security/no-json-parse`,
`quality/no-default-exports`, `quality/no-console-log` and four more all select
nothing and pass.

### (b) 1 rule is vacuous everywhere, and it is hiding a live violation

`api/no-single-glob-predicates` (`tests/archunit/arch-rules.test.ts:558-581`) scopes
with `resideInFolder('**/src/predicates/module**')`. `resideInFolder` matches the
**directory** portion, and `src/predicates/module.ts` is a **file** — so the glob
never matches. Measured:

```
resideInFolder('**/src/predicates/module**')  ->  0 subjects   (passes, always, everywhere)
resideInFile('**/src/predicates/module.ts')   ->  5 subjects
```

With the scope corrected, the rule reports the violation it was written to prevent:

```
src/predicates/module.ts:97   export function havePathMatching(glob: string)
```

So fixing the scope forces a real decision — make `havePathMatching` variadic, or
record it beside `resideInFile`/`resideInFolder` as a legitimate single-glob identity
predicate.

## The fix is not the obvious one

Measured, in a worktree at a path not named `ts-archunit`:

| Candidate replacement                           | Outcome                                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'**/src/**'`                                   | **13 rules red, 89 hits — every hit from `tests/fixtures/**/src/**`**, the corpus built to violate them                                                                                |
| `` `${dirname(p.tsConfigPath)}/src/**` ``       | passes — but returns to 0 subjects at a checkout path containing glob metacharacters (`My (work)/`), because picomatch reads `(work)` as an extglob. **Reproduces the bug it closes.** |
| `.that().satisfy(<predicate using startsWith>)` | 715 functions / 25 classes, metacharacter-proof                                                                                                                                        |

So the correct form is a **predicate**, not a glob. Note four rules already use
`'**/src/**'` and scan fixtures today (`:63`, `:78`, `:96`, `:163`) — they pass only
because no fixture happens to call `require()` or import `typescript`. Anchor those
in the same change.

## Also in this file

`quality/no-console-log` and `quality/no-console-log-fn` carry
`suggestion: 'Replace console.log() with console.warn() or remove it'`
(`:518`, `:519`, `:532`) — recommending, in an enforced rule, the channel ADR-008
says the agent consumer never reads. The remedy should be "throw, or return a
violation".

## Guard this needs

`.expectNonEmpty()` is necessary but **not sufficient** — it fires on 0 subjects, and
would not catch "1 subject where 11 were expected". It also cannot be applied
blanket: `SliceRuleBuilder extends TerminalBuilder` so `arch/no-cycles` cannot take it
(TS2339), and on `.notExist()` rules 0 subjects is the _passing_ state.

The load-bearing guard is a **file-set identity assertion** with an independent
derivation: a filesystem walk (or `git ls-files`) compared against the rule scope's
resolved file set, as sets, both sides asserted non-empty. That axis — a file's
existence vs the compiler's module graph — is the independence ADR-008 rule 5 asks
for, and it catches every failure above including the metacharacter case.

## Relationship to plan 0067 part C

Plan 0067-C already designs the generic fix: _mark path predicates with their globs
and fail when a glob matches zero project files_. That would close all 14 rules here,
the metacharacter case, and the equivalent bug in every user's ruleset — rather than
patching our own test file. **This bug is the evidence for that parked version
decision:** 14 rules, covering most of our ADR-005/hygiene/security enforcement,
silently unenforced.
