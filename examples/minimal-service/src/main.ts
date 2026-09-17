import { makeService } from '@entifix/service-shell';

import { makeAppLayer, SERVICE_NAME } from './app-layer.ts';
import { router } from './routes.ts';
import { readSettings } from './settings.ts';

const settings = readSettings(process.env);

makeService({
  name: SERVICE_NAME,
  port: settings.port,
  slices: ['library'],
  router,
  appLayer: makeAppLayer(settings),
});
