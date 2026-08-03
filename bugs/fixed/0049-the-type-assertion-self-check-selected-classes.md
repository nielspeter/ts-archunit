# Bug 0049: the type-assertion self-check selected classes, in a codebase of functions

**Reported:** 2026-08-03 · **Fixed:** 2026-08-03 (v0.45.6)
**Found in:** v0.45.3, while verifying an architecture-review finding about a _different_ cast
**Severity:** Low as a defect — every cast was true at runtime. Medium as a signal, and the title
was wrong: it said "four `as` casts", filed from a hand-written grep. The rule found **22**.

## What it turned out to be

The bug asked one question first — _why does our own `noTypeAssertions()` not fire on our own
source?_ — and the answer was the whole finding. `tests/archunit/arch-rules.test.ts`:

```ts
classes(p).that().satisfy(inProjectSrc()).should().satisfy(noTypeAssertions())
```

**It selects classes.** This codebase has **19 files containing a class and 128 containing a
function**, and every cast we shipped was in a function. The guard covered the shape we barely use.
Not a directory-scope problem as the bug guessed — an element-kind problem, which is worse, because
no amount of widening the glob would have found it.

The filed count came from `grep -rE " as [A-Z]..."`. `moduleNoTypeAssertions()`, which traverses the
whole file, reports **22 in 8 files**. That gap between a hand-written list and a derivation is the
thing this project keeps paying for, this time in the bug report about it.

## Fix as shipped

**The scope, which is the half that prevents the next one.** A module-scoped rule now sits beside the
class-scoped one; being full-file, it subsumes it. The class rule is kept because its message names
the class, which is a better failure for the commonest case.

**18 of 22 casts removed, 4 waived.**

| Group                       | Count  | What it was                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variadic overload dispatch  | **10** | `(args as string[])` / `(args[1] as ImportOptions)` in five entry points. The stated reason — "TS cannot narrow tuple-union rest params after `Array.isArray`" — is true, and the casts were still avoidable: `.filter((a): a is string => …)` narrows without one. Now a single `splitGlobArgs`, which also retires a dispatch written **five times**. |
| Redundant after a narrowing | **5**  | Each sat directly after the `in`/`typeof` check that made it unnecessary. All five removed with `tsc` clean — two of them then tripped `no-unsafe-call`, because removing a cast is not automatically an improvement: it traded an ADR-005 breach for the same unchecked call, differently spelled. A `isNullaryCallable` predicate satisfies both.     |
| CLI value validation        | **3**  | `JSON.parse(...) as {version}`, a config `format` cast onto a union, and `defaultExport as Record`. Replaced with guards — the `--version` path now survives a malformed `package.json` instead of throwing about a property of a string.                                                                                                               |
| **Waived, in place**        | **4**  | `conditions/members.ts` reads ts-morph's private `compilerSymbol.links.checkFlags`; `graphql/schema-loader.ts` loads an optional peer dependency through `createRequire`. Genuine JS-interop boundaries with no typed path — the case ADR-005 allows.                                                                                                   |

**The waivers use this project's own `// ts-archunit-exclude` directive**, not a narrower rule scope.
That matters: a scope exemption is invisible, while a directive names the boundary, carries the
reason, and is reported by `doctor` if the rule id ever stops existing.

**And `isRecord` now has one owner.** It was written twice, verbatim, while a third site cast instead
of calling either. Consolidating caught a live drift: both copies excluded arrays and the first draft
of the shared version did not, which would have widened `tsconfig-builder`'s deep-compare and
`init`'s tsconfig reader to accept an array as a record. Picking the weaker of two copies is how a
refactor becomes a defect.

## Sabotage

| Revert                                                                                     | Result |
| ------------------------------------------------------------------------------------------ | ------ |
| A cast inside a **function** — the shape the class-scoped rule could never see             | CAUGHT |
| The `members.ts` waiver removed — proving it is load-bearing, not decorative               | CAUGHT |
| `splitGlobArgs`' tuple branch drops `options` (would silently disable `ignoreTypeImports`) | CAUGHT |
| `splitGlobArgs`' variadic branch returns `[]`                                              | CAUGHT |
| Baseline asserted green before each, and restored green after                              | 0      |

The two `splitGlobArgs` rows matter because one shared helper replaced ten casts in five call sites:
without them, "2955 tests still pass" is evidence the tests run, not that both branches are covered.
The first attempt at the tuple row **failed to apply** — prettier had reflowed the anchor — and
reported a green that meant nothing until it was re-run against the real text.

## What is left, deliberately

- **`as` is still not lint-enforced.** It is now _rule_-enforced, by this project's own rule against
  its own source, which is the better answer for a library that sells that rule. Making it an ESLint
  error additionally would red the `Node as NodeClass` import aliases and needs its own decision.
- **The class-scoped rule stays** even though the module rule subsumes it. Two rules over one
  property is usually a smell; here the narrower one produces the better message, and both are
  derived from the same condition rather than from two hand-maintained lists.

## Out of scope

- **Making `as` a lint error.** Tempting, and it needs its own decision: the `Node as NodeClass`
  import aliases in `arch-function.ts`, `arch-call.ts` and `smells/fingerprint.ts` are not casts,
  and a naive rule reds them. That is a separate change with its own false-positive question.
