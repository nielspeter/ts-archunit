# Bug 0047: a fileless finding renders a meaningless location

**Reported:** 2026-08-01 · **Found in:** v0.36.3, by the customer review of the 0041/0042 branch
**Severity:** Low, and filed only because the affected path is the agent's. Deliberately deferred
from the v0.37.0 release as cosmetic; recorded here rather than dropped.

## Description

Configuration findings carry no source location — they report that a _rule_ enforces nothing, not
that a line of code is wrong — so they set `file: ''` with `line: 0` or `line: 1`. The rich
terminal formatter handles this correctly and omits the location entirely.

The other two renderers do not:

- `formatViolationsPlain` emits a trailing `(:1)` — or `(:0)` — with no filename.
- `--format json` emits `"file": "", "line": 1`.

A human skims past `(:1)`. An agent parsing the JSON gets a location that looks real, is not, and
may be used to open a file or anchor an edit.

## Scope

Pre-existing and shared by every `bypassFilters` producer — there are twelve. Not introduced or
widened by any recent change; the v0.37.0 review simply noticed it.

## Fix

Two candidate shapes, and the choice matters more than the code:

1. **Omit the fields.** `file: null, line: null` in JSON, no `(:1)` in plain. Cleanest to read,
   but it changes a documented payload shape, and a consumer indexing on `file` gets `null` where
   it previously got `''`.
2. **Keep them and add a discriminator.** The JSON already distinguishes these findings — a
   `configuration: true` flag, or reuse of the existing `bypassFilters` semantics — so a consumer
   can be told to ignore the location rather than having it removed.

(2) is likely right: `--format json` is the agent contract, and additive beats breaking. Settle it
before writing code.

## Guard

- a configuration finding rendered plain contains no `(:` fragment;
- the same finding in JSON is distinguishable from a real one without inspecting `file`;
- **control**: an ordinary violation still renders its real `file:line` in both formats;
- vacuity: the fixture actually produces one of each.

## Related

- [Plan 0078](../plans/0078-derive-the-configuration-finding-census.md) — the census over the
  twelve producers; this is a rendering property of the same population, and the census is the
  natural place to assert it uniformly.
