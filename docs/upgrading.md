# Upgrading

Read this **before** you bump the version, and read it **top to bottom**.

## Why the order matters

The per-release notes in `CHANGELOG.md` each say what to do about that release. Followed in
release order they produce the wrong outcome, because the actions interact:

- **0.19.0** says regenerate the baseline.
- **0.23.0** says regenerate the baseline.
- **0.24.0** says regenerate when convenient.
- **0.28.0** will say regenerate **before upgrading**.

Someone on 0.18.1 who reads those in order regenerates **last** — after every widening has
landed — and silently accepts every finding the newer releases added. The baseline records them as
already-accepted, nothing reports them again, and the run is green.

So the rule for every multi-release jump is one line:

> **Refresh the baseline on the version you are leaving, commit it, then upgrade.**

`ts-archunit baseline` now prints the delta it applied (`41 → 78 entries (+37, −0)`), so you can
see what a refresh accepted instead of inferring it.

## Coming from 0.22.x or earlier

In this order. Steps 1–3 happen on your **current** version.

```bash
# 1. See what is already broken. These findings are true today; 0.23.0 only stops
#    them passing in silence. Nothing here is a false positive.
npx ts-archunit doctor 'rules/**/*.rules.ts'      # needs 0.20.0+; skip if older

# 2. Fix every rule doctor names. A rule that asserts nothing has been counted as
#    coverage for as long as it has existed — that is the bug, not the report.

# 3. Refresh the baseline on the OLD version and commit it separately, so the
#    diff of what you accepted is reviewable on its own.
npx ts-archunit baseline --output arch-baseline.json
git commit -am 'chore: refresh arch baseline before upgrade'

# 4. Now upgrade, and run normally. What appears is what the new version added.
npm install -D @nielspeter/ts-archunit@latest
npx ts-archunit check 'rules/**/*.rules.ts'
```

If step 4 produces more than you can triage in one sitting, **do not** regenerate the baseline
again — that accepts the new findings permanently and invisibly. Downgrade their severity instead,
which keeps them printing on every run:

```ts
export default [...strictBoundaries(p, { boundaries }).map((b) => b.asSeverity('warn'))]
```

Then ratchet: fix a few, and drop the `.asSeverity('warn')` when the list is empty. A warn prints
on every run and cannot be forgotten; a baselined finding is invisible forever.

**Do not reach for these**, in either case:

| Shortcut                 | What it actually does                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `.excluding('index.ts')` | Silences **every barrel in the project at once**, including their legitimate imports — `element` is matched as a basename, not a path. |
| `--changed`              | Hides findings in unchanged files. It now says how many it hid, but a green run under `--changed` is not a green run.                  |
| Regenerating again       | Accepts the new findings with no record of which ones. This is the failure mode the whole page exists to prevent.                      |

## Per-release table

**Changes enforcement** means the release can report findings on code you did not touch, or stop
reporting findings it used to. **Action required** means doing nothing leaves you with either new
red or silently reduced coverage.

