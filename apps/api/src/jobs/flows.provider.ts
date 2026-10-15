import { FlowProducer } from 'bullmq';

export const DISCOVERY_FLOWS = Symbol('DISCOVERY_FLOWS');

/** One FlowProducer for discovery runs (fan-out to sources, fan-in in `process-run`). */
export const flowsProvider = {
  provide: DISCOVERY_FLOWS,
  useFactory: () => new FlowProducer({ connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6380' } }),
};
