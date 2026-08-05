# Bug 0066: a smell detector over zero source files passes, unless the rule happens to declare a glob

**Reported:** 2026-08-05 · **Fixed:** not yet
**Found in:** an evaluation of `smells.duplicateBodies()` against an external corpus (cmless `main` @
`1481446`, 2,371 TS/TSX files). Not found by reading the code — found because two of the corpus's apps
reported clean and should not have.
**Severity:** **High.** Blast radius is published API: both `agentGuardrails({ noCopyPaste: true })` and
`strictBoundaries({ noCopyPaste: true })` construct the detector in exactly the configuration that fails
open. Top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

## What happens

`smells.duplicateBodies(p).check()` on a project that loaded **zero source files** passes.

Measured, on `apps/admin-ui/tsconfig.json` of the corpus — a solution-style tsconfig (`"files": []` with
`"references"`), which ts-morph loads as an empty program:

| configuration                           | `.check()` |
| --------------------------------------- | ---------- |
| bare `.check()`                         | **PASSED** |
| `.ignoreTests().check()`                | **PASSED** |
| `.ignorePaths('**/archive/**').check()` | THREW      |
| `.inFolder('**/src/**').check()`        | THREW      |

Control, same run, `packages/sdk/tsconfig.json` (65 files): bare `.check()` **THREW** with 32 findings, so
the probe can see a throw. Reproductions: `probe-empty-project.mjs`, `probe-check-throws.mjs` (attached to
this report's working directory; both are ~20 lines against the published 0.56.0 package).

The guard **exists** and its message is excellent — it names the project-references case explicitly and
states it cannot be suppressed:

```
The project loaded 0 source files (…/apps/admin-ui/tsconfig.json), so no glob can match. Check that
this tsconfig includes your sources — and if it delegates to project references ("files": [] with
"references"), it loads none of them itself, so the rules need the tsconfig that holds your sources
rather than this one. This finding cannot be suppressed: …
```

The defect is **when it fires**. It is gated on a user-declared glob — "so no glob can match" is the
diagnosis of a _dead glob_, and where the rule declares none there is nothing to declare dead. Note
`.ignoreTests()` does **not** arm it: it applies `TEST_PATTERNS` internally (`duplicate-bodies.ts:19`),
and internal patterns are not declarations.

## Why this is the presets' configuration, not an exotic one

Both shipped `noCopyPaste` rules declare no glob:

| preset             | construction                                       | source                                |
| ------------------ | -------------------------------------------------- | ------------------------------------- |
| `agentGuardrails`  | `smells.duplicateBodies(p).withMinSimilarity(0.9)` | `src/presets/agent-guardrails.ts:136` |
| `strictBoundaries` | `smells.duplicateBodies(p)`                        | `src/presets/boundaries.ts:281`       |

So the failing-open configuration is not a user mistake to be documented against — it is what the library
hands out. A user who runs `agentGuardrails` against a solution-style tsconfig gets
`preset/agent/no-copy-paste` reporting clean.

**Corrected after review — this paragraph used to continue "and every other rule in that preset reports
clean too, for the same reason", and that is false.** Three reviewers measured it independently against a
zero-file solution-style project:

| construction                                                                                       | result                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `agentGuardrails(p, { src, noInlineLogic, noGenericErrors, noStubs, noEmptyBodies, noCopyPaste })` | **6 of 7 rules THREW**; only `no-copy-paste` passed |
| `strictBoundaries(p, { folders, shared, isolateTests, noCopyPaste })`                              | 2 of 3 threw                                        |
| `recommended(p)`                                                                                   | **4 of 4 threw**                                    |

`src` is required on `AgentGuardrailsOptions` and every non-smell rule uses it as a glob, which arms the
dead-glob gate. So the documented preset path goes **loudly red**, with the correct message naming the
tsconfig — a preset user does not get a silent green.

The bug is still real and still High, but the argument moves: the genuinely silent configurations are a
rule file containing **only** smell detectors (which `docs/smell-detection.md` shows verbatim), and
`agentGuardrails(p, { src, noCopyPaste: true })` with nothing else enabled. The corpus evaluation that
found this used the direct API, which is the silent path. Severity rests on `smells.*` as published API
failing open unconditionally — not on the preset claim.

## What it cost on the measured corpus

Two of the corpus's five apps use solution-style tsconfigs. Pointed at `<dir>/tsconfig.json` they reported
**0 files, 0 findings**. Following the references to the tsconfigs that hold the sources:

| scope                          | files | bodies | findings |
| ------------------------------ | ----: | -----: | -------: |
| `apps/admin-ui:app`            |   357 |    496 |      124 |
| `apps/identity-gateway-ui:app` |   192 |    249 |      288 |

**401 findings reported as clean.** The two apps are 23% of the corpus's TypeScript.

## Why the smell family and not the rule family

The `.that()/.should()` grammar reaches the empty-selection guard shipped in 0.34.0 — a rule that selects
nothing is a configuration finding that no terminal can downgrade. Smell detectors deliberately **do not
use that grammar** (`docs/smell-detection.md:18` — _"Smell detectors do not use the `.that().should()` chain
grammar"_), so they never reach it. They have their own API, and it acquired only the glob-shaped half of
the guard.

This is the ADR-008 question asked of the detector rather than of the code it scans: **what would this
report if the thing it guards were completely broken?** A corpus of zero files is the maximally broken
case, and the answer is "no duplicates found".

## Root cause — the empty-project check lives inside the dead-glob gate, behind its precondition

Traced. `src/core/terminal-builder.ts`, `deadSelectorFindings()`:

```ts
509  if (this.assertsCardinality()) return empty
510  const trees = this.globs()
511  if (trees.length === 0) return empty        // ← returns here
…
527  if (loadedNothing(project))                 // ← never reached
528    return { selector: [this.emptyProjectViolation(project)], discovery: [] }
```

The empty-project diagnosis is **sixteen lines below an early return that fires whenever the rule declares
no glob**. Nothing about "this project loaded zero files" depends on a glob — but the check that reports it
is nested inside a function whose job is _"which of these globs is dead?"_, and that function correctly
bails when there are no globs to adjudicate.

The second half is `SmellBuilder.globs()` (`src/smells/smell-builder.ts:78`), which builds trees from
`_folders` (`inFolder`) and `_ignorePaths` **only**. `ignoreTests()` applies `TEST_PATTERNS` inside
`duplicate-bodies.ts` and contributes no tree, which is why it does not arm the gate — matching the measured
table above exactly.

So the full path for a bare detector is: `globs()` → `[]` → line 511 returns → `loadedNothing()` is never
evaluated → no configuration finding → `.check()` passes.

**This is bug 0048's fix inheriting its host's precondition.** The comment at `:513-527` credits
[0048](./fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md), which fixed the
_attribution_ — the gate used to blame a correct glob for an empty project and print "Correct the glob, or
remove the rule". That fix was right, and it was placed where the wrong blame was being assigned: inside the
glob gate. The fault it diagnoses, however, is **not a glob fault**, so siting it there silently scoped it
to rules that declare a glob. The framing gives it away — the comment reasons about _"none of them is at
fault"_, a question about globs, rather than _"this scan was vacuous"_, a question about the run.

Note the ordering matters for the fix: line 509's `assertsCardinality()` return is **correct** and must stay
ahead of any empty-project check — `.should().notExist()` over an empty project is that rule being
satisfied, not a fault. Only line 511 is in the wrong place relative to line 527.

## What the fix has to decide

The empty-project condition is knowable without any glob — `project.getSourceFiles().length === 0` is
available at `detect()` time. The open question is scope:

- **Narrow:** arm the existing configuration finding whenever the project is empty, regardless of glob
  declaration. Closes this bug. Leaves the neighbouring case open — a detector whose `inFolder()` matches a
  non-empty project but selects zero _functions_ (every body under `minLines`) is equally vacuous and
  equally green.
- **Wider, and the one this report recommends:** a smell detector that examined **zero subjects** is a
  configuration finding, whatever the reason — empty project, dead glob, or a `minLines` that excluded
  everything. That is the same rule the `.that()/.should()` family already lives under, and it removes the
  need to enumerate the ways a scan can end up empty.

The wider form has a false-positive to answer for that the rule family does not: a genuinely small package
with no function over `minLines(5)` is legitimately empty and would newly fail. `.expectEmpty()` is the
existing answer for exactly that intent, and it is an assertion that expires rather than a silencer — but
it lives on `TerminalBuilder` and its interaction with `SmellBuilder` is **not measured here**. Settle that
before choosing the wider form.

## Not measured

- Whether `smells.inconsistentSiblings()` fails open the same way. It has the same base class and the same
  no-grammar shape, so it is **expected** to, but it was not probed. Do not fix one without measuring the
  other — `SmellBuilder` is the shared seam.
- Whether `.expectEmpty()` is reachable on a smell builder at all.
- Whether the CLI's `check` command surfaces the empty project by some other path than the rule. The
  measurement above is the programmatic API only.
