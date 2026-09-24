/** Cooperative pause: only a provider-owned checkpoint can acknowledge that work has stopped.
 * Never pause the event reader or abort a model request to implement this control. */
export class PauseGate {
  constructor(emit) {
    this.emit = emit;
    this.state = null;
    this.waiters = new Set();
    this.closed = false;
  }
  enable() {
    if (!this.closed && this.state === null) this.publish('running');
  }
  publish(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'pause', state });
  }
  request() {
    if (this.closed || this.state === null) throw new Error('Pause is unavailable for this turn');
    if (this.state === 'running') this.publish('pausing');
  }
  resume() {
    if (this.closed || this.state === null) throw new Error('Pause is unavailable for this turn');
    this.publish('running');
    for (const wake of this.waiters) wake();
  }
  async checkpoint(signal) {
    if (this.closed || signal?.aborted) throw new Error('Pause checkpoint was cancelled');
    while (this.state === 'pausing' || this.state === 'paused') {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          this.waiters.delete(wake);
          signal?.removeEventListener('abort', abort);
        };
        const wake = (error) => {
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const abort = () => wake(new Error('Pause checkpoint was cancelled'));
        this.waiters.add(wake);
        signal?.addEventListener('abort', abort, { once: true });
        this.publish('paused');
      });
    }
    if (this.closed || signal?.aborted) throw new Error('Pause checkpoint was cancelled');
  }
  close() {
    this.closed = true;
    for (const wake of this.waiters) wake(new Error('The turn has ended'));
  }
}
