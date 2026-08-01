# ADR-008: Agent-First Failure Surfaces

## Status

**Accepted** (2026-07-29). Proposed July 2026; accepted after a second, larger body of evidence — plans 0069 and 0070 and bugs 0011–0024 — reproduced every failure mode in the Context table on different code, and after the rules had been cited as binding in every plan and bug write-up since. Leaving it Proposed while treating it as binding was itself a hand-maintained claim nobody derived.

Extracted from plan 0063's review, where the same class of defect recurred across three drafts and two review rounds — each fix reintroducing it one layer down. The rules below are the generalisation. They govern **every check this project ships**: rules, presets, the `explain` surface, and our own internal guards.

## Context

ts-archunit's stated purpose is to catch architectural drift on the PR that introduces it. Its **primary consumer is an AI coding agent** — the `agentGuardrails` preset, `explain --format agent`, and `.rule({ imperative })` all exist for that reader. That consumer behaves differently from a human in two ways that dictate how a check must be built:

1. **An agent does not read warnings. It reacts to failures.** A warning in a CI log is invisible: the build is green, the task is done, the agent moves on. A human might skim the log; an agent has no reason to.
2. **An agent hitting a red build with no stated remedy invents one.** It is optimising for green, not for correctness. The invented remedy is reliably the cheapest path: delete the test, add a suppression, regenerate the snapshot, or edit the expectation. All are worse than the original defect, because they are silent.

Both properties have the same consequence, and it is the reason this ADR exists:

> **A check that cannot fail is worth less than no check, because it is counted as coverage.**

A rule whose glob matches no files passes. A selector that narrows to nothing passes — every condition is ∀ over an empty set, and ∀ over ∅ is true. A test asserting `.not.toThrow()` on such a rule is green permanently, and green for a reason that has nothing to do with the architecture it claims to protect. The suite reports a number, CI reports success, and the number is a lie: the coverage is not thin, it is **absent**, and nothing in the system says so.

That is the defect this project sells against, which makes committing it ourselves disqualifying — and plan 0063's review found us committing it repeatedly, inside the guard designed to prevent it. Every rule below is downstream of that one sentence. Rule 5 is how you find out whether a green is real.

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

**It then happened three more times inside this ADR's own first application**, each found by mutation _after_ inspection had signed off, and each introduced by the fix for the row above it:

| Layer                                                       | Outcome                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| The failure **message**, rendered only on the red path      | Never executed by a green suite; 6 mutations of it left 13/13 passing     |
| Four detectors asserting an empty list against clean `src/` | Vacuous by construction; green with the detection deleted                 |
| A flag exempting items the oracle could not see             | Forced true, **every** item skipped the oracle and the suite stayed green |

Twelve rows, eight of them introduced by a fix. That regress — check → message → detectors → oracle — is what rule 6 exists to bound.

**The second body of evidence (plans 0069–0070, bugs 0011–0024, 2026-07-25 → 07-29).** Different code, different reviewers, same shapes — and this time the false greens were measured rather than argued:

| Instance                                                           | Outcome                                                                                                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17 of this project's own dogfood rules (bug 0011)                  | Selected nothing. Our ADR enforcement was green and vacuous                                                                                                             |
| `notImportFrom('picomatch')` (bug 0014)                            | Reported **0** while 15 files imported it. The documented way to ban a dependency worked only on dependencies you had not installed                                     |
| `dataLayerIsolation({ repositories: '…/bad-repo.ts' })` (bug 0018) | Generated its rules and checked nothing — a file glob against a parent-directory matcher. **0** violations on a file that breaks both rules                             |
| A test named `named selection reuse works` (bug 0016)              | Demonstrated that it did not. Green because the second rule's selection was empty                                                                                       |
| `onlyImportFrom` (bug 0022)                                        | Blind to `export … from` and `import()`: **0** violations on edges that do cross the boundary. Five preset rules affected                                               |
| The guard for "this rule asserts nothing" (bug 0019)               | Present in source, correctly written, and gated out of firing by a phase test added for something else                                                                  |
| A configuration finding's remedy (bug 0021)                        | Printed the author's unrelated `Fix:`. The one producer that deliberately omitted it was overridden a layer up, so the omission never shipped in any version            |
| `.warn()` inside a test (bug 0024)                                 | Reaches nobody — the reporter discards it on a passing test. Every test of it asserted the **call**; a spy cannot prove **delivery**                                    |
| Bug 0016's own guards, first attempt                               | 3 of 12 passed under the bug they guarded: a `1 === 1` count coincidence, a merge that overwrote its own leak, and one satisfied by the absence of the thing it guarded |
| Three sabotage matrices over one surface                           | Reported 0 of 8 caught-by-nothing, then measured **11**, then 0 of 11, then **9 of 65**. The rigour was constant; the enumeration was not                               |

