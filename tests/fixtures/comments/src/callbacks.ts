export const items = [1, 2, 3]

export function run(): number[] {
  return items.map((n) => {
    // @ts-ignore inside-callback
    return n * 2
  })
}
