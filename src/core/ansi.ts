const enabled =
  typeof process !== 'undefined' && !process.env['NO_COLOR'] && process.stdout?.isTTY === true

function wrap(code: number, resetCode: number): (text: string) => string {
  if (!enabled) return (text) => text
  return (text) => `\x1b[${String(code)}m${text}\x1b[${String(resetCode)}m`
}

export const bold = wrap(1, 22)
export const dim = wrap(2, 22)
export const red = wrap(31, 39)
export const yellow = wrap(33, 39)
export const cyan = wrap(36, 39)
export const gray = wrap(90, 39)
