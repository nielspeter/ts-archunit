# Bug 0016: narrowing a named selection mutates it, and the next rule silently loses subjects

**Reported:** 2026-07-26
**Fixed:** 2026-07-28
**Found in:** all versions through v0.20.0
**Severity:** High. Filed as Medium on the strength of "the documented form of selection reuse is safe" — true of the two doc pages checked, false of `docs/graphql.md`, which teaches the held-selection shape on the one builder hierarchy that forked in neither `that()` nor `should()`.

## Description

Chain methods mutated the builder and returned `this`, so a builder held in a variable was edited in place by every rule derived from it. The narrowing case is the one that reads most obviously correct and silently loses subjects:

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

## Scope: 40 methods, 12 classes

The report named `RuleBuilder.that()`. A sweep of `src/` for "mutates its own state, then returns `this`" found **40 methods across 12 classes**, and **9 of those classes are outside `RuleBuilder`'s hierarchy** — so a fix on `RuleBuilder` could not have reached them. The sweep is now a test (below), which is how the numbers here are counted rather than typed:

| Class                                                                     | Method(s)                                                                                                | What a leak does                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `RuleBuilder`                                                             | `that`, `expectNonEmpty`, `addPredicate`, `addCondition`                                                 | narrows a later rule; leaks the non-vacuity opt-in                                         |
| `TerminalBuilder`                                                         | `because`, `rule`, `excluding`, `asSeverity`                                                             | leaks a suppression, or a rule id that baselines are keyed on                              |
| `CallRuleBuilder`                                                         | `identifiedByArg`                                                                                        | leaks call-identity folding                                                                |
| `SchemaRuleBuilder`                                                       | every predicate and condition method                                                                     | **worst case** — no fork at all, so rules accumulate                                       |
| `ResolverRuleBuilder`                                                     | every predicate and condition method                                                                     | same                                                                                       |
| `SliceRuleBuilder`                                                        | `matching`, `assignedFrom`, three condition methods                                                      | re-discovery replaces the held slice set; conditions stack                                 |
| `SmellBuilder` + `DuplicateBodiesBuilder` + `InconsistentSiblingsBuilder` | `inFolder`, `minLines`, `ignoreTests`, `ignorePaths`, `groupByFolder`, `withMinSimilarity`, `forPattern` | an inherited **ignore** is invisible and turns a later rule green                          |
| `CorrespondenceBuilder`                                                   | `side`, `beComplete`, `haveNoOrphans`, `beBijective`, `allowEmpty`, `distinctKeysOn`                     | an inherited `allowEmpty` hides an empty side                                              |
| `TsconfigBuilder`                                                         | `requires`                                                                                               | requirements accumulate across rules                                                       |
| `CrossLayerBuilder`                                                       | `layer`                                                                                                  | `mapping()` pairs _consecutive_ layers, so an extra layer changes which pairs are compared |

The GraphQL pair is the reason the severity was wrong. `docs/graphql.md:85,93,103,193,200` teaches exactly the held-selection form, and measured: two rules off one `schemaFromSDL()` gave the second rule the first's predicate _and_ condition. Every test in `tests/graphql/schema-rules.test.ts` built a fresh schema per rule, so there was no coverage of the shape the docs teach.

## The documented form was safe — as far as it was checked

`docs/core-concepts.md:205-216` and `docs/classes.md:182-190` show reuse as repeated `.should()`, and `should()` forked. That is what "the documented form is safe" was based on. It did not survive contact with the third doc page.

## How it was found

`tests/builders/function-rule-builder.test.ts:178` was named **`named selection reuse works`** and demonstrated that it did not. Its second half was commented `// Rule 2: parseConfig should exist and be exported` and asserted `.not.toThrow()` — which an empty selection satisfies. The test certified the feature from the day it was written, while the feature was broken.

Apply ADR-008's question — _what would this test do if named-selection reuse were completely broken?_ — and the answer is: pass, with a comment explaining what it believes it is checking.

## Fix

Copy-on-write. `TerminalBuilder.copy()` is the base; six classes override it to replace their mutable containers (`RuleBuilder`, `SliceRuleBuilder`, `SmellBuilder`, `CorrespondenceBuilder`, `SchemaRuleBuilder`, `ResolverRuleBuilder`), `CrossLayerBuilder` has its own because it extends nothing, and all 40 chain methods do `const next = this.copy()` … `return next`. `shallowClone` (`src/core/shallow-clone.ts`) holds the one `Object.create` / `getPrototypeOf` pair, so ADR-005's interop carve-out is written once and reviewed once.

A shallow copy gives the clone its own _slots_, which is what makes `next._field = …` safe. A field holding a mutable container still needs its owning class to replace it — that is what the `copy()` overrides are for, and what the second structural guard enforces.

Cost is one object per chain link against a ts-morph walk.

One production site relied on the mutation — `src/presets/layered.ts:93-96` built up predicates in a loop and discarded the return value. It now reassigns.

## Guards

`tests/core/held-builder-is-immutable.test.ts`, ten behavioural plus two structural. The GraphQL pair additionally has five guards in their own suites, where the docs' held-selection shape had no coverage at all.

Every behavioural guard asserts a rule that **must fail** or **must report an exact non-zero count**; a guard whose rules pass is satisfied by the bug. Verified by reverting `src/` and re-running: **12 of 12 fail.**

Three did not, on the first attempt, and each failure was its own lesson:

- The slice re-discovery guard compared counts, and the fixture reports exactly one layer-order violation while an empty slice set reports exactly one config finding — `1 === 1`. Now compares violation _elements_.
- The tsconfig guard used `strict: false` then `strict: true`. `requires()` merges with later keys winning, so the leak was overwritten and invisible either way. Now uses two different keys.
- A structural guard asserted that no `copy()` override returns `this` — and with the fix reverted there are no overrides to be wrong. A guard satisfied by the absence of the thing it guards. Replaced with one that requires every in-place-mutated container field to be re-created for the clone. Reverted, it names 12 fields; the `return this` sweep names all 40 methods.

The two structural guards read `src/` rather than running a rule, so they hold for a builder this file has never heard of. The first is what found the five classes beyond the bug report.

## Relationship to plan 0069

Not a glob fault — the selection is narrowed by a _name_ predicate — so `doctor` cannot see it and R3b's guard would not fire on the shape either. What R3b's empty-selector flip WOULD have caught is the symptom: `rule2` selecting nothing. That is the argument for the flip covering more than globs.

It also invalidates part of the vacuous-test appendix: R3b's migration note says "these findings are true", and any appendix entry whose emptiness came from a leaked narrowing rather than from the rule's own predicates was true only because of this bug.
