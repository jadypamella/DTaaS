import type { z } from 'zod';
import { isPlainTopic } from '../broker/routing-key.js';
import fillTemplate from '../config/template.js';
import {
  declarationSchema,
  type influxSchema,
  type mqttSchema,
  type Transport,
} from './contract.schema.js';
import type { Channel, InfluxSource, SignalTarget } from './policy.js';

// The gateway streams from RabbitMQ and reads history from InfluxDB. The
// other transports of the contract are valid, and served by the client.
const SERVED_ADAPTERS: ReadonlySet<string> = new Set(['mqtt', 'influx']);

export type TwinContext = {
  owner: string;
  twin: string;
  vhost: string;
  orgTemplate: string;
  bucketTemplate: string;
  maxPathLength: number;
  defaultChannel: Channel;
  warn: (message: string) => void;
  log: (message: string) => void;
};

function influxOf(transports: Transport[], context: TwinContext) {
  const declared = transports.find(
    (transport): transport is z.infer<typeof influxSchema> =>
      transport.adapter === 'influx',
  );
  if (declared === undefined) return undefined;
  const org = fillTemplate(context.orgTemplate, context.owner);
  const bucket = fillTemplate(context.bucketTemplate, context.owner);
  // A twin may only name its owner's own org and bucket. Anything else would
  // let a twin file read another user's history with the gateway's token.
  if (declared.org !== org || declared.bucket !== bucket) {
    context.warn(
      `Ignored the influx transport of ${context.owner}/${context.twin}: org or bucket is not the owner's`,
    );
    return undefined;
  }
  const source: InfluxSource = { org, bucket };
  if (declared.measurement !== undefined)
    source.measurement = declared.measurement;
  return source;
}

function targetsOf(
  transport: z.infer<typeof mqttSchema>,
  context: TwinContext,
  influx: InfluxSource | undefined,
): SignalTarget[] {
  return transport.topics
    .filter((topic) => isPlainTopic(topic, context.maxPathLength))
    .map((path) => ({
      path,
      owner: context.owner,
      twin: context.twin,
      channel: transport.channel ?? context.defaultChannel,
      vhost: context.vhost,
      ...(influx === undefined ? {} : { influx }),
    }));
}

function logUnserved(transports: Transport[], context: TwinContext): void {
  const unserved = transports
    .map((transport) => transport.adapter)
    .filter((adapter) => !SERVED_ADAPTERS.has(adapter));
  if (unserved.length === 0) return;
  context.log(
    `Not streaming the ${[...new Set(unserved)].join(', ')} transports of ${context.owner}/${context.twin}: the gateway serves mqtt and influx`,
  );
}

/**
 * The signals one committed visualisation.json declares. A file the contract
 * rejects declares nothing, as the client refuses to draw it.
 */
export function signalsOfVisualisation(
  raw: unknown,
  context: TwinContext,
): SignalTarget[] {
  const file = declarationSchema.safeParse(raw);
  if (!file.success) {
    const issue = file.error.issues[0];
    context.warn(
      `Skipped ${context.owner}/${context.twin}: visualisation.json is not valid at ${issue.path.join('.')}: ${issue.message}`,
    );
    return [];
  }
  const { transports } = file.data;
  logUnserved(transports, context);
  const influx = influxOf(transports, context);
  return transports.flatMap((transport) =>
    transport.adapter === 'mqtt' ? targetsOf(transport, context, influx) : [],
  );
}
