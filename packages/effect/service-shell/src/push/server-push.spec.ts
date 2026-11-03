import { describeServerPushContract } from '@entifix/testing-unit/contracts';

import { makeServerPush } from './server-push.js';

describeServerPushContract('makeServerPush', makeServerPush);
