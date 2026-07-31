# `does-not-load`

A **solution-style** tsconfig: `"files": []` plus `"references"`. TypeScript
loads no sources from it — the shape `honojs/hono` has at its root, which is
how bug 0031 was found.

This is a real fixture rather than an in-memory double on purpose. The double
gets its emptiness from `useInMemoryFileSystem`, so it would keep passing if
`project()` ever learned to follow `references` and the branch stopped being
reachable. Here, emptiness is a property of the config being loaded.

`pkg/tsconfig.json` is the referenced project that **does** load
`pkg/src/handler.ts`. It exists so the remedy the message states — point the
rules at the tsconfig that holds your sources — can be applied in a test and
shown to clear the finding, rather than only asserted in a commit message
(ADR-008 rule 2).
