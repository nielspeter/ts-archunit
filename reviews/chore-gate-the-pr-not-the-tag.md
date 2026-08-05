# Review — chore/gate-the-pr-not-the-tag

**Range:** main..HEAD · **Reviewers:** reviewer-devops, reviewer-testing · **Date:** 2026-08-05

**Commits reviewed**

- `8c1feb2` chore: gate the PR, not just the tag
- `5b12000` fix: eight holes two reviewers measured in the gate

**Personas:** devops and testing only. Architect, product and customer were spawned and stopped — the
diff is a shell hook, a shell harness, a JSON config and a markdown file, and none of the three had a
domain here. Picking the skill's `all` default was reaching for a form instead of the intent.

## Review Summary

| Persona   | Verdict                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| devops    | 2 critical, 5 important, 5 minor — all reproduced in a scratch repo, nothing reasoned-only  |
| testing   | 1 critical, 4 important, 5 minor — 37 reverts derived line-by-line, 18 caught, 16 real gaps |
| architect | Not run — no architectural surface in a dev-tooling hook                                    |
| product   | Not run — ships nothing to adopters                                                         |
| customer  | Not run — no user-facing change                                                             |

## Critical — all three fixed and verified

| #   | Reviewer | Finding                                                                                                                                                                                                                                                                                                | Verdict                                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | devops   | The `chore: release` exemption trusted the **subject line**: a commit titled `chore: release v1.0.1 and rewrite the auth layer` carrying `src/evil.ts` passed both gates. That is the one subject this repo writes at every release, and the file's own comment claimed exemptions were content-scoped | **Fixed.** Scoped by content to version bookkeeping. Row added                                                      |
| 2   | devops   | The fast path used literal single spaces where the parser uses `\s+`, so `git  tag v1.0.1` skipped the mechanism. A pre-filter stricter than what it fronts is a hole                                                                                                                                  | **Fixed.** Whitespace class in both the fast and degraded paths. Three rows added                                   |
| 3   | testing  | **Gate 1's detector could not fire.** The harness tagged `v1.0.1` at HEAD, so the range held 0 commits and the diff was empty for _any_ pathspec — deleting `-- src/ README.md` scored 0 failures. Flaked to the other gate when two tags landed in the same second                                    | **Fixed.** Tag placed at the release commit, commit dates pinned. Verified: deleting the pathspec now fails the run |

## Important

| #   | Reviewer | Finding                                                                                                                                             | Verdict                                                                                                                                                                                                         |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | devops   | `git tag -a v1.0.1 -m …` was not gated                                                                                                              | **Fixed**, with a row                                                                                                                                                                                           |
| 5   | devops   | Gate 1's baseline keyed off `package.json`'s version, not the tag in the command — tagging ahead of the bump compared against the wrong predecessor | **Fixed**, with a row                                                                                                                                                                                           |
| 6   | devops   | Single-quoted spans were stripped before double, so two apostrophes in ordinary English erased a real command between them                          | **Fixed** by reversing the order, with a row                                                                                                                                                                    |
| 7   | testing  | `row()` interpolated JSON by hand, so any command containing `"` produced invalid JSON and the row silently tested the fail-closed branch           | **Fixed** — `json.dumps`. This had already bitten: my own tab row was passing for that reason                                                                                                                   |
| 8   | devops   | Editing the hook or harness gets you blocked by trigger strings inside heredoc bodies — three times in one session                                  | **Rejected.** Stripping heredocs needs a shell parser, not a regex, and the failure direction is a visible block with a stated remedy rather than a silent pass. Use Write rather than heredocs when editing it |
| 9   | testing  | Row 3 is bundled — quote-stripping and the command-position anchor each score 0 failures alone; row 2 is vacuous                                    | **Accepted, not built** — see the note below                                                                                                                                                                    |

## Minor

| #   | Reviewer | Finding                                                                                                                                                                                        | Verdict                                                                                     |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 10  | devops   | The version was read with `node`, so both release gates exited 0 when node was absent                                                                                                          | **Fixed** — python3, and fails closed. Same hole the file argues against, one tool over     |
| 11  | devops   | `unreviewed_in` returned "all reviewed" for a range it could not enumerate                                                                                                                     | **Fixed** — blocks. ∀-over-∅ inside the enforcement mechanism                               |
| 12  | devops   | `shellcheck` in CI globs `.github/scripts/*.sh scripts/*.sh` — these two files were linted by nothing                                                                                          | **Fixed** in both workflows                                                                 |
| 13  | devops   | Short-sha matching breaks if `%h` widens (`core.abbrev=12` turns a reviewed branch red)                                                                                                        | **Rejected** — not reachable at this repo's size, and the failure is a visible block        |
| 14  | devops   | `.claude/settings.local.json` is tracked (mode 100644, from `bbafa6a`), and that is where `permissions.allow` is written                                                                       | **Raised with the author** — a file I did not write, so untracking it is not mine to decide |
| 15  | testing  | 16 reverts caught by nothing — mostly classifier internals, `cd $CLAUDE_PROJECT_DIR`, `[ -f package.json ]`, per-branch record scoping, and missing rows for `npm publish` / `git push --tags` | **Accepted, not built** — see below                                                         |

## Two things found by running the fixes, not by the reviewers

- **The harness printed `failures: 1` and exited 0.** No caller could tell a passing run from a failing
  one — the exact defect testing praised `row()` for avoiding, one level up, in the file that checks the
  checker. Verified after the fix: hook stubbed to always pass gives exit 1 and 10 failed rows.
- **A sixth instance of finding 2.** The row written for it exposed that the fast path greps the **raw
  JSON payload** while the parser reads the **decoded** command, so whitespace arriving as `\t` bypassed
  it. Same defect class, one layer down.

## Accepted and not built, with the reason

Findings 9 and 15 are real. Testing's own verdict is the reason they are not being built now: _"one fix
gets it there … everything else is second-round work the blast radius does not buy."_ ADR-008 rule 6 puts
a local dev-tooling hook at the floor — prove each detector fires once and stop — and after the three
criticals every detector this gate actually depends on has a row that fires. This is a recorded decision,
not a deferral: if the hook grows a new decision branch, that branch gets a row with it.

Also rejected with its reasoning kept, because the argument is good: testing's proposal to key the record
on `git patch-id --stable` rather than short shas. Measured stable across rebase and reword, changing the
moment content changes — a better identity than a sha. Its verdict that _"blocking after a rebase is
correct, because rebased code is not the code that was reviewed"_ is right, and the cheap half of it is
taken: the block message now names the rebase case and says the remedy is to re-record.

## Praise

- Testing verified the harness cannot report success while broken: hook with a syntax error → 11 failed
  rows, hook deleted → 15. And it identified the gate-identity greps as the only channel able to tell
  Gate 1 from Gate 2 apart, since both exit 2 — that channel is what caught the pathspec deletion above.
- Devops confirmed the python3-degradation branch on the discriminating case: with python3 off `PATH` it
  blocks a real PR and a real tag and does **not** block `git push origin main`.
- Both confirmed the record-commit exemption is right and right for the stated reason, and that `reviews/`
  missing entirely fails closed on both gates — the obvious way to defeat the mechanism is covered.
