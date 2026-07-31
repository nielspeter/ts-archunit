# Plan 0077 — `doctor`: promote it

**Status:** PROPOSED, and **reversed during its own investigation**. Draft 1 recommended retiring
`doctor`. Four measurements refuted the premise it rested on; the reversal is left visible below
because the refuted argument is the one a future reader will reach for again.
**Priority:** High as a decision, Low as work. It settles the open question
[plan 0069](./completed/0069-no-rule-may-certify-nothing.md) required be answered **before R3**,
and which has now been deferred across five sessions — 0069 named the mechanism exactly:
_"shipping it experimental/hidden is precisely the mechanism that defers the decision."_
**Effort:** ~2 hours. It is documentation and one `HELP_TEXT` entry.
**Breaking:** no.

## The question

> **`doctor`'s life after R3** — keep as a supported command, or retire it?

## Draft 1 said retire. Here is what refuted it

Draft 1's deciding fact was: _"it cannot load the shape the docs lead with"_ — a rule file that
imports vitest cannot be `import()`ed outside vitest, so `doctor` is blind to the primary
authoring shape.

**The first half is true and measured.** Running `doctor` against a vitest-importing rule file:

```
exit=1
Error: … could not be loaded (Cannot read properties of undefined (reading 'config')),
so none of it could be diagnosed. If this file imports a test runner (vitest/jest),
doctor cannot load it — run your test suite instead.
```

**The second half is false, and that is the whole argument.** `docs/getting-started.md:10`:

> _"That's it — no test runner required. (Already run vitest/jest and prefer your rules there?
> See Running Rules in Tests.) **This guide uses the CLI, the default path.**"_

`npx ts-archunit init` scaffolds `arch.rules.ts` — measured, **zero** vitest imports — plus `arch`
and `arch:baseline` scripts. So the documented default path produces exactly the shape `doctor`
loads, and `doctor` works on it: run earlier in this investigation against a rule file of that
shape, it reported the dead glob, named the site and exited 1.

Draft 1 read CLAUDE.md's _"rules run in vitest/jest"_ — which is the description of **this
repository's own** suite — as a statement about adopters. It is not. The user-facing default is
the CLI.

**Two further facts draft 1 missed, both pointing the same way:**

1. **`doctor` reports something `diagnose()` structurally cannot: load failures.** `diagnose()`
   never loads anything, so it cannot tell you a rule file failed to load. `doctor` has explicit
   machinery for it, and the comment at `doctor.ts:55-60` says why — swallowing a load failure
   _"turned a visible crash into `exit 0` plus a clean bill of health — the ADR-008 rule 1 failure
   this command exists to surface."_ A rule file that does not load is zero coverage reported as
   success, and `doctor` is the only surface that catches it.
2. **The present state is a documented holding pattern, not an accident.** `docs/cli.md:141-143`
   already says it is _"deliberately absent from `--help`: retiring a documented command later
   would be its own breaking change, and its future is undecided,"_ and points vitest users at
   `diagnose()`. Draft 1 called this _"neither hidden nor supported… the worst of both"_. That was
   unfair to a deliberate decision that is honestly labelled.

So the two authoring shapes each already have a working pre-flight — `doctor` for the CLI default,
`diagnose()` for the vitest path — and the docs already route between them. Nothing is broken. The
only thing outstanding is the **decision**, which is what 0069 asked for.

## Decision: promote it

Make `doctor` supported: list it in `HELP_TEXT`, replace the "future undecided" warning with its
**scope**, and keep everything else exactly as it is.

Scope, stated once and in the one place a reader looks:

> `doctor` diagnoses rule files the CLI can load — the `arch.rules.ts` shape `init` scaffolds. If
> your rules live in a vitest or jest test file, the CLI cannot import it; call `diagnose(rules)`
> in that suite instead, which reports the same findings.

Two things deliberately **not** changed:

- **It stays out of build pipelines.** 0069's reasoning holds: it is an explicitly-invoked
  diagnostic, not a gate, and `check` is the gate. Promotion is about discoverability, not role.
- **`diagnose()` stays public and stays the answer for vitest.** Promoting the command does not
  demote the function; they serve different hosts and the docs already say so.

## Phases

### Phase 1 — make it discoverable

Add `doctor` to `HELP_TEXT` in `src/cli/index.ts`, beside `check`, `baseline`, `explain` and
`init`, with a one-line description naming its scope.

**Files:** `src/cli/index.ts`.

### Phase 2 — restate the docs from "undecided" to "scoped"

`docs/cli.md:112` drops "(experimental)" from the heading; the warning block at `:141` becomes the
scope statement above, keeping the do-not-wire-into-a-pipeline guidance and the `diagnose()`
pointer. The other six pages that mention `doctor` lose the word "experimental" where it appears.

**Files:** `docs/cli.md` (3 mentions), `docs/api-reference.md` (7), `docs/custom-rules.md` (4),
`docs/upgrading.md` (5), `docs/troubleshooting.md` (2), `docs/violation-reporting.md` (1),
`docs/running-in-tests.md` (1); `CHANGELOG.md`.

### Phase 3 — unblock 0074's gate

This survives the reversal, and it is the part with real value. 0074's gate says it needs _"a real
project with ts-archunit rules in a **loadable** `arch.rules.ts` — not a vitest test file, because
`doctor` cannot load one."_ That constraint is real for `doctor` and **not** real for the
diagnosis: `diagnose()` runs wherever the rules are built. Restate the gate as _"run the
pre-flight — `doctor` for a CLI-shaped project, `diagnose()` for a test-hosted one — and classify
each finding against the registered decision rule."_

That is why this repository could never run its own gate: 43 rules inside `it()` callbacks, so
`doctor` cannot see them — but `diagnose()` can, once the rules are collected.

**Files:** `plans/0074-r3b-the-selector-glob-flip.md`.

## Test inventory

| test                                                 | asserts                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `doctor is listed in --help`                         | phase 1, the whole point of promotion                                         |
| `doctor still reports a dead glob and exits 1`       | promotion changed discoverability, not behaviour — the 14 existing tests stay |
| `doctor reports a load failure that diagnose cannot` | the capability that justifies keeping the command at all                      |
| `the docs no longer call it experimental`            | phase 2, derived by scanning the pages rather than restated                   |

## Guards

ADR-008's question: **what would these tests do if `doctor` were quietly reduced to a `diagnose()`
wrapper that drops load failures?** The first two pass. So the third is load-bearing, and it must
assert the finding — a rule file that fails to load must produce a non-zero exit **and** name the
file, because the failure this command exists to prevent is `exit 0` on a file that never ran.

## Out of scope

- **Making `doctor` load vitest files.** Not possible; the docs route those users to `diagnose()`.
- **Making `doctor` a build gate.** 0069 decided against it and nothing here reopens that.
- **Whether R3b ships.** This unblocks the decision, not the flip.

## Postscript: why draft 1 went wrong

It reasoned from an error message and a sentence in CLAUDE.md without running the command or
reading `getting-started.md`. Both checks took two minutes and both pointed the other way. The
error message was real evidence about a real limitation, and the mistake was inferring the
**population** it affects from one internal sentence rather than from what `init` produces.