| Version    | Changes enforcement?                                                                                                      | Action required                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.26.0** | No — output routing only                                                                                                  | None. `.warn()` and every other library message now reach stderr from inside a test runner, so a passing test prints where it did not before. `.warn()` output loses vitest's per-test attribution.             |
| **0.25.0** | **Yes** — a dead `strictBoundaries({ shared })` glob is now a configuration finding                                       | Fix or delete `shared` globs that match no file. Baselines are unaffected: `no-cross-boundary`'s text changed but its identity did not.                                                                         |
| **0.24.0** | **Yes** — a rule file that cannot be evaluated is a finding instead of a crash                                            | Fix any rule file that fails to load; it no longer takes the rest of the run down. Violation output is one line longer per finding. `runCheck`/`runBaseline` resolve with a non-zero code instead of rejecting. |
| **0.23.0** | **Yes** — all seven assertion-less rule shapes fail on every terminal, and cannot be suppressed                           | Fix every rule that asserts nothing (`doctor` lists them). **Refresh the baseline**: conditions now accumulate, so entries for rules whose description changed stop matching.                                   |
| **0.22.0** | No — adds the instrument for 0.23.0                                                                                       | None, but run `ts-archunit doctor` now: it reports exactly what 0.23.0 will fail on, before it fails.                                                                                                           |
| **0.21.0** | **Yes** — a held builder is immutable, so narrowing one no longer mutates it                                              | Re-read any rule built by narrowing a shared builder: it may now select **different subjects** than it did.                                                                                                     |
| **0.20.0** | **Yes**, two ways — `.warn()` can throw for a configuration finding, and import globs match bare package names            | Fix vacuous rules (`.warn()` no longer hides them). `notImportFrom('fastify')` now matches an installed `fastify`, which is the fix for bug 0014 and may be new red.                                            |
| **0.19.0** | **Yes** — violation identity became portable, every preset rule gained a remedy, and the smell detectors see handler maps | **Refresh the baseline.** A baseline written on ≤0.18.1 encoded absolute paths in its hashes, so it matches almost nothing after this.                                                                          |
| **0.18.1** | **Yes**, both directions                                                                                                  | `slices().matching()` globs that resolve for the first time now produce real slices (red → green). An `.excluding()` that happened to match a discovery finding's text can no longer silence it (green → red).  |
| **0.18.0** | **Yes (breaking)** — empty discovery fails instead of passing                                                             | Fix `slices().matching()` / `.assignedFrom()` globs that resolve to no slices, and `crossLayer` rules whose left layer matches zero files. Both used to pass vacuously.                                         |
| **0.17.0** | No                                                                                                                        | None. `init` gains `--preset`.                                                                                                                                                                                  |
| **0.16.0** | **Yes (breaking, action required)** — shape presets return rules instead of throwing                                      | Wrap every preset call: `checkAll(layeredArchitecture(p, opts))`. A bare call now builds rules and asserts **nothing**.                                                                                         |
| **0.15.0** | No                                                                                                                        | None. Adds `tsconfig(p)`.                                                                                                                                                                                       |
| **0.14.0** | No                                                                                                                        | None. Adds `ts-archunit init`.                                                                                                                                                                                  |
| **0.13.0** | No                                                                                                                        | None. `check --format json` becomes one document for the whole run; update anything parsing per-rule documents.                                                                                                 |
| **0.12.0** | No                                                                                                                        | None. Adds `jsxText()`.                                                                                                                                                                                         |
| **0.11.0** | No                                                                                                                        | None. Adds `calls().identifiedByArg()`.                                                                                                                                                                         |
| **0.10.0** | **Yes (breaking)** — the TypeScript rules widened to constructors, getters and setters, and their message text changed    | **Refresh the baseline** — message text is part of a finding's identity. Expect new findings from the widened scope.                                                                                            |
| **0.9.0**  | No                                                                                                                        | None. Adds `jsxElements(p)`.                                                                                                                                                                                    |
| **0.8.0**  | **Yes** — `beImported()` and `noDeadModules()` resolve dynamic imports                                                    | Expect **fewer** dead-module findings. A baseline entry that stops matching here means the finding is gone, not that it moved.                                                                                  |
| **0.7.2**  | **Yes** — element names now include constructors, getters, setters and property initializers                              | **Refresh the baseline** — the element name is part of identity. `.excluding()` also starts working with `satisfy()` conditions, so an exclusion that never applied may now apply.                              |
| **0.7.1**  | No — internal refactor                                                                                                    | None.                                                                                                                                                                                                           |
| **0.7.0**  | No                                                                                                                        | None. Adds body analysis, export and reverse-dependency conditions.                                                                                                                                             |
| **0.6.0**  | **Yes** — `expression()` no longer reports every ancestor node                                                            | **Refresh the baseline.** Counts drop sharply (189 → 13 in the case that prompted it) for any rule using `expression()`.                                                                                        |
| **0.5.0**  | No                                                                                                                        | None. Adds `property()` and argument matchers.                                                                                                                                                                  |
| **0.4.0**  | No, but **source-breaking**                                                                                               | Replace the removed `notType` export with `not()`, which now handles both predicates and type matchers.                                                                                                         |
| **0.3.0**  | No                                                                                                                        | None. Adds member, parameter, visibility and return-type rules.                                                                                                                                                 |
| **0.2.0**  | No                                                                                                                        | None. `notImportFrom()` / `importFrom()` become variadic.                                                                                                                                                       |
| **0.1.0**  | n/a — nothing earlier to change                                                                                           | None. This is the earliest release the table covers; treat adopting it as a fresh start.                                                                                                                        |

## What a version number does not tell you

A separately-installed older CLI **does not** reproduce an older version's behaviour. `ts-archunit`
loads your rule file from your project, and that file's
`import … from '@nielspeter/ts-archunit'` resolves against your `node_modules` — so a pinned
`ts-archunit@0.27.0` binary prints `0.27.0` and reports the **new** version's findings.

If you are bisecting "which version started reporting this?", change the **dependency**, not the
binary.
