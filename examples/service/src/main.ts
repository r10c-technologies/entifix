import { makeService } from '@entifix/service-shell/runtime';

import { makeAppLayer, SERVICE_NAME } from './app-layer.ts';
import { orders, stockItems } from './routes.ts';
import { readSettings } from './settings.ts';

const settings = readSettings(process.env);

makeService({
  name: SERVICE_NAME,
  port: settings.port,
  slices: ['orders'],
  endpoints: [stockItems, orders],
  appLayer: makeAppLayer(settings),
});
