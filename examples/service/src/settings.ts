/**
 * Everything the service reads from its environment, with local defaults that
 * match `examples/compose.yaml`.
 *
 * Static on purpose: entifix needs no configuration service. r10c resolves these
 * from one at boot, and nothing below `main.ts` would change if this did too.
 */
export interface ServiceSettings {
  readonly port: number;
  readonly mongoUri: string;
  readonly mongoDb: string;
  readonly amqpUri: string;
  /** Optional: with none set, logs go to stdout and nothing is exported. */
  readonly otelEndpoint?: string;
  /** The simulated payment provider refuses any charge above this. */
  readonly chargeLimit: number;
}

export const readSettings = (
  env: Record<string, string | undefined>,
): ServiceSettings => ({
  port: Number(env['PORT'] ?? 3300),
  mongoUri:
    env['MONGO_URI'] ?? 'mongodb://localhost:27017/?directConnection=true',
  mongoDb: env['MONGO_DB'] ?? 'example_service',
  amqpUri: env['AMQP_URI'] ?? 'amqp://guest:guest@localhost:5672',
  otelEndpoint: env['OTEL_EXPORTER_OTLP_ENDPOINT'],
  chargeLimit: Number(env['CHARGE_LIMIT'] ?? 1000),
});
