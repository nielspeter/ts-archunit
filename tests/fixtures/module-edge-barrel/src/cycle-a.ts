// A circular re-export pair. This is why the star residual is a SUBSET check and
// not equality: cycle-b's runtime keys include A_OWN, which cycle-a re-exported
// INTO it, so equality fails on a correct implementation.
export const A_OWN = 'a'
export * from './cycle-b.js'
