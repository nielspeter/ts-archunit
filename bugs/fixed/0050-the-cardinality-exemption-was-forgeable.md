# Bug 0050: the empty-selection gate could be switched off in one line, through public API

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.46.1)
**Found in:** every version since the cardinality exemption shipped (v0.23.0), by an architecture
review of plan 0081 — which had just closed the _identical_ hole in a different symbol, while citing
this one in a docstring as the safe precedent.
**Severity:** **High.** Not because anyone did it, but because of what it switches off: the
empty-selection gate is the check this library is named around, and the exemption from it was
readable off a public export and copyable onto any condition.

## What

`ASSERTS_CARDINALITY` was a module-private `unique symbol`, keyed onto a condition to declare "an
empty selection satisfies me" — the legitimate case being `notExist()`, where a selector matching
nothing _is_ the rule passing.

The reasoning for the symbol is recorded in `cardinality.ts` and was explicit: a plain boolean
property would be "a one-line silent opt-out on any user condition", so a symbol was chosen because
a consumer cannot import it to name the key.

**They never needed to import it.** Four shipped conditions carry it as an own property, and
`notExist` is publicly exported:

```ts
const stolen = Object.getOwnPropertySymbols(notExist())[0]
const mine = { description: 'x', evaluate: () => [], [stolen]: true }
```

Measured, on a selector matching nothing:

| Condition                          | Configuration findings            |
| ---------------------------------- | --------------------------------- |
| An honest one that asserts nothing | **1** — the gate fires, correctly |
| The forgery above                  | **0** — silence                   |

One line, through documented exports, to exempt any rule from the gate. Precisely the `.allowEmpty()`
hazard the symbol was chosen to prevent, wearing the disguise the choice was meant to remove.

## The lesson, which is worth more than the fix

**"Module-private" describes the binding, not the value.** A symbol keyed onto a public object is
_unlisted_, not _unreachable_ — `Object.getOwnPropertySymbols` is not an exotic escape hatch, it is
the reflection API. The privacy argument was about the import graph and the threat was about the
object graph.

Two further things this exposed, both about how the mistake survived:

- **The guard that existed was narrower than its name.** `dead-selector-fails.test.ts` asserted that
  `defineCondition(...)` emits no own symbols — true, and it covers _user-built_ conditions only.
  Nothing asserted the property of the **shipped** ones, which is where the key was readable. A test
  named for a claim it half-checks is the shape [bug 0048](./0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md)
  already cost us.
- **The bad reasoning propagated before it was caught.** Plan 0081 copied this mechanism _by
  analogy_, shipped the same hole in v0.46.0, and its new module's docstring cited this one as the
  stronger precedent. So the review that broke 0081's symbol had to be pointed at this one
  deliberately; the copy was found first and the original was found only because someone asked
  whether the justification was true. **A precedent's safety can live outside the code you are
  copying** — here, in a constructor that only covers half the population.

## Fix as shipped

Membership of a module-level `WeakSet`, in both places (`cardinality.ts` and
`owns-empty-discovery.ts`). Not a property, so there is nothing to read off an object, copy, or
forge — a caller would need the module's binding, and it is not exported. `WeakSet` rather than
`Set` so a condition is not retained after its rule is discarded.

Registration is in **return position** — `return marksAssertsCardinality({ … })` — so the mark
cannot be separated from the object it marks by a later edit.

The optional symbol property is gone from the `Condition` interface. That costs the type-level trace
of the mechanism, which is a real loss: a reader of the interface no longer sees it. Accepted,
because the alternative is a property that can be set, and this seam is one where being unsettable
matters more than being discoverable.

## Sabotage

| Revert                                                                        | Result          |
| ----------------------------------------------------------------------------- | --------------- |
| Restore the symbol design (own property + `in` check)                         | CAUGHT — 2 rows |
| An honest condition on an empty selection (control: the gate must still fire) | CAUGHT          |
| `notExist()` unregistered (control: the exemption must still work)            | CAUGHT          |
| Baseline asserted green before each, restored after                           | 0               |

The two controls matter as much as the forgery row: without the first, "the forgery is gated" passes
when the gate stops firing at all; without the second, it passes when the exemption stops working and
every `notExist()` rule starts failing.

## Related

- [Plan 0081](../../plans/completed/0081-a-condition-declares-discovery-ownership.md) — copied the
  mechanism, shipped the same hole, and is how this one was found.
- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 3 — an escape hatch must be stated;
  the corollary is that an escape hatch nobody stated, reachable by reflection, is worse than one
  that is documented.
