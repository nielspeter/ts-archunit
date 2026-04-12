/** Module consumed only via dynamic import — should not be flagged as dead. */
export function lazyHelper(): string {
  return 'loaded lazily'
}
