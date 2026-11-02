import { makeService } from '@entifix/service-shell/runtime';

import { makeAppLayer, SERVICE_NAME } from './app-layer.ts';
import { books } from './routes.ts';
import { readSettings } from './settings.ts';

const settings = readSettings(process.env);

makeService({
  name: SERVICE_NAME,
  port: settings.port,
  slices: ['library'],
  endpoints: [books],
  appLayer: makeAppLayer(settings),
});
