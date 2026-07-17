# ADR-008: Agent-First Failure Surfaces

## Status

**Proposed** (July 2026)

Extracted from plan 0063's review, where the same class of defect recurred across three drafts and two review rounds — each fix reintroducing it one layer down. The rules below are the generalisation. They govern **every check this project ships**: rules, presets, the `explain` surface, and our own internal guards.

## Context

ts-archunit's stated purpose is to catch architectural drift on the PR that introduces it. Its **primary consumer is an AI coding agent** — the `agentGuardrails` preset, `explain --format agent`, and `.rule({ imperative })` all exist for that reader. That consumer behaves differently from a human in two ways that dictate how a check must be built:

1. **An agent does not read warnings. It reacts to failures.** A warning in a CI log is invisible: the build is green, the task is done, the agent moves on. A human might skim the log; an agent has no reason to.
2. **An agent hitting a red build with no stated remedy invents one.** It is optimising for green, not for correctness. The invented remedy is reliably the cheapest path: delete the test, add a suppression, regenerate the snapshot, or edit the expectation. All are worse than the original defect, because they are silent.

Both properties have the same consequence: **a check that cannot fail is worth less than no check**, because it is mistaken for coverage. That is the "false green" this project sells against — and plan 0063's review found the project committing it repeatedly, in the guard designed to prevent it.

The empirical basis (plan 0063, 2026-07-17). A hand-maintained artifact failed at one narrow job — knowing which API is deprecated — **eight times**, most of them inside the fixes for the previous one:

| Layer                                              | Outcome                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| A hand-written list of names                       | Missed 9 of 27; reported "clean"                 |
| A hand-coded matching rule                         | Found 22 of 27; zero on the page it called worst |
| A hand-coded search scope                          | Correct today; silent the moment API moves       |
| A hand-typed count in a roadmap                    | Already wrong                                    |
| A hand-typed measurement in a plan                 | Already wrong                                    |
| A summary table describing the code beside it      | Prescribed the thing the code had just banned    |
| A derived value returned as data, asserted nowhere | Silent by construction                           |
| A snapshot pin                                     | `vitest -u` erases it                            |

The last three are the interesting ones: they were introduced **while fixing** the earlier ones. That is the signature of a missing principle, not carelessness.

## Decision

**Every check we ship — and every check that guards a check — must be reactable by an agent, and must be guarded by a derivation independent of the one it protects.**

Five rules, all binding.

### Rule 1 — Actionable findings fail; they never warn

**A finding whose remedy is not optional must fail the build.** No `console.warn` as the primary signal for such a finding.

The discriminator is **whether the remedy is optional**, not whose check it is. This is what keeps the rule consistent with [ADR-003](./003-fluent-builder-dsl.md), which makes `.warn()` a first-class terminal, and with our own `recommended` preset, which ships two warn-level rules **deliberately** — `no-silent-catch` and `no-empty-bodies` have known, suppressible false positives, so the user must judge each one. A finding the reader is expected to judge has an optional remedy and **should** warn; failing the build on it would train them to suppress the rule. A finding with one correct answer must fail.

Corollary — and note the distinction, because it is easy to overreach here: **an artifact that can ship while no check ever fails is a false green**, and that is what this rule forbids. It is _not_ the same as an artifact that ships before a check reports. If a later gate reliably reds, the exposure window is a **cost to weigh** (how long is the artifact wrong, how expensive is gating earlier), not a violation. Conflating the two produces gates that cost more than the exposure they close — see plan 0063 decision 2, where gating the publishing workflow would have cost 4.5x on every deploy to close a ~2-minute window that a sibling job already reds.

### Rule 2 — Every failure carries its own sanctioned remedy

The failure message states **what to do**, not only what is wrong. This is what `.rule({ suggestion })` and `imperative` already exist for; the rule makes it non-optional for our own guards.

The remedy must be **real**. A message whose stated fix is impossible on the path that produced it is worse than no message: the agent tries it, it fails, and the agent then does the forbidden thing. If a check can fire for several causes, the message must not name one cause's remedy as if it were universal.

Corollary: **a remedy read from a hand-written source is not derived.** A JSDoc `@deprecated` tag's text is a convention, not a guarantee — `/** @deprecated */` is legal and yields an empty remedy. If a message's content comes from prose, assert the prose.

### Rule 3 — Where there is deliberately no escape hatch, say so, and say what to do instead

Silence invites improvisation. A check with no exemption mechanism must state that in the message, plus the sanctioned alternative — including "stop and ask a human" when the check genuinely cannot decide.

Be honest about the strength of this: it is **advisory**. Nothing enforces a message. The enforcement is code review, and the message's real audience is often the reviewer reading the diff, not the agent. Do not describe an unenforced sentence as load-bearing.

Corollary: an escape hatch is not automatically safer than none. A marker an agent can stamp on any file to go green is **worse** than no marker, because it is a silent, one-line diff. Prefer exclusion **by construction** (structure the scope so the exception cannot arise) over any list, marker, or flag.

### Rule 4 — No snapshot assertions in agent-consumed tests

`toMatchSnapshot()` / `toMatchInlineSnapshot()` are banned as pins. `vitest -u` regenerates them, and **an agent reaches for `-u` before it reaches for thought**. A pin that a tool flag erases is not a pin.

