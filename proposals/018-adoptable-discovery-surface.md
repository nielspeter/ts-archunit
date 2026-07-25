# Proposal 018 — An Adoptable Discovery Surface

**Status:** Draft 2 — the severity flip moved from out-of-scope into the proposal after measuring what an agent actually receives for a warning in CI (exit 0; the loop ends before the text is read).
**Priority:** High — the discovery surface is the largest shipped-but-unused capability in the library, and the reason it is unused is a **fixable defect**, not a philosophical one.
**Affects:** `hashViolation` identity inputs (`src/helpers/baseline.ts`), the message construction in `src/smells/*`, one new opt-in ratchet terminal, and the smell severity registered by `agentGuardrails` / `strictBoundaries`. No change to any predicate, condition, or entry point.
**Origin:** A 2026-07 coverage audit of a large adopting codebase, plus the "flip checklist" from that project's earlier (March) rule inventory. Both are external documents; the relevant evidence is reproduced below.

> **Two independent things are wrong, and fixing either alone changes nothing.** The detectors are registered at `warn`, which in CI means `exit 0` — an agent's loop ends before it reads the finding, so the signal does not exist. And the ratchet is broken for them, so simply promoting to `error` puts 700 findings red on arrival and the rule gets deleted. Note `.check()` itself was never missing: `SmellBuilder extends TerminalBuilder`, so fail-grade has always been one call away. What is missing is a way to **survive turning it on**.

## Problem

A mature adopting project — 177 enforced rules, 1 warn, agent-first messages throughout, a genuine power user of the enforcement surface — used the discovery surface **zero times**. Pointing `duplicateBodies` at it surfaced **~700 findings that all 177 enforced rules were blind to**, including the exact copy-paste rot the tool exists to prevent.

The obvious diagnosis is severity: advisory findings are invisible to an agent
(ADR-008), so promote them to `.check()`. That diagnosis is **necessary but not
sufficient**, and two measurements say why.

**1. `.check()` already works, so severity is a registration choice, not a missing
feature.** `SmellBuilder extends TerminalBuilder`. Promoting is one argument — and
§3 shows it must happen. But if that were the whole story the fix would have been a
one-line change years ago, and it is not, because of (2).

**2. The ratchet is structurally broken for smells.** `hashViolation` is
`rule::element::message` and deliberately **excludes** `violation.line`, so a
finding survives edits elsewhere in the file — there is an existing test asserting
exactly that. But `duplicateBodies` writes coordinates _and_ a similarity
percentage into the message:

```
findByIds (a.ts:10) is 94% similar to findAll (b.ts:22)
```

so the excluded line number re-enters the hash through the back door. Measured:

| Change                                       | Baseline entry             |
| -------------------------------------------- | -------------------------- |
| Ordinary rule, same finding twice            | **stable** ✔               |
| Smell, one blank line added above a function | **hash changes** → re-reds |
| Smell, a body edited (94% → 92% similar)     | **hash changes** → re-reds |

A team that baselines 700 duplicate-body findings gets a green build exactly once.
The next unrelated edit near any of those functions re-reds it, with a finding they
already accepted. That is not an adoption speed-bump; it makes the documented
adoption path (`withBaseline()`) non-functional for this entire surface.

### Independent corroboration: why real rules stay advisory

The same project's flip checklist catalogues 25 rules by whether they could be
promoted from `.warn()` to `.check()`. Across the 13 that stay advisory **by
design**, the stated reasons are:

| Blocker                                                        | Count | Example                                              |
| -------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| **Reachability** — the subject cannot be selected              | 4     | "anonymous arrow functions can't be matched by name" |
| **Legitimate exceptions** — the rule is right, the code is too | 3     | 16 valid non-pagination `parseInt` uses              |
| **Debt volume** — needs accept-today/block-new                 | 4     | "~99 — needs large triage"                           |
| **Real design work**                                           | 2     | a genuine circular dependency                        |
| **Severity itself**                                            | **0** | —                                                    |

Nobody's rule is advisory because they wanted a softer signal — they are advisory
because of reachability, exceptions and volume. Read carefully, that is not an
argument against §3; it is the reason §3 cannot ship alone. Raising severity
addresses **none** of these four columns, so on its own it converts a rule nobody
reads into a rule everybody deletes. §1 and §2 attack the volume column, which is
the one this proposal can actually close.

## Proposal

### 1. Ratchet-stable smell identity (the core change)

Findings must be identified by **what** they are, not **where they currently sit**.

Two candidate mechanisms, and this proposal deliberately does not pick one yet:

- **(a) Move coordinates out of `message`.** Keep the human-readable text in the
  rendered output but build it from `file`/`line` fields at format time, leaving
  `message` coordinate-free. Smallest change; relies on every future detector
  remembering the convention.
