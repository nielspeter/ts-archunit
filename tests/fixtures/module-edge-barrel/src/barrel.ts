// The three re-export shapes item 7 must tell apart, plus one local export so
// the name-set assertion has something to subtract.
export { MARKER } from './named-src.js'
export { INNER as OUTWARD } from './named-src.js'
export * from './star-src.js'
export const LOCAL = 'local'
