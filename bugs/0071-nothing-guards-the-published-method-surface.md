# Bug 0071: nothing guards the published method surface — a public method can be removed with every gate green

**Reported:** 2026-08-07 · **Fixed:** not yet
**Found in:** the five-persona review of [plan 0097](../plans/completed/0097-the-declared-empty-grammar.md),
which removed the public method `CorrespondenceBuilder.allowEmpty()`. A reviewer asked what would have
caught that if the repo's own tests had not happened to call it, and measured the answer.
**Severity:** **Medium as a defect, and the reason it is filed is what it means for
[plan 0098](../plans/0098-the-evidence-seam-and-the-floor.md).** Nothing is broken today. But 0098 leans
on the vacuity matrix as its independent behavioural derivation, and the matrix cannot see the surface
0098 changes. A guard's blind spot should be a known number before the plan that depends on it ships,
not a discovery during.

## What happens

**A public method can be added to or removed from any published builder class, and every gate stays
green.** Measured, on the 0097 branch: the reviewer restored `allowEmpty(sideName)` to
`CorrespondenceBuilder` as a live public method delegating to `expectEmpty`, and ran the full set —

| gate                                              | exit |
| ------------------------------------------------- | ---- |
| `npm run typecheck`                               | 0    |
| `npm run test` (3198 passed)                      | 0    |
| `node scripts/verify-package.mjs`                 | 0    |
| `npx vitest run --config vitest.matrix.config.ts` | 0    |

The only reason removing `allowEmpty` produced any red at all was that three of this repo's **own test
files happened to call it**. That is incidental usage coverage, not a guard. A public method with no
internal call site — which is the normal state for a method that exists for adopters — would appear or
vanish silently.

## Why each existing instrument misses it

Four things look like they might cover this. None does, and the reasons differ:

| instrument                              | what it actually checks                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scripts/verify-package.mjs`            | every `exports` subpath resolves by package name and ships; asserts only `Object.keys(mod).length > 0` |
| `tests/matrix/enumerate.ts`             | recurses into an export only `if (isRecord(value))`, and **a class constructor is `'function'`**       |
| `tests/core/assertion-gate.test.ts`     | censuses exported builder **classes** and one hook (`assertsSomething`) — a single-method walk         |
| `tests/docs/deprecated-symbols.test.ts` | tracks symbols carrying a `@deprecated` tag; `allowEmpty` was deleted outright, never deprecated       |

The matrix's miss is the one worth stating precisely, because its stated strength invites the opposite
conclusion — _"the one list a published entry point cannot avoid joining"_
([plan 0095](../plans/completed/0095-the-vacuity-matrix-and-the-conformance-audit.md)). That is true of
**entry points**, and the matrix is a behavioural truth table over constructors. It is not an API-surface
census, and it never opens a `.d.ts`. Measured on the 0097 branch: `tests/matrix/` is byte-identical to
`main`, both runs record 42 tests, and every recorded verdict is unchanged — while `TerminalBuilder`
gained two public methods and `CorrespondenceBuilder` lost one.

## Why this matters for 0098 specifically

Plan 0098 retypes `collectViolations()` — the one abstract member
[ADR-010](../adr/010-the-extension-surface-is-a-contract.md) rule 1 names — and adds `declaresEmpty()`
to the same root. Both are **method-level** changes to the contract ADR-010 declares versioned, and
0098's inventory names the matrix as its independent check. It is not one for this class of change.

ADR-010 rule 4 already prescribes the right instrument for a different reason: a **foreign-dialect
contract fixture built from the published `.d.ts`**, which fails to compile when a named member changes
shape. That fixture does not exist yet. This bug and that rule 4 obligation are plausibly one piece of
work, and should be decided together rather than solved twice.

## What a fix has to decide

- **Whether the census is over the `.d.ts` or over runtime prototypes.** The `.d.ts` is what an external
  consumer compiles against and is where ADR-010's contract actually lives; runtime prototype walking is
  cheaper and already has a precedent in `assertion-gate.test.ts`, but cannot see types, optionality or
  visibility — and this bug's motivating case (`expectEmpty(side?: string)` overriding a zero-arg base)
  is exactly a shape a prototype walk would call identical.
- **What the recorded surface is keyed by.** Bug 0064/0065/0067's lesson applies: a census keyed by
  method name alone collides on overloads and overrides.
- **Whether protected members are in it.** ADR-010 rule 1's table names four protected members as
  contract; a census over public members only would not have seen 0098's `collectViolations()` retype,
  which is the change that motivated filing this.

## Not measured

- **Whether any adopter-visible method has already been removed or changed shape silently.** This report
  establishes that nothing would have caught it, not that nothing happened. A `.d.ts` diff across the
  released tags would answer it, and should probably run before the census is designed — if the answer
  is "several times", that changes how strict the census wants to be.
- Whether the `exports` subpath surface has the same hole at the **function** level: a published helper
  changing arity is the same class of silent break, and `verify-package.mjs`'s `Object.keys(mod).length > 0`
  would not see it either.
