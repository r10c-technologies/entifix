import {
  accessor,
  describeEntityUseCases,
  Entity,
  entity,
  EntityId,
  extractMetaEntity,
  extractMetaUseCaseBinding,
  useCase,
} from '../../index.js';

@entity({ domain: 'catalog', key: 'article' })
class Article implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@entity({ domain: 'catalog', key: 'shelf' })
class Shelf implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

/** Never decorated, so it has no metadata of its own to append to. */
class Undeclared implements Entity {
  id: EntityId;
}

@useCase({
  entity: Article,
  key: 'publish',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:article.useCases.publish',
})
class PublishArticleUC {}

@useCase({
  entity: Article,
  key: 'archive',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:article.useCases.archive',
  keywordsKey: 'entity:article.useCases.archiveKeywords',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:article.useCases.archiveConfirm',
  },
  form: 'archive-reason',
})
class ArchiveArticlesUC {}

class NeverDecoratedUC {}

@entity({ domain: 'catalog', key: 'ledger', creatable: false })
class Ledger implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: Ledger,
  key: 'settle',
  binding: 'entity',
  placement: 'context-dependent',
  labelKey: 'entity:ledger.useCases.settle',
  emphasis: 'primary',
  priority: 1,
  rowInline: true,
  shortcut: 'Mod+Enter',
})
class SettleLedgerUC {}

// The same verb over a selection is the same inline verb, not a second one.
@useCase({
  entity: Ledger,
  key: 'settle',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:ledger.useCases.settle',
  rowInline: true,
})
class SettleLedgersUC {}

describe('useCase', () => {
  it('appends every declared use case to the entity, in declaration order', () => {
    expect(describeEntityUseCases(Article)).toEqual([
      {
        key: 'publish',
        binding: 'entity',
        placement: 'determining',
        labelKey: 'entity:article.useCases.publish',
        keywordsKey: undefined,
        confirm: undefined,
        form: undefined,
      },
      {
        key: 'archive',
        binding: 'collection',
        placement: 'context-dependent',
        labelKey: 'entity:article.useCases.archive',
        keywordsKey: 'entity:article.useCases.archiveKeywords',
        confirm: {
          tone: 'destructive',
          messageKey: 'entity:article.useCases.archiveConfirm',
        },
        form: 'archive-reason',
      },
    ]);
  });

  it('carries the hierarchy a surface renders the verb in', () => {
    expect(describeEntityUseCases(Ledger)[0]).toMatchObject({
      emphasis: 'primary',
      priority: 1,
      rowInline: true,
      shortcut: 'Mod+Enter',
    });
    expect(extractMetaUseCaseBinding(SettleLedgerUC).key).toBe('settle');
    expect(extractMetaUseCaseBinding(SettleLedgersUC).binding).toBe(
      'collection',
    );
  });

  it('refuses a second verb shown inline on a row', () => {
    expect(() =>
      useCase({
        entity: Ledger,
        key: 'void',
        binding: 'entity',
        placement: 'context-dependent',
        labelKey: 'entity:ledger.useCases.void',
        rowInline: true,
      })(class VoidLedgerUC {}, { metadata: {} } as ClassDecoratorContext),
    ).toThrow(/rowInline, and so is "settle"/);
  });

  it('records whether a person may create the entity, true unless declared', () => {
    expect(extractMetaEntity(Ledger).creatable).toBe(false);
    expect(extractMetaEntity(Article).creatable).toBe(true);
  });

  it('never leaks a verb onto an entity that did not declare it', () => {
    expect(describeEntityUseCases(Shelf)).toEqual([]);
  });

  it('records the entity, the verb and its binding on the use-case class itself', () => {
    expect(extractMetaUseCaseBinding(PublishArticleUC)).toEqual({
      entity: Article,
      key: 'publish',
      binding: 'entity',
    });
    expect(extractMetaUseCaseBinding(ArchiveArticlesUC).key).toBe('archive');
  });

  it('refuses a target that carries no metadata of its own', () => {
    expect(() =>
      useCase({
        entity: Undeclared,
        key: 'publish',
        binding: 'entity',
        placement: 'determining',
        labelKey: 'entity:undeclared.useCases.publish',
      })(Undeclared, { metadata: {} } as ClassDecoratorContext),
    ).toThrow(Error);
  });

  it('refuses to read a binding off an undecorated class', () => {
    expect(() => extractMetaUseCaseBinding(NeverDecoratedUC)).toThrow(Error);
  });
});
