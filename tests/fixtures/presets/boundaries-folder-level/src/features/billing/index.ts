// The boundary's public surface. Importing THIS from another boundary must fail
// identically to importing internal.ts — the rule is folder-level, and bug 0017
// is that its remedy claimed otherwise.
import { secret } from './internal.js'
export const publicSurface = secret
