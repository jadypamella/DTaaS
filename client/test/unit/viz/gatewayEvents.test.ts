import type { SignalSample } from '@into-cps-association/dtaas-sdk';
import eventHandler, { type StreamTarget } from 'viz/gatewayEvents';
import { clearDeliveryTimings, deliveryTimings } from 'viz/deliveryTimings';

function targetCollecting(samples: SignalSample[]): StreamTarget {
  const sinks = new Set([(sample: SignalSample) => samples.push(sample)]);
  return {
    sinksOf: () => sinks,
    setState: jest.fn(),
    refuse: jest.fn(),
    channel: 'measured',
  };
}

const sampleEvent = (data: Record<string, unknown>) => ({
  event: 'sample',
  data: JSON.stringify(data),
});

describe('the events of a gateway stream', () => {
  beforeEach(() => clearDeliveryTimings());
  afterEach(() => jest.useRealTimers());

  it('names the twin the gateway sends with a sample', () => {
    const samples: SignalSample[] = [];
    eventHandler(targetCollecting(samples))(
      sampleEvent({
        path: 'alice/pump/flow',
        twin: 'pump',
        channel: 'measured',
        receivedAt: 1000,
        payload: '{"value": 3, "ts": 900}',
      }),
    );

    expect(samples).toEqual([
      expect.objectContaining({ twinId: 'pump', ts: 900, value: 3 }),
    ]);
  });

  it('keeps when each sample was measured, received and read', () => {
    jest.useFakeTimers({ now: 1500 });
    eventHandler(targetCollecting([]))(
      sampleEvent({
        path: 'alice/pump/flow',
        receivedAt: 1000,
        payload: '{"value": 3, "ts": 900}',
      }),
    );
    eventHandler(targetCollecting([]))(
      sampleEvent({ path: 'alice/pump/flow', payload: 'unreadable' }),
    );

    expect(deliveryTimings()).toEqual([
      { path: 'alice/pump/flow', ts: 900, receivedAt: 1000, arrivedAt: 1500 },
    ]);
  });
});
