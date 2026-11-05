import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  signalsOfVisualisation,
  type TwinContext,
} from 'src/authz/visualisation';
import { PUMP, visualisationOf } from 'test/helpers/twins';

// The example the SDK tests its own schema with, so a change to the contract
// that the gateway's copy misses fails here.
const SDK_EXAMPLE = path.resolve(
  '../../client/sdk/tests/fixtures/junction7.visualisation.json',
);

function contextFor(warnings: string[] = [], logs: string[] = []): TwinContext {
  return {
    owner: 'alice',
    twin: 'pump',
    vhost: 'alice',
    orgTemplate: '{owner}',
    bucketTemplate: '{owner}',
    maxPathLength: 64,
    defaultChannel: 'measured',
    warn: (message) => warnings.push(message),
    log: (message) => logs.push(message),
  };
}

function withTransports(transports: unknown[]) {
  return { schemaVersion: '1.0', transports };
}

describe('signalsOfVisualisation', () => {
  it('lists each MQTT topic with its owner, vhost and history', () => {
    const targets = signalsOfVisualisation(PUMP, contextFor());
    expect(targets).toEqual([
      {
        path: 'alice/pump/flow',
        owner: 'alice',
        twin: 'pump',
        channel: 'measured',
        vhost: 'alice',
        influx: { org: 'alice', bucket: 'alice', measurement: 'pump' },
      },
      expect.objectContaining({ path: 'alice/pump/pressure' }),
    ]);
  });

  it('keeps the channel the transport names', () => {
    const [target] = signalsOfVisualisation(
      visualisationOf(['a/b'], undefined, 'simulated'),
      contextFor(),
    );
    expect(target.channel).toBe('simulated');
    expect(target.influx).toBeUndefined();
  });

  it("ignores an InfluxDB source that is not the owner's, and says so", () => {
    const warnings: string[] = [];
    const file = visualisationOf(['a/b'], { org: 'bob', bucket: 'bob' });
    const [target] = signalsOfVisualisation(file, contextFor(warnings));
    expect(target.influx).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('drops wildcard and over-long topics', () => {
    const file = visualisationOf([
      'a/+/c',
      'a/#',
      'a/*',
      'x'.repeat(65),
      'ok/topic',
    ]);
    expect(
      signalsOfVisualisation(file, contextFor()).map((t) => t.path),
    ).toEqual(['ok/topic']);
  });

  it('reads nothing from a file of another shape, and says why', () => {
    const warnings: string[] = [];
    const context = contextFor(warnings);
    expect(signalsOfVisualisation('not an object', context)).toEqual([]);
    expect(
      signalsOfVisualisation(withTransports([{ adapter: 'stomp' }]), context),
    ).toEqual([]);
    expect(signalsOfVisualisation({}, context)).toEqual([]);
    expect(
      signalsOfVisualisation({ transports: PUMP.transports }, context),
    ).toEqual([]);
    expect(warnings).toHaveLength(4);
    expect(warnings[1]).toMatch(/not valid at transports\.0/);
  });

  it('refuses an MQTT transport the contract rejects', () => {
    const noUrl = { adapter: 'mqtt', topics: ['a/b'] };
    const withPassword = {
      adapter: 'mqtt',
      url: 'mqtt://user:secret@broker:1883',
      topics: ['a/b'],
    };
    const warnings: string[] = [];
    expect(
      signalsOfVisualisation(withTransports([noUrl]), contextFor(warnings)),
    ).toEqual([]);
    expect(
      signalsOfVisualisation(
        withTransports([withPassword]),
        contextFor(warnings),
      ),
    ).toEqual([]);
    expect(warnings[1]).toMatch(/user name or password/);
    expect(warnings.join('\n')).not.toContain('secret');
  });

  it('accepts the other transports of the contract and logs that it skips them', () => {
    const logs: string[] = [];
    const file = withTransports([
      { adapter: 'mqtt', url: 'wss://broker/ws', topics: ['a/b'] },
      { adapter: 'stomp', url: 'wss://broker/ws', destinations: ['/q'] },
      { adapter: 'http', url: 'https://api.example/x' },
      { adapter: 'file', url: 'lib://data/x.csv' },
    ]);
    const targets = signalsOfVisualisation(file, contextFor([], logs));
    expect(targets.map((t) => t.path)).toEqual(['a/b']);
    expect(logs).toEqual([
      'Not streaming the stomp, http, file transports of alice/pump: the gateway serves mqtt and influx',
    ]);
  });

  it('gives a topic without a channel the configured default', () => {
    const context = { ...contextFor(), defaultChannel: 'simulated' as const };
    const [target] = signalsOfVisualisation(visualisationOf(['a/b']), context);
    expect(target.channel).toBe('simulated');
  });

  it("accepts the SDK's own example declaration", () => {
    const warnings: string[] = [];
    const raw: unknown = JSON.parse(readFileSync(SDK_EXAMPLE, 'utf8'));
    signalsOfVisualisation(raw, contextFor(warnings));
    expect(warnings.join('\n')).not.toMatch(/not valid/);
  });
});