The last row is the one that changed this document — see rule 5's first corollary.

## Decision

**Every check we ship — and every check that guards a check — must be reactable by an agent, and must be guarded by a derivation independent of the one it protects.**

Six rules, all binding. Rules 1–5 say what a check must do; rule 6 says how far to chase them.

### Rule 1 — Actionable findings fail; they never warn

**A finding whose remedy is not optional must fail the build.** No `console.warn` as the primary signal for such a finding.

The discriminator is **whether the remedy is optional**, not whose check it is. This is what keeps the rule consistent with [ADR-003](./003-fluent-builder-dsl.md), which makes `.warn()` a first-class terminal, and with our own `recommended` preset, which ships two warn-level rules **deliberately** — `no-silent-catch` and `no-empty-bodies` have known, suppressible false positives, so the user must judge each one. A finding the reader is expected to judge has an optional remedy and **should** warn; failing the build on it would train them to suppress the rule. A finding with one correct answer must fail.

Corollary — **a migration's measuring instrument cannot be a warning either.** The obvious way to ship a gate that will fail existing code is "warn in release N, fail in release N+1", and it does not work for the same reason rule 1 exists: the release that only warns is the release nobody reads. Plan 0070 built exactly that, and measured it — `console.warn` from a passing test is discarded by vitest's default reporter in every CI-relevant configuration (0 of 19 real firings visible in our own suite), and moving to a direct `process.stderr` write bought visibility at the cost of five new defects at the four seams a bespoke output path bypasses: the formatter, the JSON payload, the annotation surface, and the exit code. What worked was categorically different: **an explicitly-invoked diagnostic** (`doctor`, `diagnose()`) that the consumer runs on the release before the flip. A warning is something you hope is read; a command is something someone ran. If you find yourself designing a warn-first migration, the honest version is a diagnostic-first one — and if the diagnostic cannot reach some authoring shape (ours cannot load a file that imports a test runner), say so rather than reaching for the warning to cover the gap.

Corollary — and note the distinction, because it is easy to overreach here: **an artifact that can ship while no check ever fails is a false green**, and that is what this rule forbids. It is _not_ the same as an artifact that ships before a check reports. If a later gate reliably reds, the exposure window is a **cost to weigh** (how long is the artifact wrong, how expensive is gating earlier), not a violation. Conflating the two produces gates that cost more than the exposure they close — see plan 0063 decision 2, where gating the publishing workflow would have cost 4.5x on every deploy to close a ~2-minute window that a sibling job already reds.

### Rule 2 — Every failure carries its own sanctioned remedy

The failure message states **what to do**, not only what is wrong. This is what `.rule({ suggestion })` and `imperative` already exist for; the rule makes it non-optional for our own guards.

The remedy must be **real**. A message whose stated fix is impossible on the path that produced it is worse than no message: the agent tries it, it fails, and the agent then does the forbidden thing. If a check can fire for several causes, the message must not name one cause's remedy as if it were universal.

Corollary: **a remedy read from a hand-written source is not derived.** A JSDoc `@deprecated` tag's text is a convention, not a guarantee — `/** @deprecated */` is legal and yields an empty remedy. If a message's content comes from prose, assert the prose.

