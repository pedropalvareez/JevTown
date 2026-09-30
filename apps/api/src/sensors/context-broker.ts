import type { SensorBatch } from './iot-agent.js';

export class MockContextBroker {
  private latest: SensorBatch;

  constructor(initial: SensorBatch) {
    this.latest = structuredClone(initial);
  }

  publish(batch: SensorBatch) {
    if (batch.tick > this.latest.tick) this.latest = structuredClone(batch);
  }

  snapshot(): SensorBatch {
    return structuredClone(this.latest);
  }
}
