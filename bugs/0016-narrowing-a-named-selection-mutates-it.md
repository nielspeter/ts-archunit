# Bug 0016: narrowing a named selection mutates it, and the next rule silently loses subjects

**Reported:** 2026-07-26
**Found in:** all versions through v0.19.0
**Severity:** Medium — the documented form of selection reuse is safe; the natural _narrowing_ form silently drops subjects, and the rule that loses them passes.

## Description

`should()` forks the builder (`src/core/rule-builder.ts:70-74`). `that()` does not — it sets the phase and returns `this` (`:52-55`), and `addPredicate` pushes onto the shared array (`:220-223`).

So narrowing a named selection **mutates the selection**, and every later rule derived from it inherits the narrowing.

## Reproduction

Against `tests/fixtures/poc`:

```
parsers = functions(p).that().haveNameMatching(/^parse/)
  parsers alone              [parseBarOrder, parseBazOrder, parseConfig, parseFooOrder]

rule1 = parsers.that().haveNameMatching(/Order$/)
  rule1                      [parseBarOrder, parseBazOrder, parseFooOrder]
  parsers NOW                [parseBarOrder, parseBazOrder, parseFooOrder]   <- mutated

rule2 = parsers.that().haveNameMatching(/^parseConfig$/)
  rule2                      []                                              <- wanted parseConfig
```

`rule2` asks for the one parser that `rule1` narrowed away, gets nothing, and **passes**.

## The documented form is safe

`docs/core-concepts.md:205-216` and `docs/classes.md:182-190` both show reuse as repeated `.should()`:

```typescript
const repositories = classes(p).that().extend('BaseRepository')
repositories.should().notContain(call('parseInt')).check()
repositories.should().beExported().check()
```

Measured: that form is unaffected — `should()` forks, so the selection is intact for the next rule. Only _further narrowing_ mutates.

## How it was found

`tests/builders/function-rule-builder.test.ts:178` is named **`named selection reuse works`** and demonstrates that it does not. Its second half is commented `// Rule 2: parseConfig should exist and be exported` and asserts `.not.toThrow()` — which an empty selection satisfies. The test has certified the feature since it was written, while the feature was broken.

It surfaced only because plan 0069 measured what happens when an empty selector fails ([appendix](../plans/0069-appendix-vacuous-tests.md)). Apply ADR-008's question — _what would this test do if named-selection reuse were completely broken?_ — and the answer is: pass, with a comment explaining what it believes it is checking.

## Suggested fix

Make `that()` fork, symmetrically with `should()`. The fluent form is unaffected because the fork is returned and used immediately; what changes is that a _held reference_ stops being mutated.

The risk is a caller that relies on the mutation:

```typescript
const b = classes(p)
b.that().extend('X')   // return value discarded
b.should()...          // expects the predicate to have stuck
```

`grep` finds no such usage in this repo or its docs, but it is a public API change and needs its own release note. `fork()` already exists and already deep-copies what must not be shared (`adoptFilterState`), so the change is one line plus a test.

## Guard this needs

- Narrowing a named selection twice yields two **different** subject sets, each correct.
- The documented repeated-`.should()` form keeps the full selection (no regression).
- The subject set of the original selection is unchanged after a derived rule runs.

All three must be asserted on **non-empty** sets, or they are satisfiable by the bug.

## Relationship to plan 0069

Not a glob fault — the selection is narrowed by a _name_ predicate — so `doctor` cannot see it and R3b's guard would not fire on the shape either. What R3b's empty-selector flip WOULD have caught is the symptom: `rule2` selecting nothing. That is the argument for the flip covering more than globs.
