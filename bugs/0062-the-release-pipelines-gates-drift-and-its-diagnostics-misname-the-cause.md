# Bug 0062: the release pipeline's gates have drifted, and its docs step misnames the cause

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** accumulated; surfaced by reviewing the three releases of 2026-08-04.
**Severity:** Medium. Nothing has shipped broken — the publish gate is sound — but three separate
mechanisms can red or mislead for reasons unrelated to their subject.

## What was checked and is fine

Worth recording, because it was the hypothesis going in and it was **wrong**: a tag push **cannot**
publish a failing commit. `publish.yml` runs typecheck, lint, format:check, test and build before
`npm publish`, and `prepublishOnly` runs the suite again inside it. The tarball is `dist/**` plus
metadata — `npm pack --dry-run` confirms no fixture leaks. `context7-key.env` has never been added on any
ref and is ignored. `id-token: write` is scoped to the publish job.

## Four real gaps

**1. `publish.yml`'s gate is a strict subset of `ci.yml`'s — `shellcheck` is missing.** `ci.yml` runs
`shellcheck -x .github/scripts/*.sh scripts/*.sh` with a comment noting these scripts are covered by
nothing else and _"One of them holds a secret in the release path."_ `publish.yml` stops after build.
`main` is unprotected and none of the three releases went through a PR, so CI's verdict is _concurrent_
with the publish run and gates nothing. A syntax error in `refresh-context7.sh` publishes fine.

**Fix:** extract the validate steps plus shellcheck into a reusable workflow `uses:`d by both, so the
gates cannot drift again. A second copy is what drifted.

**2. A 429 from the Context7 index fails the job while naming four causes, none of them the real one.**
`refresh-context7.sh` fails with an enumeration of 400/401/404/405. With a 10/day limit and three releases
in one day, 429 is the normal case — it happened repeatedly on 2026-08-04 and was misread as ordinary
noise, which is exactly the habit that script's own comment says it exists to prevent: _"A red job has to
mean 'someone must act', or it becomes noise."_

**Fix:** an explicit 429 branch naming quota exhaustion and the remedy (wait for the window, re-run
`Update Context7 Docs`, do **not** re-run publish), plus one delayed retry. Failing is right — a stale
index is not optional — but the message must name the cause.

**3. `docs-index`'s `timeout-minutes: 10` is under-budgeted, and the comment's arithmetic counts sleeps
but not requests.** The comment argues 180s of polling plus a 60s POST fits in 10 minutes. But
`read_index` is not memoized, so each poll iteration makes **two** `curl --max-time 30` calls, and the
verdict tail calls it four more times. Worst case ≈ 720s against a 600s job timeout — the runner kills the
job and discards the verdict the script was designed to produce.

**Fix:** memoize `read_index` per attempt so `state` is free as the comment claims, and raise the timeout
to 15.

**4. The docs site deploys independently of publish success, with no concurrency group.** `docs.yml` fires
on any push to `main` touching `docs/**`. All three releases touched `docs/`. If publish reds, the live
site documents a version npm does not serve. And with no `concurrency:` block, two docs-touching pushes
queue two `deploy-pages` runs against one Pages environment — a live race with three releases in three
hours, where the loser reds for reasons unrelated to its content.

**Fix:** add `concurrency: { group: pages, cancel-in-progress: true }`, and gate the deploy on the tag or
on publish success.

## Not fixed here, recorded

- **No branch protection on `main`** and no required checks. A bad commit is only found after the tag
  exists, and recovery means deleting a tag or burning a version. A process choice rather than a defect,
  but it is what makes gap 1 reachable.
- **`format` and `format:check` cover different file sets.** `format` is `prettier --write .`;
  `format:check` globs an extension list, so four `.graphql` fixtures and `.prettierrc`/`.prettierignore`
  can be rewritten by one and never checked by the other. Same hazard `.prettierignore` already documents
  for another fixture directory.
- **`*.tgz` is not gitignored**, so `npm pack` leaves a 576 kB untracked tarball in a repo whose threat
  model already includes `git add -A`.
- **27% of the tarball is source maps that resolve to nothing** — `files` omits `src`, so 310 `.map` files
  point at sources the consumer does not have.
- **The dogfood slice globs use the unanchored `'**/src/**'` shape** that the same file warns about and
  derives `SRC_PREFIX` to avoid. No fixture collides today, but `arch/no-cycles` is now `.check()` and the
  new `verbatim-module-syntax` fixtures are deliberately cyclic.

## Related

- `.github/workflows/{ci,publish,docs}.yml`, `.github/scripts/refresh-context7.sh`.
- [Bug 0051](./fixed/0051-the-jsx-entry-point-has-never-run-against-a-file-on-disk.md) — where the
  last `format:check` gap was fixed. Note it was fixed **inline, without its own bug report**: an
  untracked file made `validate` pass locally and the v0.46.1 publish fail, and the pathspec was changed
  to `--cached --others --exclude-standard` as part of unrelated work. That is the project's own filing
  rule skipped under time pressure, and it is why the residue above went unrecorded for a release.
