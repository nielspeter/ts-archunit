import { watch, type FileChangeInfo } from 'node:fs/promises'
import path from 'node:path'
import { ArchRuleError } from '../core/errors.js'

export interface WatchOptions {
  /** Directories to watch for changes */
  watchDirs: string[]
  /** Additional files to watch (e.g., rule files) */
  watchFiles: string[]
  /** Callback to run on detected changes */
  onChangeDetected: () => Promise<void>
  /** Debounce window in ms. Default: 250 */
  debounceMs?: number
}

const TS_FILE_RE = /\.[cm]?tsx?$/

/**
 * Watch for file changes and re-run the callback.
 *
 * Uses Node.js `fs.watch` with `recursive: true` (Node 24+).
 * Debounces rapid filesystem events. If a change arrives while
 * a run is in progress, it is queued and executed after the
 * current run completes.
 *
 * Known limitation: each re-run uses `importFresh` which creates
 * a new ESM module cache entry. Over long sessions, memory grows.
 * Restart the watcher periodically for long sessions.
 */
export function watchAndRerun(options: WatchOptions): void {
  const { watchDirs, watchFiles, onChangeDetected, debounceMs = 250 } = options
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let pendingRerun = false

  const executeRun = (trigger: string): void => {
    running = true
    pendingRerun = false
    process.stdout.write('\x1B[2J\x1B[H') // clear screen, preserve scrollback
    process.stdout.write(`Change detected: ${trigger}\n\n`)
    onChangeDetected()
      .catch((err: unknown) => {
        // Rule failures are expected — swallow ArchRuleError, print others
        if (!(err instanceof ArchRuleError)) {
          if (err instanceof Error) {
            console.error(err.message)
          }
        }
      })
      .finally(() => {
        running = false
        if (pendingRerun) {
          executeRun('(queued change)')
        } else {
          process.stdout.write('\nWatching for changes...\n')
        }
      })
  }

  const scheduleRun = (trigger: string): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (running) {
        pendingRerun = true
        return
      }
      executeRun(trigger)
    }, debounceMs)
  }

  const watchers: Array<AsyncIterable<FileChangeInfo<string>>> = []

  // Watch directories recursively
  for (const dir of watchDirs) {
    const resolved = path.resolve(dir)
    const watcher = watch(resolved, { recursive: true })
    watchers.push(watcher)
    void (async () => {
      try {
        for await (const event of watcher) {
          if (event.filename && TS_FILE_RE.test(event.filename)) {
            scheduleRun(event.filename)
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== 'The operation was aborted') {
          console.error(`Watcher error on ${dir}: ${err.message}`)
        }
      }
    })()
  }

  // Watch individual rule files
  for (const file of watchFiles) {
    const resolved = path.resolve(file)
    const watcher = watch(resolved)
    watchers.push(watcher)
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must consume async iterator
        for await (const _event of watcher) {
          scheduleRun(path.basename(file))
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== 'The operation was aborted') {
          console.error(`Watcher error on ${file}: ${err.message}`)
        }
      }
    })()
  }

  // Graceful shutdown — close all watchers on SIGINT
  process.on('SIGINT', () => {
    for (const w of watchers) {
      if ('return' in w && typeof w.return === 'function') {
        void (w.return as () => Promise<unknown>)()
      }
    }
    process.exit(0)
  })
}

/**
 * Import a module with cache-busting for watch mode.
 *
 * Node ESM has no cache eviction API. Each call creates a new
 * module entry via a unique query string. Over long sessions
 * this leaks memory — see watchAndRerun JSDoc.
 */
export async function importFresh(filePath: string): Promise<unknown> {
  const resolved = path.resolve(filePath)
  const url = `file://${resolved}?t=${Date.now()}`
  return import(url)
}
