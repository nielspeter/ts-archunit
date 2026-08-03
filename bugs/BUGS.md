# ts-archunit Defects

**Version:** 0.43.3 · **Open:** 0 · **Fixed:** 49 (`fixed/`) · **Updated:** 2026-08-01
**Roadmap:** `../plans/ROADMAP.md` · **Standard:** [ADR-008](../adr/008-agent-first-failure-surfaces.md)

> Conventions: a bug lives here while open and moves to `fixed/` when it ships, with a
> **Fix as shipped** section and its sabotage matrix. The location is the status — a
> header claiming FIXED in `bugs/` is a bug about a bug. Severity is about **blast
> radius**, not frequency: a rare fault on a published API outranks a common one behind
> an internal seam, per [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

---

## Priority

**No open defects.** Everything filed this session is fixed. The queue below is empty by design,
not by neglect — the remaining known gaps live in plans (0078–0080) with their reasoning recorded,
and the honest residues are written into the bugs that own them rather than left as open tickets.

The order to work them in, and the reason. This is a decision, not a sort — several
lower-severity items are ahead of higher-severity ones because of what they unblock.

| #                                                                                                                                 | Bug                                                                                                                                                 | Severity                                                                                                                                                                                                                                                                                                                                                                                                            | Why here |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2                                                                                                                                 | [0048](./fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md) — the dead-glob gate blames the glob when the project is empty | **OPEN, high.** Measured on `tests/fixtures/does-not-load`: the gate says _"Correct the glob, or remove the rule"_ while `doctor` says _"the project loaded 0 source files"_. Bug 0031 fixed this on `diagnose()` only; the gate grew the same reasoning independently and nothing compares the two on this input. Fix by extracting the short-circuit rather than copying it — a second copy is how this happened. |
| [0044](./fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — an inline exclusion comment has no feedback channel | Medium                                                                                                                                              | Half-mitigated: v0.37.0 disclosed what comments _do_ suppress. What remains is the other direction — a misplaced or stale directive is silent. Take the `doctor` option; it catches the rename case cheaply and needs no per-rule work.                                                                                                                                                                             |

**Shipped since this list was written:** [0045](./fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md)
in v0.39.1 — filed as two flaky tests, and one of them was a **shipped defect**: a symlinked
`node_modules` was never pruned, so pnpm and worktree users got `absent` where the truth was
`not-determined`. The instrument is fixed, so the verdicts below can be trusted again.

[0040](./fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)'s
**API half** in v0.42.0 — the builder passes its own resolved layers, so
`haveMatchingCounterpart()` needs no argument. Its silence half became
[plan 0080](../plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md), which a design review
measured as carrying three criticals: the gate would **replace** slice's finding rather than
duplicate it, costing 13 tests of the bug-0009 remedy corpus.

[0048](./fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md) in
v0.42.1 — and it survived two releases behind a test whose **name** claims the parity it does not
check: it drives the discovery path, which has its own branch, while the selector path every
ordinary rule takes was unguarded.

**Also shipped:** [0043](./fixed/0043-an-exclusion-directive-inside-a-string-literal-suppresses.md)
in v0.40.0 — and fixing it exposed a second fault the first had been hiding: a comment _about_
the directive syntax was being read as the syntax, including this parser's own documentation.

[0038](./fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md) in v0.41.0,
**both halves** — the typed key and the runtime finding. Plan 0078's census population moves to
14 as a result.

**Earlier:** [0047](./fixed/0047-a-fileless-finding-renders-a-meaningless-location.md)
in v0.39.0 — and its review found the boolean it first shipped was flattening four distinct
remedies, so the payload now carries `kind` instead.

### Deliberately not next

- **[Plan 0078](../plans/completed/0078-derive-the-configuration-finding-census.md) phases 1–2** sit behind
  0038, which adds a producer the census must pick up. Its Phase 3 already shipped in v0.37.0.
- **[Plan 0079](../plans/0079-triage-the-cardinality-only-assertions.md)** is a sampling exercise
  with a stop rule, not a defect. It waits.

---

## Open

| Bug                                                                                                                               | State                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0044](./fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — an inline exclusion comment has no feedback channel | **OPEN, medium.** Nothing reports a comment that matched nothing, and nothing can on the current path: comments are parsed only in files that already produced a violation. A stale directive naming a renamed rule id is inert forever. `doctor` can catch the rename case without per-rule work. |

---

## Patterns worth remembering

Not a list of bugs — a list of the shapes they keep taking. Each is drawn from more than
one entry in `fixed/`.

- **A guard whose list is hand-written cannot fail when the list goes stale.** Bugs 0036
  and 0042 are the same defect at different surfaces; [plan 0078](../plans/completed/0078-derive-the-configuration-finding-census.md)
  is the third instance. Derive the census from source.
- **A test that asserts the call is not a test of the consequence.** Bugs 0038 and 0041
  both hid behind a spy or a helper that supplied the very thing under test.
- **A remedy is a claim, so it needs a behavioural test.** Bug 0017 taught it; bug 0042
  shipped **two** more wrong remedies while fixing it, neither catchable by asserting
  message content. Apply the fix and assert the finding clears.
- **The verdict mechanism is part of the derivation.** Bug 0045 is this at the process
  layer; an unquoted `$SUITE` in zsh and a symlinked `node_modules` have each produced a
  full matrix of false CAUGHTs.
- **Fixing a false green often widens a neighbouring one.** v0.37.0 fixed bug 0041 and
  thereby widened 0039, 0043 and 0044. Check what a fix makes _reachable_.
