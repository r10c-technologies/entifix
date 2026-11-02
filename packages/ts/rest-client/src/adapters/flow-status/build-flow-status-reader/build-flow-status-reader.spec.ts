import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildFlowStatusReader } from './build-flow-status-reader.js';

const HREF = 'http://service/api/flow/f-1';

const server = setupEntifixServer();

const read = () => Effect.runPromise(buildFlowStatusReader()(HREF));

describe('buildFlowStatusReader', () => {
  it('reads where a flow stands, and why it failed', async () => {
    const data = {
      flowId: 'f-1',
      state: 'failed',
      failure: { code: 'paymentDeclined', category: 'declined' },
    };
    server.use(
      http.get(HREF, () =>
        HttpResponse.json({ meta: { type: 'flowStatus' }, data }),
      ),
    );

    expect(await read()).toEqual(data);
  });

  it('answers undefined for a flow the status read does not hold yet', async () => {
    server.use(http.get(HREF, () => new HttpResponse(null, { status: 404 })));

    expect(await read()).toBeUndefined();
  });

  it('keeps any other failure a failure', async () => {
    server.use(
      http.get(HREF, () =>
        HttpResponse.json({ meta: { type: 'entity' }, data: {} }),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(buildFlowStatusReader()(HREF)),
    );
    expect(failure).toMatchObject({ _tag: 'ProtocolFailure' });
  });
});
