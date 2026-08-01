# Bug 0046: cross-document links rot silently, and 39 are broken now

**Reported:** 2026-08-01 · **Found in:** repository docs, by a link check run during the 0041/0042 work
**Severity:** Medium. No user-facing effect on the library, but the `bugs/`, `plans/` and `adr/`
corpus is how every decision in this project is carried forward, and a dead link is a decision
nobody can reach. This is the third time in one session that link rot has been noticed and
waved past, which is why it is being filed rather than fixed ad hoc.

## Description

A mechanical check over relative Markdown links in `bugs/`, `plans/` and `adr/` finds **39
broken targets**. The dominant cause is structural: a bug is filed at `bugs/NNNN-name.md`, other
documents link to it there, and when it is fixed it moves to `bugs/fixed/NNNN-name.md`. Every
inbound link breaks, silently.

Confirmed instances include `bugs/fixed/0014`, `0015`, `0017`, `0018`, `0022`, `0029`, `0030`,
`0031`, `0032`, `0033`, `0034`, `0035`, `0036`, `0037`, `plans/0072`, and two rows of
`plans/ROADMAP.md` still pointing at `bugs/0031-…` and `bugs/0032-…`.

## Why it is worth a check rather than a sweep

Fixing the 39 takes minutes and buys nothing durable: the next bug that moves to `fixed/`
re-breaks its inbound links the same day. The repository already treats this class of problem
the right way elsewhere — `tests/docs/doc-globs-are-anchored.test.ts` and
`tests/core/every-path-glob-surface-is-classified.test.ts` both derive their subject from the
tree rather than from a list — and this is the same shape one layer out.

## Fix

A test that walks every `.md` under `adr/`, `bugs/`, `plans/` and `proposals/`, extracts
relative links, and asserts each target exists. Roughly twenty lines.

Two decisions to make while writing it:

1. **Anchors.** `](./x.md#section)` should validate the file and, ideally, the heading. Start
   with the file; a heading check is a second, easy step and catches renamed sections.
2. **What to do about the 39.** Fix them in the same change, or the test cannot go green. A
   resolver that matches by basename handles almost all of them mechanically — the same approach
   already used twice in this session to repair moved documents.

## Guard

The test _is_ the guard, so the question is what guards the test. Rule 6 puts this at "internal
check over a corpus we control": prove each detector fires once, then stop.

- a link to a file that does not exist → the suite reds;
- a link to a file that does → green (the control);
- **vacuity: assert the scan found a non-trivial number of links.** A glob that matches no
  documents passes for free, which is precisely the ∀-over-∅ failure this project is named
  around.

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5 — derive the census from the tree,
  not from a hand-written list.
- [Bug 0036](./fixed/0036-the-relative-glob-audit-is-incomplete.md) — the same fix at the glob
  surface, and the template for the census shape.
