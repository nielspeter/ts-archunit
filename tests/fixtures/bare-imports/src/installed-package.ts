// The case bug 0014 was about: a bare specifier for a package that is really
// installed and really has types, so the import RESOLVES. Before the fix the
// glob was compared only against the resolved path
// (`.../node_modules/@types/picomatch/index.d.ts`) and a bare name could never
// match it — so `notImportFrom('picomatch')` reported nothing.
//
// picomatch is chosen deliberately: it is a runtime dependency of this project
// and ships no types of its own, so it resolves into `@types/`, which is the
// shape that makes the resolved path least like the specifier.
import picomatch from 'picomatch'

export const isMatch = picomatch('**/*.ts')
