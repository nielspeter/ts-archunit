# Bug 0049: four `as` casts in shipped source, and `isRecord` written twice

**Reported:** 2026-08-03 · **Fixed:** not yet
**Found in:** v0.45.3, while verifying an architecture-review finding about a _different_ cast
**Severity:** Low as a defect, Medium as a signal. Nothing is wrong at runtime — every cast here is
currently true. [ADR-005](../adr/005-no-any-no-type-assertions.md) is binding for a reason though:
this project's own preset asserts that consumers write no type assertions, and it ships four.

## What

[ADR-005](../adr/005-no-any-no-type-assertions.md): _no `as` type assertions. Use type guards. Only
`eslint-disable` at unavoidable JS interop boundaries (with explanation)._ Four remain in `src/`,
none with an `eslint-disable` and none with a stated justification:

| Site                           | Cast                                          | Avoidable?                                                                                                                                                               |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cli/resolve-config.ts:45` | `(mod as Record<string, unknown>)['default']` | **Yes.** The line above narrows `mod` to `object` and the comment says _"'in' narrows safely"_ — then it casts anyway. After `'default' in mod`, `mod.default` compiles. |
| `src/cli/resolve-config.ts:50` | `defaultExport as Record<string, unknown>`    | **Yes**, via the `isRecord` guard that already exists twice in this repo.                                                                                                |
| `src/predicates/module.ts:75`  | `args[1] as ImportOptions`                    | Needs looking at — overload dispatch, where a guard on the options shape is the ADR's prescribed route.                                                                  |
| `src/predicates/module.ts:100` | `args[1] as ImportOptions`                    | Same, and the second copy of the same dispatch.                                                                                                                          |

And the guard that would remove two of them is itself duplicated, verbatim:

- `src/tsconfig/tsconfig-builder.ts:184`
- `src/cli/commands/init.ts:487`

Same signature, same body, no shared owner — while a third site casts instead of calling either.

## Why it matters more than four lines

**We sell this rule.** `agentGuardrails` and the `recommended` preset ship `noTypeAssertions()`, and
`docs/` presents it as a guardrail an adopter should turn on. A library that enforces a rule it
breaks in its own source is the credibility version of a false green.

**A duplicated predicate is not a style problem in this repo.**
[Bug 0044](./fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md) was a **measurement
error** caused by exactly this shape: two copies of one predicate, a patch applied to the wrong
copy, and a 3.0× cost regression measured as ~1.0×. The fix there was to delete the duplicate, not
to test both.

**It was invisible to our own tooling twice over.** `npm run lint` passes — `as` is not lint-enforced,
so ADR-005 is convention-only in CI. And this repo runs its own rules against itself, so the natural
question is why `noTypeAssertions()` does not fire here. That question is the real deliverable of
this bug, and it should be answered before the casts are edited: if the answer is "the self-check
does not cover `src/cli/` or `src/predicates/`", then the scope of the self-check is the defect and
four casts are the symptom.

## How it was found

An architecture review of the v0.45.4 branch flagged a **fifth** cast —
`(value as Record<string, unknown>)['describeRule']` in `src/cli/commands/explain.ts:21` — as part
of a finding about a duplicated `Describable` guard. That one is fixed in v0.45.4: the guard now has
one owner in `src/core/rule-description.ts` and is cast-free, because narrowing to `object` plus
`'describeRule' in value` is sufficient. Grepping for siblings of the pattern found these four.

Worth noting the review found it by asking a question about **duplication**, not about casts.

## Fix

1. **First, answer why the self-check missed them.** Find which rule should have fired, and on what
   glob. If the scope is wrong, fix the scope — that is the finding, and it is the half that
   prevents the fifth cast.
2. `resolve-config.ts:45` — delete the cast; the narrowing is already there and the comment already
   claims it.
3. One owner for `isRecord`, then `resolve-config.ts:50` calls it and both copies are deleted.
4. `predicates/module.ts` — a guard on the options shape, in one place rather than two.

Each with the ADR-008 rule 5 question asked against the diff: what would the suite do if the guard
returned the wrong answer?

## Out of scope

- **Making `as` a lint error.** Tempting, and it needs its own decision: the `Node as NodeClass`
  import aliases in `arch-function.ts`, `arch-call.ts` and `smells/fingerprint.ts` are not casts,
  and a naive rule reds them. That is a separate change with its own false-positive question.