Corollary — **a remedy is a claim, so rule 5 applies to it.** This is the connection the first version of this ADR left implicit, and both of its expensive instances were found the hard way. Asserting that a message _contains_ the right words is a same-derivation check: the test and the message are written from the same understanding, and they agree even when the understanding is wrong. The independent derivation is **behavioural — apply the stated fix and assert the finding clears.** `strictBoundaries`' `no-cross-boundary` told the reader to "import from the other boundary's entry point instead"; doing exactly that reproduces the identical violation, because the rule enforces folder isolation and no import of another boundary is permitted (bug 0017). A remedy-contains test passes on that message forever; a remedy-remediates test fails on it immediately. Every message whose fix is mechanical should have one, and where the fix is not mechanical, rule 5's honest answer applies: say so.

Note the asymmetry this rule creates, and budget for it. Rule 2 moves a large share of the defect surface into message text — the part of a codebase with no type system, no default test, and no compiler. Two of the highest-severity bugs in this project's history (0017, 0021) are "the remedy is wrong", and in a human-first tool both would be minor, because a human discounts a bad suggestion. Here they are not minor: the agent obeys the remedy, it fails, and then it does the forbidden thing.

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

- **Enumerate the surface from the diff, not from memory.** This is the corollary the second body of evidence added, and it is about the question itself rather than about any guard. "What would this test do if the thing it guards were completely broken?" presupposes that you have correctly identified _the thing_ — and that step is a hand-maintained list, so rule 5 applies to it. Measured, over one release's surface: a sabotage matrix enumerated from memory reported **0 of 8** caught-by-nothing, honestly; a matrix enumerated from `git diff` over the same code found **11**; those eleven were pinned and re-measured at 0; a third enumeration, 65 reverts derived from the diff, found **9** still uncaught, six of them behavioural. The rigour never changed. The list did. So: derive the revert list mechanically from the change, assert that each patch applies non-trivially before trusting its verdict, and report **caught-by-nothing as a number** — a matrix without that number is a claim, not a measurement.
- **The verdict mechanism is part of the derivation.** Same evidence, one layer down: a reviewer's first pass over that 65-revert matrix decided each verdict by grepping the test reporter's output, ANSI escape codes defeated the pattern, and it reported _every_ revert as caught-by-nothing. A sabotage run that reads its own result through a fragile channel has the same defect as the guards it is auditing. Read the exit code.
- **Counting is the shortcut.** Cardinality checks are the commonest false independence. Compare identities — sets of `file:line`, sets of names — not integers.
- **Every guard needs its own vacuity guard.** `expect(a).toBe(b)` passes trivially when both are empty or zero. `0 === 0` is green. If the inputs can be empty, assert they are not.
- **A test that restates the implementation is not a test of the implementation.** It catches typos and inverted conditions. It cannot catch the rule being wrong.

### Rule 6 — Recursion depth is proportional to blast radius

Rule 5 **has no fixed point.** Every guard is itself a derivation, so every guard needs a guard, and 0063 proved the regress is real rather than theoretical: the check → the check's message → the message's detectors → the detectors' oracle. Each layer was a genuine defect, each was found only by mutation, and each was introduced by the fix for the one above it. Nothing in rules 1–5 says when to stop, and that omission is what let a `tests/`-only guard over a clean corpus consume three adversarial review rounds and roughly ten times its own budget.

So: **the depth you chase rule 5 to is a function of what breaks if you are wrong.**

| Blast radius                                                          | Depth                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Published API — strangers depend on it, and we cannot fix it for them | Guard the guard. Adversarial review. Mutate.                                                   |
| A gate on an irreversible effect (publish, deploy, delete)            | Guard the guard. The remedy path matters as much as the check.                                 |
| An internal check over a corpus we control                            | Guard the check. Prove each detector fires **once**. Then stop.                                |
| A check with a scheduled expiry                                       | Discount everything by the time remaining. A guard that dies at 1.0 does not earn round three. |