This codifies existing practice — there are zero snapshot assertions in `tests/` today.

Narrow exception: where the artifact _is_ the output and the diff _is_ the review unit (rendered CLI output, `explain --format agent`), a snapshot is legitimate. Even then, prefer an explicit expectation. Note what a snapshot buys that a count does not — **identity**: `expect(hits.length).toBe(25)` and a 25-entry snapshot are not equivalent, and a change that loses one hit and gains another passes the first. Replace snapshots with explicit lists, not with counts.

### Rule 5 — A derivation is unguarded until a _differently_-derived value disagrees with it

This is the one the other four kept failing on, and the root of every row in the Context table.

> **The question is never "does it derive?" It is: _what second, independent derivation disagrees with it?_**

Deriving a value from source and then "protecting" it with a check drawn from the **same** source is not a guard. The error cancels on both sides. Concretely, from 0063:

- Counting `@deprecated` in raw text and comparing to `@deprecated` tags recovered by the walk: `recovered ≤ raw` **always**, so it detects under-collection only. A stray tag in prose raises both sides by exactly one and cancels. It certifies **cardinality**, never **identity**.
- A flag derived from `getExportedDeclarations()`, "pinned" by a test that restates the same derivation: passes with the flag fully broken.
- A value returned as data with nothing comparing it to anything: silent by construction.

What independence looks like: ts-morph **static analysis** vs the **runtime ES module namespace** (`expect(sym.collides).toBe(sym.name in publicApi)`). Two mechanisms that cannot fail the same way. That test catches the flag being wrong; the same-derivation version does not.

**Independence is not a licence to add an engine.** [ADR-002](./002-ts-morph-ast-engine.md) stands: ts-morph remains our sole AST and type-checking engine, and "cross-check it with a second parser" is **not** an available answer. Independence is cheap and comes from a _different kind_ of evidence, not a competing implementation of the same kind — the runtime namespace above is an import, not an AST engine. Reach for: runtime behaviour vs static analysis; the module system vs the compiler; a file's existence vs a file's contents; identity vs cardinality. If the only independence you can find is a second engine, you do not have a guard — you have a gap, and rule 5's honest answer is to **say so** (see Consequences).

Corollaries:

- **Counting is the shortcut.** Cardinality checks are the commonest false independence. Compare identities — sets of `file:line`, sets of names — not integers.
- **Every guard needs its own vacuity guard.** `expect(a).toBe(b)` passes trivially when both are empty or zero. `0 === 0` is green. If the inputs can be empty, assert they are not.
- **A test that restates the implementation is not a test of the implementation.** It catches typos and inverted conditions. It cannot catch the rule being wrong.

### Enforcement

Rules 1–4 are **review-enforced**. They are properties of prose and structure that no static rule can check honestly, and a rule that could would itself need a rule 5 guard.

Rule 5 is enforced by the reviewer question, which is cheap and mechanical: **"what would this test do if the thing it guards were completely broken?"** If the answer is "pass," the derivations are not independent. That single question found three defects in 0063 that three prior review rounds missed.

We deliberately do **not** dogfood these as ts-archunit rules. ADR-007's own dogfooding example is instructive: as written it references a non-existent export and is unscoped, so it would false-red against 107 test files. An unenforceable rule stated honestly beats an enforced rule that is wrong.

## Consequences

### Positive

- The failure surface becomes a contract rather than an accident, for the consumer we actually ship to.
- Rule 5 gives review a single mechanical question that catches a defect class three rounds of expert review missed by inspection alone.
- Exclusion-by-construction (rule 3's corollary) removes maintained artifacts entirely rather than making them safer. In 0063 it paid off three times for free.

### Negative

- Rule 5 makes some guards genuinely harder to write; a second independent derivation is not always available. Where it is not, the honest move is to **state the gap**, not to ship a same-derivation check that looks like a guard.
- Rule 2 lengthens messages. Put per-hit facts on the hit and the imperative on the assertion, or the remedy drowns in repetition.
- These are review-enforced, so they rot exactly like anything else review-enforced. Rule 5 applies to this ADR too: nothing here is derived.

## Alternatives Considered

### Leave it in plan 0063

Rejected. Completed plans move to `plans/completed/`, so a binding repo-wide rule would be buried where nobody greps — a hand-maintained rule in an unread directory, which is the exact failure this ADR describes. The rules already have three instances (`imperative`, `explain --format agent`, the docs guard); that is ADR material.

### Make them ts-archunit rules and dogfood them

Rejected for now — see Enforcement. Worth revisiting if a mechanical subset emerges (rule 4 is plausibly checkable: ban `toMatchSnapshot` in `tests/`).

### Do nothing; treat 0063's defects as one-off mistakes

Rejected on the evidence. Eight recurrences across three drafts, five of them introduced _by the fix for the previous one_, by different authors and reviewers, is a missing principle.

## Notes

Rule 5's phrasing came from the plan-0063 testing review: _"a derived value returned as data is not asserted until something compares it to a differently-derived value."_

Rule 4's rationale — _"an agent reaches for `-u` before it reaches for thought"_ — generalises past testing to any tool flag that resolves a failure by rewriting the expectation.

The Context table is evidence, not self-flagellation. It is kept because rule 5 was invisible for three rounds precisely because each individual instance looked like a local mistake.
