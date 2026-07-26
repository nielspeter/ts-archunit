// The case that always worked: an unresolvable specifier falls back to the raw
// string. Kept so the fix cannot regress it — and so nobody "fixes" the tests
// by only covering this one, which is what would have hidden bug 0014.
// @ts-expect-error -- deliberately not installed; the point is that it does not resolve
import { thing } from 'no-such-package-xyz'

export const value: unknown = thing
