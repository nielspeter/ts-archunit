# Bug 0038: a typo in a preset override key is a silent false green

**Reported:** 2026-08-01 · **Verified:** 2026-08-01, independently reproduced in review
**Found in:** v0.36.3, by the ADR-008 compliance audit
**Severity:** High — on blast radius, not frequency. A configured escalation that silently
does not apply, on a **published** preset API, with the suite reporting coverage it does not
have. The frequency case is weak on its own: the author must escalate one of the five
warn-default rules _and_ misspell the key.

## Description

`validateOverrides` (`src/presets/shared.ts:84`) checks each key of a preset's `overrides` map
against that preset's known rule IDs. On a miss it writes one line to stderr and returns
`void`. It produces **no finding**, so nothing fails.

The lookup that then ignores the unmatched key is implemented **three times** — this matters
for the fix, and the first draft of this bug got it wrong by inventing a single `applyOverride`
that does not exist:

| Site                                           | Used by                               |
| ---------------------------------------------- | ------------------------------------- |
| `collectRule` — `src/presets/shared.ts:43`     | `boundaries`, `layered`, `data-layer` |
| inlined — `src/presets/recommended.ts:104`     | `recommended`                         |
| inlined — `src/presets/agent-guardrails.ts:59` | `agentGuardrails`                     |

All three are `overrides?.[meta.id] ?? defaultSeverity`. A key that matches no rule ID is never
read, so the rule keeps the preset default.

## The direction that is silent is not the one you would guess

The first draft claimed a typo when turning a rule **off** is safe because the rule stays on
and reds. That is false for any rule whose default is already `warn`:

| Author intent                             | Typo'd outcome             | Signal   |
| ----------------------------------------- | -------------------------- | -------- |
| Escalate `warn` → `error`                 | stays `warn`, build passes | **None** |
| Turn **off** a rule defaulting to `warn`  | stays `warn`, build passes | **None** |
| Turn **off** a rule defaulting to `error` | stays `error`, build reds  | Visible  |

Five rules ship with a `warn` default: `preset/recommended/no-silent-catch`
(`recommended.ts:67`), `no-empty-bodies` (`:77`), `preset/boundaries/no-duplicate-bodies`
(`boundaries.ts:280`), `preset/layered/type-imports-only` (`layered.ts:60`),
`preset/agent/no-copy-paste` (`agent-guardrails.ts:128`).

So the safe direction is not a property of the mechanism — it is a coincidence of which
default the rule happens to carry.

Scope, stated precisely because the first draft over-claimed: **all five presets** fail to
produce a finding, but only **four** can produce the headline severity false green.
`dataLayerIsolation`'s two rules both default to `'error'` (`data-layer.ts:53`, `:76`), so it
has no escalation to lose.

## Reproduction

In-memory ts-morph project with one silent catch, filtered to
`preset/recommended/no-silent-catch`. Note the invocation: there is **no `default` option** —
`RecommendedOptions` (`recommended.ts:13`) adds only `include` to `PresetBaseOptions`. The
`warn` below is the rule's shipped default, not something the caller set.

```ts
recommended(project, { overrides })
```

```
correct  'preset/recommended/no-silent-catch': 'error'  → {"n":1,"sevs":["error"]}  build fails
typo     'preset/recommended/no-silent-cach' : 'error'  → {"n":1,"sevs":["warn"]}   build passes
typo     'preset/recommended/no-silent-cach' : 'off'    → {"n":1,"sevs":["warn"]}   build passes
correct  'preset/recommended/no-silent-catch': 'off'    → {"n":0,"sevs":[]}
no overrides at all                                     → {"n":1,"sevs":["warn"]}
```

Counts are equal and non-zero across the first three rows, so the comparison is not vacuous —
the difference is purely the severity, which is the whole of the fault.

## The warning is delivered. That is not the problem

Do not reach for [bug 0024](./fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md)
here — the first draft did, and it is stale. 0024 was fixed in v0.26.0, and its fix **is**
`writeStderr` (`src/core/stderr.ts`), the function `validateOverrides` calls at
`shared.ts:92`. The line prints, from a passing test, on the real channel.

The rule 1 argument does not need it: **a printed warning never reaches the exit code**, and
the agent that wrote the typo is not reading stderr on a green run. Printed is not actionable.

## Why the suite believes this is covered

Two tests reach the unknown-key path. Both are `process.stderr.write` spies; neither reads a
severity or an exit code, and no integration or CLI test passes an override at all.

- `tests/presets/shared.test.ts:39` — unit-level, synthetic rule IDs.
- `tests/presets/recommended.test.ts:117` — **named `'warns on an unrecognized override id
(typo guard)'`**, calls the real preset with a real typo, and asserts only
  `expect(warnSpy).toHaveBeenCalled()`.

