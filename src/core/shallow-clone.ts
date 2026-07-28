/**
 * A same-prototype shallow copy of a builder.
 *
 * The one place in the codebase that reaches for `Object.create` /
 * `Object.getPrototypeOf`, which are the JS-interop boundary ADR-005's
 * `eslint-disable` carve-out exists for. Every copy-on-write builder goes
 * through here so that carve-out is written once and reviewed once.
 *
 * Shallow is deliberate. It gives the clone its own *slots*, which is what
 * makes `next._x = ...` safe; a field holding a mutable container still needs
 * the owning class to replace it, which is what the `copy()` overrides do.
 * A deep clone would instead copy ts-morph `Project` graphs — the opposite of
 * cheap, and it would break identity comparisons on `SourceFile`.
 *
 * Class fields declared with a constructor parameter property (`private
 * readonly project`) are ordinary instance properties at runtime, so they come
 * across too: a clone is built against the same project, without re-loading it.
 */
export function shallowClone<T extends object>(source: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Object.getPrototypeOf returns `any`
  const proto: object = Object.getPrototypeOf(source)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Object.create returns `any`
  const clone: T = Object.create(proto)
  Object.assign(clone, source)
  return clone
}
