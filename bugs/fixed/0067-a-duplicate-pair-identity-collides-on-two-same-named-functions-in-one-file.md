# Bug 0067: a duplicate-pair identity collides across two same-named functions in one file, and the guard's fixture is the one shape that works

**Reported:** 2026-08-05 · **Fixed:** 2026-08-05, shipped in v0.57.0
**Found in:** an evaluation of `smells.duplicateBodies()` against an external corpus (cmless `main` @
`1481446`, 2,371 TS/TSX files, `minLines(10)`, `withMinSimilarity(0.9)`). Pre-existing — the identity
construction it collides in has not changed in this release.
**Severity:** **High.** One baseline entry silently accepts a second, different finding. Same class as
[0063](./0063-a-dependency-identity-collides-across-files-sharing-a-basename.md),
[0064](./0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md) and
[0065](./0065-reverse-dependency-findings-carry-no-identity.md) — in the family none of those three
touched. Blast radius is the baseline identity string on disk, top row of
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6.

## What happens

`duplicate-bodies.ts:197` builds a pair identity from the two endpoints:

```ts
identity: `duplicate-pair::${[`${fileA}#${nameA}`, `${fileB}#${nameB}`].sort().join('::')}`
```

`<file>#<name>` is not unique **within** a file. Two functions with the same name in one file produce the
same endpoint, so every pair among them collapses to one identity.

Measured on the corpus — **5 colliding identities over 1,573 findings**, 13 findings involved:

| scope                    |  findings | distinct identities | colliding | findings in collisions |
| ------------------------ | --------: | ------------------: | --------: | ---------------------: |
| `apps/api`               |       660 |                 655 |         3 |                      8 |
| `apps/admin-ui:app`      |       124 |                 123 |         1 |                      2 |
| `packages/server-common` |        19 |                  17 |         1 |                      3 |
| **total (19 scopes)**    | **1,573** |           **1,565** |     **5** |                 **13** |

The sharpest instance — `packages/server-common/src/middleware/rate-limit.ts` declares
`errorResponseBuilder` **four** times (`:87`, `:232`, `:286`, `:324`). Three of them are mutually
duplicate, so three _distinct_ pairs exist:

```
errorResponseBuilder (rate-limit.ts:232) is 100% similar to errorResponseBuilder (rate-limit.ts:286)
errorResponseBuilder (rate-limit.ts:232) is 100% similar to errorResponseBuilder (rate-limit.ts:324)
errorResponseBuilder (rate-limit.ts:286) is 100% similar to errorResponseBuilder (rate-limit.ts:324)
```

All three carry **one** identity, and it is degenerate on both sides —
`duplicate-pair::rate-limit.ts#errorResponseBuilder::rate-limit.ts#errorResponseBuilder`. Baseline one and
all three are accepted; add a fifth `errorResponseBuilder` tomorrow and it is pre-accepted too.

Second instance, `apps/api/src/graphql/resolvers/richtext-link-resolvers.ts`: `block` at `:239` and `:255`,
`hyperlink` at `:224` and `:266`, `inline` at `:213` — three names, five functions, three colliding
identities.

## The comment above the construction is wrong in both halves

`duplicate-bodies.ts:189-195` says:

> Limitation: two **anonymous** functions in one file share an endpoint (`<file>#<anonymous>`) and so share
> an identity. … **Measured at 0 collisions over 1006 findings** on a real codebase; the collision guard in
> `tests/integration/baseline-portability.test.ts` is what would catch it becoming common.

- **The cause is narrower than reality.** Every collision measured here is between **named** functions.
  Anonymity is not required — a repeated _name_ is, and `<file>#<name>` cannot distinguish those.
- **The rate is not 0.** 5 over 1,573 here. The two runs are not directly comparable (different corpus
  state, unstated parameters on the original), so this report does **not** claim the original measurement
  was wrong when taken. It claims the number is a hand-maintained value that has since gone stale, which is
  BUGS.md's own pattern: _a count written in prose is a hand-maintained list of one_.

Note `:185` reasons explicitly about this — _"Qualified by path — a bare function name is not unique across
files"_. The path qualifier fixes the **cross-file** case and leaves the **within-file** case, which is the
one that fires.

## Why the existing guard passes

There **is** a guard, it is well built, and it does not see this. `baseline-portability.test.ts:565-594`
covers exactly this shape — _"two object literals that share a key name, which is the shape that actually
collided (measured: 3 findings, 2 identities, before the owning-binding prefix)"_ — and asserts every
element is qualified by its owning binding:

```ts
expect(element, 'object-literal findings must name their owning binding').toMatch(
  /^(routeA|routeB|routeC)\./,
)
```

The fixture `tests/fixtures/smells/same-key-object-literals` binds its literals to **named `const`s**
(`routeA`, `routeB`, `routeC`). That is the one shape the owning-binding prefix can qualify. Real code
routinely writes object literals with **no binding to take a name from**, and then the key name stays bare:

