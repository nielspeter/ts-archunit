# Bug 0017: `strictBoundaries()`'s no-cross-boundary message overclaims entry-point enforcement

**Reported:** 2026-07-28
**Found in:** all versions through v0.19.0
**Severity:** Medium — the rule itself is not broken; it correctly enforces folder-level
boundary isolation. The defect is that its `because`/`suggestion`/`imperative` text
describes a **stronger** guarantee (entry-point-only access) than the condition actually
checks, which will send anyone who reads the violation message to fix it the wrong way.

## Description

`strictBoundaries()`'s `no-cross-boundary` rule (`src/presets/boundaries.ts:164-188`)
restricts cross-boundary imports to files matching the boundary's own folder glob:

```ts
// --- No cross-boundary imports ---
// Each boundary folder: modules in it can only import from itself + shared
for (const dir of boundaryFolders) {
  const boundaryPattern = `${dir}/**`
  const allowedGlobs = [boundaryPattern, ...sharedGlobs]

  builders.push(
    ...collectRule(
      modules(p)
        .that()
        .resideInFolder(boundaryPattern)
        .should()
        .onlyImportFrom(...allowedGlobs),
      {
        id: 'preset/boundaries/no-cross-boundary',
        because:
          'a direct import across boundaries bypasses the public surface each boundary is supposed to be reached through',
        suggestion:
          "Import from the other boundary's entry point instead of reaching into its internals, or move the shared piece into the shared module.",
        imperative: "Do NOT import another boundary's internals — go through its entry point",
      },
      'error',
      overrides,
    ),
  )
}
```

`onlyImportFrom(boundaryPattern, ...shared)` where `boundaryPattern = ${dir}/**` allows
importing **any file** under the boundary folder — there is no check for which specific
file inside the boundary was imported. But the `because`, `suggestion`, and `imperative`
strings all describe entry-point-only access: "the public surface... supposed to be
reached through," "go through the other boundary's entry point," "reaching into its
internals." Read in isolation (which is the point — these strings are written for an
agent to act on without reading the source), the message tells you this rule enforces
something it does not.

## Reproduction

Fixture: `src/features/billing/{index.ts, internal.ts}`,
`src/features/reporting/consumer.ts`, boundary glob `**/src/features/*`.

```
reporting/consumer.ts imports billing/internal.ts directly  ->  0 violations (passes)
reporting/consumer.ts imports billing/index.ts               ->  0 violations (passes)
```

Both pass identically. The rule has no way to distinguish "imported through the
boundary's declared entry point" from "reached directly into an internal file" — the
`because`/`suggestion` text implies the first case is required and the second is what
gets flagged, but neither is true; only crossing the `boundaryPattern` folder itself is
checked.

## Why no test caught it

`tests/` exercises `no-cross-boundary` by asserting a violation fires when a file
outside `boundaryPattern` is imported, and no violation fires when a file inside it is —
both correct for what the code does. No fixture imports two *different* files from
within the same target boundary (one being a plausible "entry point," one not) to check
whether the rule's behavior differs between them. It doesn't, so a test built to probe
that would show the message describing a distinction the implementation never makes.

## Suggested fix

Two independent, non-blocking pieces:

1. **Correct the message now.** Rewrite `because`/`suggestion`/`imperative` to describe
   what `no-cross-boundary` actually enforces — folder-level isolation, not entry-point
   privacy:
   - `because`: "a direct import across boundaries couples the importing boundary to another boundary's internal file layout, not just its behavior"
   - `suggestion`: "Import from within the allowed boundary or shared module — if this needs to reach a specific internal file of another boundary, that boundary's structure is probably leaking and should be reconsidered."
   - `imperative`: "Do NOT import a file outside this boundary or its shared modules"

   This is a one-line-per-field text change, no behavior change, safe to ship
   independently of anything else.

2. **Separately (tracked as proposal 020, Part 1, currently logged/not drafted for
   build):** if entry-point-only privacy — the guarantee the current message
   incorrectly claims — turns out to be wanted, it needs a new preset built on
   `onlyBeImportedVia()` (`src/conditions/reverse-dependency.ts:152-184`), not a change
   to `no-cross-boundary`. That preset is not justified by this bug; this bug only shows
   the message is wrong, not that the stronger feature is needed. See proposal 020 for
   why that's being held pending real demand rather than built on the strength of this
   finding alone.

## Guard this needs

- A fixture where a "would-be entry point" file is committed alongside a plainly
  internal file in the same boundary — assert the rule's behavior (pass/fail) is
  identical for both, pinning down that this is folder-level, not file-level, so a
  future change doesn't silently narrow behavior without updating the message again.
- If the message is corrected per the suggested fix, an acceptance check that the new
  text doesn't repeat the entry-point claim.
