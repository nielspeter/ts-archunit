// @ts-ignore
export const one = 1
// @ts-ignore
export const two = 2
// @ts-ignore
export const three = 3

export function outer(): number {
  // @ts-ignore
  const inner = 4
  // @ts-ignore
  return inner
}

// @ts-ignore stacked-first
// @ts-ignore stacked-second
export const stacked = 5

/* @ts-ignore block */
export const block = 6

/** @ts-ignore jsdoc, on the opening line
 * and a second line, so the finding must name the opening one
 */
export const jsdoc = 7

export const trailing = 8 // @ts-ignore

/* @ts-ignore multi-line, on the opening line
   a second line
   a third, so getEnd() would name line 31 instead of 29
*/
export const multiline = 9