| colliding function               | enclosing construct                                    | binding available |
| -------------------------------- | ------------------------------------------------------ | ----------------- |
| `errorResponseBuilder` `:232`    | `return { … }` inside `getEmailRateLimit()`            | none              |
| `errorResponseBuilder` `:286`    | `return { … }` inside `getSsoRateLimitOptions()`       | none              |
| `errorResponseBuilder` `:324`    | `return { … }` inside `getSsoLookupRateLimitOptions()` | none              |
| `inline` / `block` / `hyperlink` | `entryResolvers[computedKey] = { … }`                  | computed index    |

So the guard is correct on every case it can construct and blind to the case production code produces. This
is BUGS.md's own entry verbatim — **_a guard's SELECTOR decides what it can ever see, and nobody sabotages
a selector_** — and it is the second time that pattern has cost a release (bug 0049 was the first).

**The fixture is the deliverable here, not just the fix.** Add the two unbound shapes — a literal in a
`return`, and a literal assigned through a computed index — or the next fix will pass the same way.

## Why it concentrates in object literals, and why that is not an argument to stop including them

Every collision is an object-literal function. That is not incidental: `duplicate-bodies.ts:101` includes
them **deliberately**, with the reasoning that _"a duplicated arrow under an object key — a resolver, a
route handler, a reducer case — is exactly the copy-paste rot this exists to find"_. That reasoning is
right, and the corpus confirms it — resolver maps and repeated config objects are where the duplication
actually is.

But it is also what makes the collision systematic rather than rare: those are precisely the constructs
that **reuse key names by design**. A resolver map has an `inline` per parent type; a Fastify options
object has an `errorResponseBuilder` per limiter. The deliberate inclusion and the collision are the same
decision seen from two sides. Fix the identity; do not narrow the collection.

## Root cause — one field serves two masters, and the prefix was designed for the other one

Traced to `src/models/arch-function.ts:248`:

```ts
function owningBindingName(objectLiteral: Node): string | undefined {
  const parent = objectLiteral.getParent()
  if (!parent) return undefined
  if (NodeClass.isVariableDeclaration(parent) || NodeClass.isPropertyDeclaration(parent))
    return parent.getName()
  if (NodeClass.isPropertyAssignment(parent)) {
    const nameNode = parent.getNameNode()
    if (NodeClass.isStringLiteral(nameNode)) return nameNode.getLiteralValue()
    if (!NodeClass.isComputedPropertyName(nameNode)) return nameNode.getText()
  }
  return undefined // ← every measured collision lands here
}
```

Its own docstring names the gap, and does so **deliberately**:

> Only the immediate parent is considered: `const routes = {...}` and `class C { routes = {...} }` name the
> literal, whereas a literal passed as a call argument or **returned from a factory genuinely has no
> binding**, and inventing one from a distant ancestor **would be a guess**.

Both measured collisions are exactly the excluded shapes, verified against the corpus:

| site                                           | object literal's parent         | `owningBindingName` |
| ---------------------------------------------- | ------------------------------- | ------------------- |
| `rate-limit.ts` ×3 — `return { … }`            | `ReturnStatement`               | `undefined`         |
| `richtext-link-resolvers.ts` ×5 — `x[k] = {…}` | `BinaryExpression` (assignment) | `undefined`         |

With no owner, `keyPath` stays the bare key (`arch-function.ts:230`), `getName()` returns
`errorResponseBuilder`, and `duplicate-bodies.ts:166` feeds that straight into the identity.

**The real defect is that `getName()` is doing two jobs with one value.** It is the human-readable `element`
in the message _and_ the identity key. `owningBindingName` was written for the first job, and its caution is
correct for it — inventing a semantic name from a distant ancestor genuinely would mislead a reader. But the
second job has a different requirement: identity needs a value that is **unique**, not one that is
_meaningful_. Refusing to guess is the right answer for a label and the wrong answer for a key, and the two
were never separated. The comment directly above the call site (`arch-function.ts:224-227`) shows the
coupling was known — _"duplicate-pair identity is built from these names — accepting one finding silently
accepts the other"_ — so the identity consequence was understood for the **bound** case that was fixed, and
not re-asked for the unbound case that was consciously left.

## Fix

Note first what the measured cases rule out: **no single anchor covers both.**

- The three `rate-limit.ts` literals sit in three _different_ functions (`getEmailRateLimit`,
  `getSsoRateLimitOptions`, `getSsoLookupRateLimitOptions`), so the enclosing function name separates them.
- The five `richtext-link-resolvers.ts` literals sit in **one** function (`generateRichTextLinkResolvers`,
  `:198`), so the enclosing function name separates nothing. What separates them is the assignment target —
  `entryResolvers[…]` for `:213/:224/:239` against `assetResolvers[…]` for `:255/:266`.

So the anchor has to be **the nearest enclosing named construct, whatever kind it is** — a walk up, not a
single-parent test. That is precisely what the current docstring declines to do, and the case for doing it
is the split above: the objection is to guessing a _label_, and this value is a _key_.

