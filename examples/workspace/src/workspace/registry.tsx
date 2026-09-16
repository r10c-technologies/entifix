'use client';

import { screenAddress } from '@entifix/authz';
import {
  entityTabKind,
  TabRegistry,
  useTabEntityNav,
  wizardTabKind,
} from '@entifix/next-shell';

import { CRUDS } from '../cruds';
import {
  NEW_INVOICE_WIZARD_KEY,
  NewInvoiceWizard,
} from '../wizard/new-invoice-wizard';
import { EntityEditorTab } from './entity-tab';

function WizardTab({ step }: { step?: string }) {
  const nav = useTabEntityNav();
  return (
    <NewInvoiceWizard
      step={step}
      onCreated={id => nav.toEntity('invoice', id)}
    />
  );
}

/**
 * Which screens open as tabs, and how an address resolves to one.
 *
 * `master:<entity>[:<id>]` is derived from the crud descriptors — the list, the
 * record, the caption — so adding an entity here is adding it to `CRUDS`.
 * `wizard:new-invoice[:<step>]` is the one hand-registered screen.
 */
export const workspaceRegistry = new TabRegistry()
  .register(
    entityTabKind('master', {
      lists: Object.fromEntries(
        CRUDS.map(crud => [
          crud.entityKey,
          {
            titleKey: crud.entityPluralKey,
            render: () => <crud.ListPage />,
          },
        ]),
      ),
      records: Object.fromEntries(
        CRUDS.map(crud => [
          crud.entityKey,
          {
            labelKey: crud.entityLabelKey,
            render: (id: string) => (
              <EntityEditorTab
                entityKey={crud.entityKey}
                id={id}
                Page={crud.SingleViewPage}
              />
            ),
          },
        ]),
      ),
    }),
  )
  .register(
    wizardTabKind({
      [NEW_INVOICE_WIZARD_KEY]: {
        titleKey: 'app:wizard.title',
        render: step => <WizardTab step={step} />,
      },
    }),
  );

export const WIZARD_ADDRESS = screenAddress({
  type: 'wizard',
  key: NEW_INVOICE_WIZARD_KEY,
});
