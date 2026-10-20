import { ConfigurationClient } from '@entifix/core';
import { Context } from 'effect';

export class ConfigurationRepositoryTag extends Context.Service<
  ConfigurationRepositoryTag,
  ConfigurationClient
>()('ConfigurationRepositoryTag') {}
