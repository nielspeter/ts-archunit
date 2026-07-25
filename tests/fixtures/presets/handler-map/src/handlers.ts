// The same three defects, once in a named function and once in a handler map.
// Agents generate the second shape constantly; the presets could not see it.

export function namedHandler(input: string): string {
  // TODO: implement properly
  throw new Error('not done')
}

export const routes = {
  objectHandler: (input: string): string => {
    // TODO: implement properly
    throw new Error('not done')
  },
  emptyHandler: () => {},
}
