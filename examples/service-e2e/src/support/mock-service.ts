import {
  makeDomainLayer,
  readSettings,
  router,
  SERVICE_NAME,
} from '@entifix/example-service';
import { serveTestService } from '@entifix/service-shell';
import { fakeAmqpLayer, fakeMongoLayer } from '@entifix/testing-e2e/fixtures';
import type { FakeMongoDb } from '@entifix/testing-unit/drivers';
import { Layer } from 'effect';

/** The fake store behind the running mock, for a journey to read what it wrote. */
export let mongo: FakeMongoDb | undefined;

/**
 * The real routes and the real domain layer — saga, outbox, consumer, resume
 * sweep — over the Mongo and AMQP drivers' fakes. What is absent is the
 * infrastructure, not the service.
 *
 * ⚠️ The fake bus records what is published and delivers nothing by itself, so
 * under this profile the consumer never runs; a journey asserts the outbox
 * entry the order's own transaction wrote instead.
 */
export const startMockService = async () => {
  const database = fakeMongoLayer();
  mongo = database.driver;
  return serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['orders'],
    router,
    appLayer: Layer.provideMerge(
      makeDomainLayer({ ...readSettings({}), chargeLimit: 1000 }),
      Layer.mergeAll(database.layer, fakeAmqpLayer().layer),
    ),
  });
};
