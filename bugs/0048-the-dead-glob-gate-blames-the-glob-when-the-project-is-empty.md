# Bug 0048: the dead-glob gate blames the glob when the project loaded nothing

**Reported:** 2026-08-03 · **Found in:** v0.41.0, by the design review of bug 0040's fix approach
**Re-measured firsthand 2026-08-03**, which changed the explanation — see "Why the parity test does not catch it"
**Severity:** High. A **confidently wrong remedy** on a shipped path: the reader is told to correct
a glob that is correct. It also breaks a parity the suite believes it pins, so the suite reports
coverage it does not have.

## Description

`diagnose()` short-circuits when the project loaded no source files — that is
[bug 0031](./fixed/0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md)'s fix, at
`src/core/diagnose.ts:189`. `deadSelectorFindings` in `src/core/terminal-builder.ts` has **no such
short-circuit**, so the assertion gate blames the glob instead.

Measured on `tests/fixtures/does-not-load`:

| Surface      | What it says                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gate**     | _"This rule's selector `matching("src/")` can never match anything … this path exists and contains TypeScript, but your tsconfig include/exclude keeps it out of the project. Correct the glob, or remove the rule."_ |
| **`doctor`** | `kind: 'project-empty'`, _"the project loaded 0 source files."_                                                                                                                                                       |

The glob is fine. The tsconfig loaded nothing. Following the gate's remedy means editing a correct
glob, finding it changes nothing, and improvising — which is exactly what
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2 exists to prevent, and precisely the
fault bug 0031 fixed on the other surface.

## Why the parity test does not catch it

`tests/core/assertion-gate.test.ts:598` is named _"the doctor's empty-project advice IS the
builder's, character for character"_, and it passes. That looks like the case is covered. It is
not, and the reason is the interesting part.

That test drives the builder with **`slices(target).matching('src/')`** — a glob at
**`discovery`** position. `deadSelectorFindings` skips non-selector positions
(`terminal-builder.ts:433`), so the gate never runs for it, and the message the test inspects
comes from slice's **own** empty-project branch at `slice-rule-builder.ts:372`.

So there are three implementations of "the project loaded nothing" — `diagnose.ts:190`,
`slice-rule-builder.ts:372`, and none in the gate — and the test that exists to pin them together
happens to compare the two that have one.

Measured on `tests/fixtures/does-not-load`, 0 files loaded:

| Path                       | Message                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **selector** (`modules()`) | _"This rule's selector … can never match anything … Correct the glob, or remove the rule."_ |
| **discovery** (`slices()`) | _"The project loaded 0 source files (…tsconfig.json), so no glob can match."_               |
| **`doctor`**               | identical to discovery                                                                      |

The selector path is the common one — every `modules()`, `classes()`, `functions()` and `types()`
rule — so the wrong remedy is on the path most rules take, and `terminal-builder.ts:396-399`'s
claim that the gate and `doctor` cannot disagree is false there.

## Why it was not caught by bug 0031

0031 was scoped to `diagnose()`. The gate grew the same reasoning later and independently, and
nothing compares the two on this input. Two derivations of "why can this glob not match", one
short-circuit between them.

## Fix

Give `deadSelectorFindings` the same short-circuit — and take the count of implementations from
three **down**, not up to four. `emptyProjectAdvice` (`src/core/empty-project-advice.ts`) is
already the shared string; what is duplicated is the **decision to use it**, at `diagnose.ts:190`
and `slice-rule-builder.ts:372`. Extract that guard once and have all three call it.

Take the empty-project message with it: the reader needs the tsconfig named, which is what 0031's
fix established.

## Guard

The independent derivation is the one the suite already reaches for and then misses: **assert the
gate's text and `doctor`'s text are equal on an empty project**, extending the pin at
`assertion-gate.test.ts:598-628` to that input rather than adding a separate assertion beside it.

- empty project, **`selector`** position → gate text == `doctor` text. **This is the row that was
  missing**: the existing test asserts the discovery path, which has its own branch and always
  passed;
- empty project, `discovery` position → unchanged (see [plan 0080](../plans/0080-admit-discovery-globs-to-the-dead-glob-gate.md));
- **control:** a genuinely dead glob in a project that loaded files → both still blame the glob, and
  the texts still agree. Without this, "always say project-empty" passes.
- vacuity: assert the fixture really loads 0 files, and that the non-empty control loads more than 0.

## Related

- [Bug 0031](./fixed/0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md) — the same
  fault, fixed on `diagnose()` only.
- [Plan 0080](../plans/0080-admit-discovery-globs-to-the-dead-glob-gate.md) — widens this gate's
  audience to three more builders, so this should be fixed **first**. Its Critical 2.
