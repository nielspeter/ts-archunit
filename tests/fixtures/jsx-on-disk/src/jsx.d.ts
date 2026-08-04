// Minimal JSX typing so a `.tsx` file compiles without pulling in @types/react.
// Bug 0051: the point of this fixture is that a `.tsx` file exists ON DISK and is
// discovered through a real tsconfig — not to test React.
declare namespace JSX {
  type Element = unknown
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>
  }
  interface ElementChildrenAttribute {
    children: unknown
  }
}