The cleanest resolution is therefore not to make `owningBindingName` cleverer but to **stop deriving the
identity from the display name at all** — give `ArchFunction` a separate structural path used only for
identity, and leave `getName()` free to stay conservative and readable. That also retires the
`?? '<anonymous>'` fallback at `duplicate-bodies.ts:166`, which is the same defect with the name missing
entirely rather than repeated.

The endpoint needs something stable that distinguishes two same-named functions in one file. The comment at
`:191` already rejected the obvious candidate for a stated reason — _"a line number would, and that is the
coordinate dependence being removed"_ — and that reasoning still holds: a line number moves when anything
above it is edited.

Candidates, none measured:

- **Widen the owning-binding prefix to unbound literals** — derive a path from the enclosing declaration
  (`getEmailRateLimit.errorResponseBuilder`). Distinguishes all five measured instances, stays free of
  coordinates, and reuses the mechanism that already exists. Fails where two same-named keys sit in one
  literal in one function, which is not legal TypeScript for a plain literal — so it may be total.
- **An ordinal among same-endpoint functions** (`#errorResponseBuilder#2`), in declaration order. Stable
  under edits elsewhere in the file, unstable under reordering the literals themselves — the shape
  [bug 0056](./0056-a-cycle-identity-changes-when-imports-are-reordered.md) is about. Do not ship this
  without reading 0056 first.

Whichever is chosen, it moves identities for the affected findings, so it carries a migration row. Per
0065's sequencing note, do **not** batch it with a fix whose instruction is "do not regenerate".

## Not measured

- Whether `smells.inconsistentSiblings()` shares the defect. Different identity construction; not probed.
- Whether the 5-in-1,573 rate is representative. One corpus, one parameter pair. The rate is **not** the
  claim of this report — the mechanism is, and the mechanism is corpus-independent.
- Whether the anonymous-function case in the original comment ever fires. It was not observed here; the
  named case is strictly wider and subsumes it, so the comment should be rewritten rather than extended.

---

## Fix as shipped — v0.57.0

**Closed by the generic mechanism, not by anything in the Fix section above — and by the candidate that
section cautioned against.** `disambiguateIdentities` (`src/core/violation.ts`) runs in `applyFilters`,
which `SmellBuilder` inherits through `TerminalBuilder`, so `duplicateBodies` was covered without the
detector changing at all. `getName()` still serves as both display label and identity key; what changed is
that a duplicated subject can no longer stand for two findings.

Measured on this report's own shape — three `errorResponseBuilder` arrows in three functions in one file,
`minLines(3)`, `withMinSimilarity(0.9)`:

```
duplicate-pair::/src/rate-limit.ts#errorResponseBuilder      -> 8a83a90c7e2fa31c
duplicate-pair::/src/rate-limit.ts#errorResponseBuilder#1    -> 5d59a297cd852325
duplicate-pair::/src/rate-limit.ts#errorResponseBuilder#2    -> 27138d76cebbcc57
```

Three findings, three hashes, the first byte-identical to what a 0.56.0 baseline recorded. **Zero
migration.**

### The caution in the Fix section above was right to be there, and does not fire

That section evaluated "an ordinal among same-endpoint functions" and said: _"unstable under reordering
the literals themselves — the shape bug 0056 is about. Do not ship this without reading 0056 first."_ The
shipped mechanism **is** a positional ordinal, so the caution applies to it directly.

Measured, because a prediction is not a result: the three functions were reordered (first and last
swapped) and the identity **set is unchanged** — same three hashes, in a different list order. Baseline
matching is set membership, so a reorder produces no new reds. It is stable because reordering does not
change the multiset of subjects: the same three pairs exist, carrying the same one subject, so the same
three suffixes are handed out.

What the caution does reach is the **equal-count swap** — delete one duplicate and add a different one,
and the new finding arrives pre-accepted under the entry the deleted one held. That is 0064/0065's
residual verbatim, is strictly better than the pre-0.57.0 behaviour, and is tracked in
[plan 0094](../../plans/0094-the-residual-findings-from-the-v0-56-0-review.md) rather than here.

### The proposed remedy is withdrawn, and that is the important part of this record

The Fix section proposes giving `ArchFunction` a structural identity path separate from `getName()`.
**Do not build it on the strength of this bug.** It would move identities for every affected finding — the
report says so itself — and therefore cost a migration to fix a defect that no longer loses coverage. The
argument for a structural identity is now the _residual_ above, which is a different and weaker case, and
it belongs with plan 0094's `binding`/qualified-name work where it can be judged against the other
families.

### Still owed from this report

The fixture gap is **not** closed: `tests/integration/baseline-portability.test.ts` still constructs only
object literals bound to named `const`s, the one shape `owningBindingName` can qualify. The two unbound
shapes this report names — a literal in a `return`, a literal via computed index — are still unrepresented,
so the guard's selector still cannot see the production code this bug was found in.
