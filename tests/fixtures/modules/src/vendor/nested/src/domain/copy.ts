// A SECOND `src/domain`, deliberately nested.
//
// Without it, "relative" and "anywhere" select the same set on this fixture, so
// the uniformity guard cannot tell a root-relative implementation from the
// looser rewrite `matching()` uses — and the bug 0033 fix could have shipped
// with the wrong mechanism and stayed green.
export const nestedCopy = 1
