// TWO star edges in one file, so swapping their resolved targets is a
// constructible sabotage. Set equality is symmetric under a swap and a star has
// no names to key on, so no runtime comparison can see it — the path-join
// derivation in module-edges-corpus.test.ts is what catches it.
export * from './star-src.js'
export * from './star-src-2.js'
