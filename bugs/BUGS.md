# ts-archunit Defects

**Version:** 0.40.0 · **Open:** 3 · **Fixed:** 45 (`fixed/`) · **Updated:** 2026-08-01
**Roadmap:** `../plans/ROADMAP.md` · **Standard:** [ADR-008](../adr/008-agent-first-failure-surfaces.md)

> Conventions: a bug lives here while open and moves to `fixed/` when it ships, with a
> **Fix as shipped** section and its sabotage matrix. The location is the status — a
> header claiming FIXED in `bugs/` is a bug about a bug. Severity is about **blast
> radius**, not frequency: a rare fault on a published API outranks a common one behind
> an internal seam, per [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

---

## Priority

The order to work them in, and the reason. This is a decision, not a sort — several
lower-severity items are ahead of higher-severity ones because of what they unblock.

| #   | Bug                                                                                                                                       | Severity        | Why here                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [0038](./fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md) — a typo in a preset override key is a silent false green | High            | Do **option zero only** — type the override key as a union of the preset's rule IDs, so the typo is a compile error. Cheap, catches at authorship, costs no CI. The runtime finding is a separate release: it turns currently-green builds red, and must not ride along with anything else that surprises people.                                                                                                          |
| 2   | [0040](./0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md) — cross-layer reports nothing on an empty layer       | High (API half) | `haveMatchingCounterpart` needs a `Layer[]` **no public API can produce** — a first-five-minutes failure. Fixing it also makes [0042](./fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md)'s remedy true and unblocks the runtime half. Note: a control in `cross-layer-finding-owns-its-remedy.test.ts` is **designed to fail** when this lands — that is the signal to rewrite the remedy text. |
| 3   | [0044](./0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — an inline exclusion comment has no feedback channel               | Medium          | Half-mitigated: v0.37.0 disclosed what comments _do_ suppress. What remains is the other direction — a misplaced or stale directive is silent. Take the `doctor` option; it catches the rename case cheaply and needs no per-rule work.                                                                                                                                                                                    |

**Shipped since this list was written:** [0045](./fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md)
in v0.39.1 — filed as two flaky tests, and one of them was a **shipped defect**: a symlinked
`node_modules` was never pruned, so pnpm and worktree users got `absent` where the truth was
`not-determined`. The instrument is fixed, so the verdicts below can be trusted again.

**Also shipped:** [0043](./fixed/0043-an-exclusion-directive-inside-a-string-literal-suppresses.md)
in v0.40.0 — and fixing it exposed a second fault the first had been hiding: a comment _about_
the directive syntax was being read as the syntax, including this parser's own documentation.

**Earlier:** [0047](./fixed/0047-a-fileless-finding-renders-a-meaningless-location.md)
in v0.39.0 — and its review found the boolean it first shipped was flattening four distinct
remedies, so the payload now carries `kind` instead.

### Deliberately not next

- **[Plan 0078](../plans/0078-derive-the-configuration-finding-census.md) phases 1–2** sit behind
  0038, which adds a producer the census must pick up. Its Phase 3 already shipped in v0.37.0.
- **[Plan 0079](../plans/0079-triage-the-cardinality-only-assertions.md)** is a sampling exercise
  with a stop rule, not a defect. It waits.

---

## Open

| Bug                                                                                                                                       | State                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0038](./fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md) — a typo in a preset override key is a silent false green | **OPEN, high.** Measured: `'…no-silent-cach': 'error'` yields `{"n":1,"sevs":["warn"]}` against `["error"]` for the correct key, and the build passes. Affects all five presets for the missing finding, four for the severity false green. A test literally named `(typo guard)` asserts only that a spy fired. Fix in two parts — the typed key first, the runtime finding on its own release.                                                     |
| [0040](./0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md) — cross-layer reports nothing on an empty layer       | **OPEN, high** for the API half, Medium for the silence. `PairFinalBuilder.layers` is private at every stage and `resolveLayer` is unexported, so the required argument is unobtainable; three published examples did not compile (fixed v0.37.0). The runtime half: 2 of 3 conditions measured 4→0 violations on a dead layer, outside R3b's gate because `terminal-builder.ts:433` skips non-selector positions on a premise false for crossLayer. |
| [0044](./0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — an inline exclusion comment has no feedback channel               | **OPEN, medium.** Nothing reports a comment that matched nothing, and nothing can on the current path: comments are parsed only in files that already produced a violation. A stale directive naming a renamed rule id is inert forever. `doctor` can catch the rename case without per-rule work.                                                                                                                                                   |

---

## Patterns worth remembering

Not a list of bugs — a list of the shapes they keep taking. Each is drawn from more than
one entry in `fixed/`.

- **A guard whose list is hand-written cannot fail when the list goes stale.** Bugs 0036
  and 0042 are the same defect at different surfaces; [plan 0078](../plans/0078-derive-the-configuration-finding-census.md)
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
