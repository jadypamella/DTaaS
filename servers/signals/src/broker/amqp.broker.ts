import type { OnModuleDestroy } from '@nestjs/common';
import amqp, { type ChannelModel } from 'amqplib';
import Config from '../config/config.service.js';
import { readSecretFile } from '../config/secrets.js';
import type {
  BrokerListener,
  BrokerSubscription,
  SignalBroker,
} from './broker.js';
import VhostLink, {
  type Connector,
  type LinkNames,
  LinkClosedError,
} from './vhost-link.js';

const HEARTBEAT_SECONDS = 30;

/** The port in the URL, or the configured one of its scheme. */
function portOf(url: URL, tls: boolean, config: Config): number {
  if (url.port !== '') return Number(url.port);
  return config.get(tls ? 'rabbitmq-tls-port' : 'rabbitmq-port');
}

// Node verifies the broker's certificate by default. Saying so here keeps it
// from being switched off by an environment default.
function socketOf(url: URL, tls: boolean): object {
  return tls ? { servername: url.hostname, rejectUnauthorized: true } : {};
}

/** Connect to one vhost as the read-only service user. */
export function amqpConnector(config: Config): Connector {
  return async (vhost: string): Promise<ChannelModel> => {
    const url = new URL(config.get('rabbitmq-url'));
    const tls = url.protocol === 'amqps:';
    const password = await readSecretFile(
      config.get('rabbitmq-password-file'),
      'rabbitmq-password-file',
    );
    const options = {
      protocol: tls ? 'amqps' : 'amqp',
      hostname: url.hostname,
      port: portOf(url, tls, config),
      username: config.get('rabbitmq-user'),
      password,
      vhost,
      heartbeat: HEARTBEAT_SECONDS,
    };
    return amqp.connect(options, socketOf(url, tls));
  };
}

/**
 * Live signals from RabbitMQ, one connection per virtual host. Built by a
 * factory in the module, so a test can pass its own connector.
 */
export default class AmqpBroker implements SignalBroker, OnModuleDestroy {
  private readonly links = new Map<string, VhostLink>();
  private readonly connect: Connector;
  private readonly names: LinkNames;

  constructor(config: Config, connector?: Connector) {
    this.connect = connector ?? amqpConnector(config);
    this.names = {
      exchange: config.get('rabbitmq-exchange'),
      queuePrefix: config.get('rabbitmq-queue-prefix'),
    };
  }

  async subscribe(
    vhost: string,
    routingKeys: readonly string[],
    listener: BrokerListener,
  ): Promise<BrokerSubscription> {
    const link = await this.addTo(vhost, routingKeys, listener);
    return { close: () => link.remove(routingKeys, listener) };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.links.values()].map((link) => link.close()));
  }

  // A link closes when its last listener leaves. A subscribe that raced with
  // that close tries once more on a fresh link.
  private async addTo(
    vhost: string,
    keys: readonly string[],
    listener: BrokerListener,
  ): Promise<VhostLink> {
    try {
      const link = this.linkFor(vhost);
      await link.add(keys, listener);
      return link;
    } catch (error) {
      if (!(error instanceof LinkClosedError)) throw error;
      const link = this.linkFor(vhost);
      await link.add(keys, listener);
      return link;
    }
  }

  private linkFor(vhost: string): VhostLink {
    const existing = this.links.get(vhost);
    if (existing !== undefined) return existing;
    const link: VhostLink = new VhostLink(
      vhost,
      this.connect,
      () => {
        if (this.links.get(vhost) === link) this.links.delete(vhost);
      },
      this.names,
    );
    this.links.set(vhost, link);
    return link;
  }
}
