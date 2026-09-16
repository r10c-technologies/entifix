'use client';

import { screenAddress } from '@entifix/authz';
import { Invoice } from '@entifix/example-workspace-domain';
import {
  BackOfficeShell,
  CommandPaletteHost,
  type NavSection,
  type PaletteCommand,
  type UseCaseCommandEntity,
} from '@entifix/next-shell';
import { useT } from '@entifix/react-controls';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';

import { resetRepositories } from './adapters';
import { customerCrud, invoiceCrud } from './cruds';
import { metadataSource } from './metadata';
import { NEW_INVOICE_WIZARD_KEY } from './wizard/new-invoice-wizard';

/**
 * The frame around every screen: the sidebar, the breadcrumbs and the command
 * palette.
 *
 * A client component here because the palette holds an entity constructor and
 * a handler function, neither of which crosses from a server component as a
 * prop. A served application builds its nav on the server, filtered by the
 * caller's grants; there are no grants here to filter by.
 */
export function ExampleChrome({ children }: { children: ReactNode }) {
  const t = useT('app');
  const queryClient = useQueryClient();

  const nav = useMemo<NavSection[]>(
    () => [
      {
        type: 'master',
        items: [
          {
            label: t('nav.customers'),
            href: customerCrud.basePath,
            workspace: screenAddress({ type: 'master', key: 'customer' }),
          },
          {
            label: t('nav.invoices'),
            href: invoiceCrud.basePath,
            workspace: screenAddress({ type: 'master', key: 'invoice' }),
          },
        ],
      },
      {
        type: 'wizard',
        items: [
          {
            label: t('nav.newInvoice'),
            href: '/wizards/new-invoice',
            workspace: screenAddress({
              type: 'wizard',
              key: NEW_INVOICE_WIZARD_KEY,
            }),
          },
        ],
      },
    ],
    [t],
  );

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        key: 'new-invoice',
        label: t('nav.newInvoice'),
        keywords: [],
        href: '/wizards/new-invoice',
      },
    ],
    [t],
  );

  // One entry, always — the palette calls a hook per entry, so the array's
  // length must not change between renders.
  const useCaseEntities = useMemo<UseCaseCommandEntity[]>(
    () => [
      {
        entityConstructor: Invoice,
        metadataSource,
        handlers: {
          'reset-demo': async () => {
            resetRepositories();
            await queryClient.invalidateQueries();
          },
        },
      },
    ],
    [queryClient],
  );

  return (
    <BackOfficeShell
      nav={nav}
      brand={t('brand')}
      breadcrumbLabels={{
        customers: t('nav.customers'),
        invoices: t('nav.invoices'),
        wizards: t('nav.newInvoice'),
      }}
      commandPalette={
        <CommandPaletteHost
          commands={commands}
          nav={nav}
          useCaseEntities={useCaseEntities}
        />
      }
    >
      {children}
    </BackOfficeShell>
  );
}
