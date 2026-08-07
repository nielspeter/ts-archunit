# spikes/

Throwaway measurement scripts kept **only** so that a number quoted in a plan can
be re-derived by someone other than its author.

They are not shipped code, not covered by `tsconfig.json`, and not part of the
test suite. They are here because plan 0069's standing rule is "no count appears
in it that was not derived on the stated date" — and a count nobody else can
reproduce satisfies the letter of that rule while defeating its purpose.

| Script                          | Reproduces                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `0069-glob-census.mjs`          | Plan 0069's Problem table — dead globs in a rule file                                         |
| `0069-gate-walk.mjs`            | Plan 0069's gate runs — TypeScript on disk vs in a project                                    |
| `0069-tree-model-check.mjs`     | Plan 0069's glob-tree evaluator — soundness over all small trees                              |
| `0066-empty-project-passes.mjs` | Bug 0066's `.check()` table — which configurations pass over a project that loaded zero files |

Run from the repository root:

```bash
node spikes/0069-glob-census.mjs tests/archunit/arch-rules.test.ts
node spikes/0069-gate-walk.mjs /path/to/other-repo/tsconfig.json
node spikes/0069-tree-model-check.mjs
node spikes/0066-empty-project-passes.mjs   # self-contained; writes its own fixture
```

A spike leaves when the thing it reproduces closes. Two were retired the day bug
0068 shipped: one reproduced a collision that `tests/integration/baseline-portability.test.ts`
now asserts can never need repairing, and one reproduced 0068 itself, which has a
test file and a ten-row sabotage matrix of its own. Keeping either would have meant
carrying a script whose printed conclusion nobody re-reads — and the 0068 one had
already gone stale, still printing "the element and identity name its enclosing
function" above output showing they no longer do.

The model check is here for a different reason than the other two. Three
consecutive drafts of the evaluator returned a false verdict, each caught by a
reviewer on a shape the author had not tried. Prose review does not converge on
a six-line algorithm; exhaustive enumeration does, in one run.
