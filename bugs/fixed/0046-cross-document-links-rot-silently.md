# Bug 0046: cross-document links rot silently, and 39 are broken now

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01 (v0.39.0, commit `08c0e21`); scope hole in the walk fixed 2026-08-03 (v0.45.2)
**Found in:** repository docs, by a link check run during the 0041/0042 work
**Severity:** Medium. No user-facing effect on the library, but the `bugs/`, `plans/` and `adr/`
corpus is how every decision in this project is carried forward, and a dead link is a decision
nobody can reach. This is the third time in one session that link rot has been noticed and
waved past, which is why it is being filed rather than fixed ad hoc.

## Description

A mechanical check over relative Markdown links in `bugs/`, `plans/` and `adr/` finds **82
broken targets** — the 39 first reported were an undercount from a narrower scan. The dominant cause is structural: a bug is filed at `bugs/NNNN-name.md`, other
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

- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5 — derive the census from the tree,
  not from a hand-written list.
- [Bug 0036](./0036-the-relative-glob-audit-is-incomplete.md) — the same fix at the glob
  surface, and the template for the census shape.

## Fix as shipped

`tests/docs/cross-document-links-resolve.test.ts`, and **79 links repaired** — 78 resolved
mechanically by basename, one by hand (`plans/0072` cited bug 0014 under a name it no longer
has, `0014-import-globs-do-not-match-bare-package-names.md` → `0014-bare-package-import-globs-match-nothing.md`).

### Two dialects, because there are two

| corpus                               | link style                             | broken |
| ------------------------------------ | -------------------------------------- | ------ |
| `adr/` `bugs/` `plans/` `proposals/` | relative filesystem paths              | **82** |
| `docs/`                              | VitePress root-absolute, extensionless | **0**  |

The `docs/` half nearly did not get checked. A filesystem-existence rule reports **all 159** of
its links broken, because `/presets#agentguardrails` is a route, not a path — the kind of result
that gets a check scoped down and a surface left unguarded. Under the right rule the site is
already clean, and it is the user-facing surface, so it is checked rather than skipped. A
root-absolute target route-resolves in **both** corpora, because a plan citing `/cli` is a real
link to the published site and there are several.

### The checker needed guarding before it could guard anything

First run: 82 findings, **78 real**. The four false positives were all links inside code —
`](./x.md#section)` in this document's own "Fix" section, and `[oldSolo](/api#oldSolo)` inside a
test-fixture array in plan 0063. A check that reports examples in documents _about link syntax_
is a check people learn to ignore, so fenced blocks and inline spans are blanked before scanning
(blanked, not deleted, so nothing splices together across a removed region).

## Guard — 4 rows, each detector proven once

Rule 6's floor for an internal check over a corpus we control: prove each detector fires, then
stop.

| Row                                        | Expected  | Result              |
| ------------------------------------------ | --------- | ------------------- |
| D1 — a dead relative link in `bugs/`       | red       | CAUGHT              |
| D2 — a dead route in `docs/`               | red       | CAUGHT              |
| D3 — the walk finds no documents (vacuity) | red       | CAUGHT              |
| D4 — a dead link **inside a code fence**   | **green** | GREEN — the control |

D3 is the row that matters most for a census like this: a directory typo makes every other
assertion pass over an empty list, which is the ∀-over-∅ failure the whole project is named
around. D4 pins the false-positive fix, so nobody "simplifies" the code-stripping away.

## What this does not cover

**Anchors are not validated** — `./x.md#some-heading` checks the file and ignores the fragment.
Checking headings means parsing them and reproducing GitHub's and VitePress's two different
slug algorithms, which are not the same. There are only two anchored links in the repo corpus
and 57 in `docs/`, so the payoff is small and the mechanism is fussy. Stated rather than
silently omitted; if it becomes worth doing it is a separate change.

## Follow-up (2026-08-03, v0.45.2): the walk skipped the most-read document

The check shipped walking `adr/`, `bugs/`, `plans/`, `proposals/` and `docs/`. The four markdown
files at the **repository root** were not in any of those, so `CHANGELOG.md`, `README.md`,
`CLAUDE.md` and `ts-archunit-spec.md` were the one place a dead link could not be seen.

That is backwards from the risk this bug is about. `CHANGELOG.md` is the most-read document in the
repository and the heaviest linker into `bugs/` and `plans/` — and every one of those links points
at a file that gets **renamed the day the bug is fixed**, which is this bug's exact mechanism. So
the guard covered the corpus where a dead link costs a maintainer five minutes, and skipped the one
where it costs a reader of the release notes.

Found the same way this bug was: by writing a link that did not resolve. Admitting the root
documents to the walk immediately reported **eight** broken links in `CHANGELOG.md`, seven of them
pre-existing and every one this bug's shape — `bugs/0033-…` and `bugs/0034-…` that had moved to
`fixed/`, `plans/0074-…` and `plans/0080-…` that had moved to `completed/`. One was a plan cited by
the right number and the wrong slug (`0067-project-relative-globs.md`; plan 0067 is
`0067-empty-selector-safety.md`), which a number-keyed index resolved.

Two detector proofs, baseline asserted green before each and restored after:

| Revert                                                           | Result |
| ---------------------------------------------------------------- | ------ |
| A dead link in `CHANGELOG.md`                                    | CAUGHT |
| A typo in the `ROOT_DOCS` list, which would drop a file silently | CAUGHT |

The second matters more than it looks: the root documents are named explicitly rather than globbed
(a root glob would walk `dist/` and `node_modules/`), and a named list filtered through
`existsSync` drops a mistyped entry without a word. The vacuity row now asserts each root document
is present **by name**, because the count floor is far too coarse to notice four documents leaving.