The second is the more dangerous one, because it self-describes as the guard for exactly this
fault. It is [ADR-008](../adr/008-agent-first-failure-surfaces.md)'s Context table verbatim: a
spy proves the call, never the consequence.

## Fix

Make it a configuration finding. `assertDiscovered` (`shared.ts:55`) already builds the right
shape for the adjacent fault of a preset discovering nothing — `severity: 'error'` (`:70`),
`bypassFilters: true` (`:71`), its own `suggestion` (`:69`), never the author's. Verified that
the flag carries: `execute-rule.ts:288` and `:329` make a configuration finding throw even out
of `.warn()`.

Three things to settle:

1. **`validateOverrides` returns `void`** and is called for side effects at the top of each
   preset factory (`recommended.ts:100`, `boundaries.ts:113`, `layered.ts:131`,
   `data-layer.ts:32`, `agent-guardrails.ts:51`). It must return rules, or the callers must
   collect from it.
2. **Keep the available-IDs list** in the remedy. The current stderr text already has it, and
   it is the one part of today's behaviour that is right.
3. Per rule 3 the finding must state that it cannot be suppressed — see
   [plan 0078](../plans/0078-derive-the-configuration-finding-census.md).

### Option zero, and it should be tried first

`overrides` is `Record<string, RuleSeverity>` (`presets/shared.ts:75`). In a TypeScript-first
library the cheapest fix is a **type**: make the key a union of that preset's rule IDs. The typo
becomes a red squiggle in the editor, before any run, at zero CI cost — and it deletes the
case-variant sabotage row outright, because a case variant stops compiling too.

Additive to the runtime finding, not a substitute: a JS consumer, a dynamically-built overrides
object, and `--format json` pipelines all bypass the type. But it catches the overwhelming
majority at the point of authorship, which is where ADR-008 would rather catch things.

### The runtime fix must not break the published signature

The first draft specified changing `validateOverrides` from `void` to returning rules. It is
re-exported at `src/presets/index.ts:2` and documented at `docs/api-reference.md:672`, so that
is a break — for a fault this bug concedes is low-frequency. All five callers are internal
preset factories. **Add a sibling that returns findings** and leave `validateOverrides` alone;
the user-visible outcome is identical at zero break, and rule 6 says guard the guard, not break
the API.

### Budget the upgrade shock

The runtime fix turns currently-green builds **red** for anyone carrying a typo today. Coming
in the same release as 0041 — which turns red builds green — that is two opposite surprises at
once. Ship them apart, or write one combined note.

**The original breaking framing, kept for the record:**
`validateOverrides` is re-exported at `src/presets/index.ts:2` and documented at
`docs/api-reference.md:672` with the `void` signature; `docs/presets.md:231` documents the
current behaviour as _"Unrecognized override keys emit a warning — catches typos."_ Under
ADR-008 rule 6 that puts this in the **published API** row: guard the guard, not the floor.

## Guard

**The behavioural derivation, not a spy: the severity the preset actually produces**, for the
correct key and the typo'd key, on a fixture that yields a finding either way.

Vacuity guard — and note the first draft got this backwards. It proposed asserting both
spellings return an _equal_ non-zero count, which is the **pre-fix** state; after the fix the
typo case returns the rule finding **plus** the new configuration finding. State it as:

- correct key → ≥1 rule finding, run exits 0;
- typo'd key → the run **fails**, and a configuration finding naming the unknown key is present.

**The CLI path is a second observation point, not a second derivation.** `check.ts:145` is
`filtered.filter((v) => (v.severity ?? 'error') === 'error').length` — the exit code is
computed _from_ `v.severity`, one line, same object. If the severity is wrong both agree, and
selling that as independence is what rule 5 forbids. Keep the CLI run — it buys real coverage
of `applyFilters`, baseline/diff and `dedupe-config-findings` — and say plainly that the
severity derivation itself has no independent check.

Sabotage rows, corrected — three of the first draft's four were not caught by the guard as
described:

| Revert                                     | Caught by                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Delete the finding, keep the warning       | the base guard                                                                                        |
| Emit from `recommended` only, not all five | **only if the guard iterates all five presets** — do that                                             |
| `bypassFilters: false`                     | **only with an `.excluding()` or baseline in place** — add it                                         |
| Case-variant key (`…/No-Silent-Catch`)     | needs its own row; `no-silent-cach` is a truncation, so a case-insensitive match would not resolve it |

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1 — actionable findings fail;
  rule 6 — this is published API.
- [Bug 0018](./fixed/0018-data-layer-preset-silently-enforces-nothing-for-a-file-glob.md) — the
  other "a preset silently enforces nothing" fault, fixed by `assertDiscovered`.
- [Plan 0078](../plans/0078-derive-the-configuration-finding-census.md) — the census guards
  producers that exist; it **cannot** find a missing one, so it will not catch this. Fix this
  first, then let the census pick up the new site.
