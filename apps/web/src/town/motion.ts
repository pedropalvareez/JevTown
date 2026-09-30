import type { Snapshot } from '../../../api/src/simulation/types';

export class MotionBuffer {
  private frames: Snapshot[] = [];
  private clockOffset = 0;
  private delay = 600;

  reset(snapshot: Snapshot, tickMs: number, receivedAt = performance.now()) {
    this.frames = [snapshot];
    this.clockOffset = receivedAt - snapshot.serverTime;
    this.delay = tickMs + 100;
  }

  push(snapshot: Snapshot) {
    const last = this.frames.at(-1);
    if (!last || snapshot.tick <= last.tick) return;
    this.frames.push(snapshot);
    if (this.frames.length > 8) this.frames.shift();
  }

  sample(now = performance.now()) {
    if (!this.frames.length) return null;
    const renderTime = now - this.clockOffset - this.delay;
    while (this.frames.length > 2 && this.frames[1].serverTime <= renderTime) this.frames.shift();
    const from = this.frames[0];
    const to = this.frames[1] ?? from;
    const duration = to.serverTime - from.serverTime;
    const alpha = to.tick - from.tick === 1 && duration > 0
      ? Math.max(0, Math.min(1, (renderTime - from.serverTime) / duration))
      : Number(renderTime >= to.serverTime);
    return { from, to, alpha };
  }
}