- **(b) An explicit identity field.** `ArchViolation.identity?: string`, used by
  `hashViolation` when present, falling back to today's triple. A detector states
  its own stable key (for duplicate bodies: the unordered pair of qualified
  names). Slightly larger, but makes the invariant _structural_ rather than a
  convention a future detector can quietly break.

I lean to **(b)** on the grounds that this bug is exactly a convention being broken
silently — but the choice belongs in review.

Either way, the similarity percentage leaves the identity: a pair that drifts from
94% to 92% is the same accepted finding, not a new one.

### 2. A shrink-only ratchet

`withBaseline()` accepts a set and blocks additions. The flip checklist shows what
teams actually need for a 700-finding surface: a count that **may fall, never
rise**, so incidental cleanup is rewarded and regression is blocked without
re-baselining. This is the mechanism the adopting project hand-rolled twice (its
limits catalogue carries an `allowlistBaseline` integer with a shrink-only
assertion) — the same signal that justified the correspondence primitive.

### 3. Fail-grade by default, once (2) makes it survivable

**Draft 1 had this as out of scope. That was wrong.** The correction came from asking
what an agent in CI actually receives for a warning, and measuring it:

- `src/cli/commands/check.ts:62` — the exit code counts **error severity only**, so a
  warn-only run exits **0**.
- Terminal warnings go to **stderr**; GitHub gets a non-blocking `::warning`.

An agent's CI loop terminates on `exit 0`. It does not "ignore" the warning as noise
— it never reaches the text, because the run reported success. So an advisory
discovery surface is not a quieter signal, it is **no signal**.

The evidence for this is in our own code, not the adopting project's.
`src/presets/agent-guardrails.ts:107-118` — the preset written _for the agent
consumer_ — registers the copy-paste detector at `'warn'` while carrying:

```
imperative: 'Do NOT duplicate a function body — extract the shared logic'
```

An instruction addressed to an agent, emitted at a severity that agent cannot
observe. `strictBoundaries` does the same at `src/presets/boundaries.ts:174-176`.

So the severity flip is not a follow-up decision — it is **the point of the
proposal**, and (1) and (2) are the preconditions that stop it being deleted on
arrival. The ordering stands; the scoping does not. Ship them together:

| Phase | Change                                | Why it cannot ship alone                                   |
| ----- | ------------------------------------- | ---------------------------------------------------------- |
| 1     | Stable identity + shrink-only ratchet | Alone: adoption becomes _possible_ but nothing turns it on |
| 2     | Presets and default move to `error`   | Alone: 700 findings red on arrival → the rule gets deleted |

**Blast radius, and why this needs a version decision.** Moving the preset
registrations from `'warn'` to `'error'` turns an existing green build red for
anyone using `agentGuardrails`/`strictBoundaries` with a codebase that has
duplication — which is the point, but it is breaking. It should land with the
ratchet in the same release, with the CHANGELOG telling users to baseline first.

Also per ADR-008: for findings where the remedy is unambiguous (unescaped LIKE
patterns, uncapped pagination, duplicated diverging bodies) the message must carry
the sanctioned fix, not just the observation.

## Out of scope — deliberately

- **The reachability gap** (factory-returned arrows, computed-key assignments —
  two of the four shapes the audit listed; `0066` shipped the other two). Real, and
  it blocks 4 of the 13 advisory rules, but it is a different mechanism in a
  different file. Bundling a verified fix with speculative extras is precisely the
  pattern that cost five review rounds in 0.18.1.
- **New detectors.** This proposal makes the two existing ones usable.

## Migration

Changing violation identity **invalidates existing baseline files** for any project
that has baselined smell findings. One-time, and today that population is
approximately nobody (the surface is unused, which is the whole premise) — but it
must be stated in the CHANGELOG, and the failure mode should be a loud
"baseline entry no longer matches any finding" rather than silent re-reporting.
This is the main thing review should push on.

## Alternatives considered

- **Do nothing; document `.check()` better.** Rejected: the capability is already
  documented and still unused. The measured blocker is the ratchet, and no amount
  of documentation makes a broken hash stable.
- **Exclude smells from baseline entirely, ship them advisory forever.** Honest,
  and it is the status quo — but it concedes the largest unexploited capability in
  the library, and the audit's central finding is that this surface catches what
  177 enforced rules cannot.
- **Hash on `file` + `element` only (drop `message`).** Rejected: it would collapse
  two genuinely different findings about the same function into one, and it changes
  identity for _every_ rule, not just smells. The blast radius is far larger than
  the bug.

## Evidence index

- Hash instability: `hashViolation` at `src/helpers/baseline.ts:52-54`; message
  construction at `src/smells/duplicate-bodies.ts:160`. Reproduced by hashing three
  messages that differ only in line number and percentage.
- `.check()` already available: `SmellBuilder extends TerminalBuilder`
  (`src/smells/smell-builder.ts:13`).
- The ~700-finding measurement and the flip-checklist taxonomy are from the
  external audit named in **Origin**.