This is not licence to ship the shapes rules 1–5 forbid — a vacuous guard is worthless at every depth, and "prove each detector fires" is the floor, not the ceiling. It is licence to **stop at the floor** when the blast radius is small, and to say so out loud rather than discovering it after the fact.

The honest test: **"if this check simply did not exist, what would it cost us this quarter?"** If the answer is "very little" — as it was for 0063, whose corpus was clean, whose class had occurred once in the project's history, and which expires at 1.0 — then one round of proving the detectors fire is the correct amount of rigour, and a second round is the sunk-cost fallacy wearing the costume of diligence.

### Enforcement

Rules 1–4 and rule 6 are **review-enforced**. They are properties of prose and structure that no static rule can check honestly, and a rule that could would itself need a rule 5 guard.

Rule 5 is enforced by the reviewer question, which is cheap and mechanical: **"what would this test do if the thing it guards were completely broken?"** If the answer is "pass," the derivations are not independent. That single question found three defects in 0063 that three prior review rounds missed, and 11 then 9 more across plans 0069–0070 that expert inspection did not.

It has one precondition, and it is the whole content of rule 5's first corollary: the question is only as good as the enumeration of "the thing". Ask it against a list derived from the diff. Asked against a list derived from memory it returns "pass" honestly and tells you nothing, which is the most expensive answer available — it is a false green about your own guards.

We deliberately do **not** dogfood these as ts-archunit rules. ADR-007's own dogfooding example is instructive: as written it references a non-existent export and is unscoped, so it would false-red against 107 test files. An unenforceable rule stated honestly beats an enforced rule that is wrong.

## Consequences

### Positive

- The failure surface becomes a contract rather than an accident, for the consumer we actually ship to.
- Rule 5 gives review a single mechanical question that catches a defect class three rounds of expert review missed by inspection alone.
- Exclusion-by-construction (rule 3's corollary) removes maintained artifacts entirely rather than making them safer. In 0063 it paid off three times for free.

### Negative

- Rule 5 makes some guards genuinely harder to write; a second independent derivation is not always available. Where it is not, the honest move is to **state the gap**, not to ship a same-derivation check that looks like a guard.
- Rule 2 lengthens messages. Put per-hit facts on the hit and the imperative on the assertion, or the remedy drowns in repetition.
- These are review-enforced, so they rot exactly like anything else review-enforced. Rule 5 applies to this ADR too: nothing here is derived. What it has instead is two independent bodies of evidence, four months and two plans apart, that reproduce the same failure shapes on unrelated code — which is weaker than a derivation and stronger than an argument.
- Rule 2's behavioural corollary makes remedy text a testable artifact, which is the point, but it means a message change is now a code change: it needs a fixture where the remedy is applied and the finding clears. Cheap per message, and the alternative is a `Fix:` line that sends an agent in a circle.
- Rule 1's migration corollary rules out the cheapest migration design. Shipping a diagnostic-first release costs more than shipping a warning, and the warning would not have worked; plan 0070 paid for that discovery twice before withdrawing the channel.

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

The three additions accepted in 2026-07-29 all came from rules failing on their own terms rather than from reasoning about them:

- Rule 5's **enumeration** corollary came from rule 5's own question returning an honest "nothing passes" against a list assembled from memory. It is the only corollary here that is about the reviewer rather than the code.
- Rule 2's **behavioural** corollary came from bug 0017, where a remedy that reads correctly and would satisfy any contains-assertion reproduces the violation it claims to fix.
- Rule 1's **migration** corollary came from building the warn-first release this ADR's own logic recommends against, and measuring it invisible. The rule was right; the corollary is what it implies for a gate that has to land on existing code.

Rule 1's carve-out for optional-remedy findings currently rests on a channel that does not deliver — see [bug 0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md). Until that is fixed, "this should warn" means "this should warn and nobody in a test run will see it", and the carve-out is weaker than the rule assumes.

The Context table is evidence, not self-flagellation. It is kept because rule 5 was invisible for three rounds precisely because each individual instance looked like a local mistake.
