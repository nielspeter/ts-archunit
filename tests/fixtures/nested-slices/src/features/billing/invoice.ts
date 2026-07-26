// A NESTED slice layout — features/<slice>/<file>. The documented shape, and
// the one `tests/fixtures/modules` does not have: its `src/domain/` is flat,
// so `matching('src/domain/*')` happened to match the relative file path and
// hid the fact that `matching()` rewrites its glob before matching.
export const invoice = 'invoice'
