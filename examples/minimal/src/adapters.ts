import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import { ConfigurationClientInMemory } from '@entifix/core';
import { Book } from '@entifix/example-minimal-domain';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
} from '@entifix/rest';
import { Context } from 'effect';

/**
 * Where each entity's REST resource is, as static configuration: `book` is
 * served at `/api/book` on this origin, which `app/api/book` proxies to the
 * service. r10c resolves the same keys from a configuration service; nothing
 * that reads them can tell the difference.
 */
const configuration = new ConfigurationClientInMemory({
  restUri: [{ key: 'book', value: '/api/book' }],
});

const REST: BuildEntityRestOptions = { uriConfig: { key: '[entity]' } };

const ADAPTERS = {
  books: Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(Book, REST),
    load: buildEntityRestAdapterLoad(Book, REST),
    save: buildEntityRestAdapterSave(Book, REST),
    delete: buildEntityRestAdapterDelete(Book, REST),
  }),
  configuration: Context.make(ConfigurationRepositoryTag, configuration),
};

export type ExampleAdapters = typeof ADAPTERS;

/** The hook `makeEntityCrud` asks for. Stable identity, no provider needed. */
export const useExampleAdapters = (): ExampleAdapters => ADAPTERS;
