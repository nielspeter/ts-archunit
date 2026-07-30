// A BARE dynamic import. `node:path` is a builtin with no @types installed here,
// so the compiler does not resolve it — `resolvedPath: undefined` — and the only
// candidate is the specifier as written. Plan 0071 item 17.
//
// NOT `import('picomatch')`: that is a direct dependency WITH types installed, so
// it resolves to node_modules/@types/picomatch/index.d.ts and carries two
// candidates. Draft 3 used it as the unresolved example and it was the worst
// possible choice.
export const load = (): Promise<unknown> => import('node:path')
