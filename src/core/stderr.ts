/**
 * The library's single stderr channel.
 *
 * [Bug 0024](../../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md):
 * every library-originated message went through `console.warn`, and vitest's
 * default reporter **intercepts** console output and replays it only for
 * **failing** tests. `.warn()` never fails a test, so its output was always
 * dropped. Measured on a real child `vitest run` with the default reporter: a
 * passing test whose rule has 4 real violations printed **nothing** — zero
 * occurrences of the violation text.
 *
 * That silence was not confined to `.warn()`. The stale-exclusion warning, the
 * unused-exclusion warning, the exclusion-comment parse warnings, the
 * invalid-baseline warning, the diff-aware fallback warning and `expression()`'s
 * escape-hatch warning were all invisible in a passing test — five files' worth.
 * A finding nobody reads has not been reported (ADR-008 rule 1).
 *
 * **The EPIPE guard is not optional, and it is why this is a function rather
 * than a bare write.** Node's `Console` is constructed with `ignoreErrors: true`
 * and swallows write errors; `process.stderr.write` does not. With a closed
 * downstream pipe — `ts-archunit check 2>&1 | head` — the error arrives
 * **asynchronously**, so neither `try`/`catch` nor the write callback can see
 * it, and the process dies with an uncaught EPIPE. Measured over 20 000 lines:
 *
 *     bare process.stderr.write            node exits 1
 *     with an 'error' listener attached    node exits 0
 *     console.warn                         node exits 0
 *
 * `writeReport` already wrote to `process.stderr` unguarded, so that exit-1 was
 * a live defect before this existed: a piped `check` could fail for EPIPE rather
 * than for findings, and the two are indistinguishable from the exit code.
 *
 * A persistent listener rather than `once`: `once` removes itself after the
 * first error, leaving a second EPIPE uncaught, and re-adding per write leaks
 * listeners. One listener, attached lazily, never removed — the same trade
 * `ignoreErrors: true` makes, and the reason it is documented here rather than
 * hidden.
 *
 * **The accepted cost:** vitest annotates intercepted console output with the
 * test that produced it (`stderr | file > test name`), and a direct write loses
 * that. For a violation report the rule's own identity is in the message, so the
 * loss is real but small — and being attributed to a test that never printed is
 * worse than being unattributed.
 */
let listenerAttached = false

/**
 * Write one message to stderr so it survives a test runner.
 *
 * A trailing newline is added when absent, because the call sites this replaced
 * used `console.warn`, which appends one — omitting it at ten call sites is a
 * mistake waiting to happen, and a message run onto the next is the defect this
 * channel exists to avoid.
 */
export function writeStderr(message: string): void {
  if (!listenerAttached) {
    // See the module docstring: the EPIPE is asynchronous, so this listener is
    // the only thing that can catch it.
    process.stderr.on('error', () => {})
    listenerAttached = true
  }
  process.stderr.write(message.endsWith('\n') ? message : `${message}\n`)
}

/**
 * Reset the lazily-attached listener. **Tests only** — a suite that asserts on
 * the attachment needs to observe it happening rather than inherit it from
 * whichever earlier test wrote first.
 */
export function resetStderrGuardForTests(): void {
  process.stderr.removeAllListeners('error')
  listenerAttached = false
}
