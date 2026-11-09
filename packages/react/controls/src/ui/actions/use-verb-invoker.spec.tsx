import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../i18next/index.js';
import { ToastProvider, ToastRegion } from '../molecules/toast-region/index.js';
import {
  useVerbInvoker,
  type VerbInvoker,
  type VerbRequest,
} from './use-verb-invoker.js';

installSpecCatalogs();

type Request = VerbRequest<string>;

const archive: Request['descriptor'] = {
  key: 'archive',
  labelKey: 'entity:gadget.archive',
  confirm: { tone: 'destructive', messageKey: 'entity:gadget.archiveSure' },
  reversible: 'confirm',
};

/** Renders the invoker and hands it back, with its dialog mounted. */
function harness(
  run: (key: string, target: string) => void,
  {
    toasts = false,
    typedThreshold,
    served,
  }: {
    toasts?: boolean;
    typedThreshold?: number;
    served?: readonly { key: string }[];
  } = {},
) {
  let invoker: VerbInvoker<string> | undefined;
  function Probe() {
    invoker = useVerbInvoker<string>({ run, typedThreshold, served });
    return <>{invoker.dialog}</>;
  }
  const withToasts = (children: ReactNode) =>
    toasts ? (
      <ToastProvider>
        {children}
        <ToastRegion />
      </ToastProvider>
    ) : (
      children
    );
  render(<I18nProvider locale="es">{withToasts(<Probe />)}</I18nProvider>);
  return (request: Request) =>
    act(() => {
      invoker?.invoke(request);
    });
}

const dialog = () => within(screen.getByTestId('confirm-dialog'));

describe('useVerbInvoker', () => {
  it('runs a verb that asks for no confirmation at once', () => {
    const run = vi.fn();
    const invoke = harness(run);

    invoke({
      descriptor: { key: 'tag', labelKey: 'entity:gadget.tag' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(run).toHaveBeenCalledWith('tag', 'g-1');
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('asks a question naming the object, and the button repeats the verb', async () => {
    const run = vi.fn();
    const invoke = harness(run);

    invoke({ descriptor: archive, target: 'g-1', object: 'Acme', count: 1 });

    expect(screen.getByRole('alertdialog')).toHaveAccessibleName(
      '¿gadget.archive Acme?',
    );
    expect(run).not.toHaveBeenCalled();
    await userEvent.click(
      dialog().getByRole('button', { name: 'gadget.archive' }),
    );
    expect(run).toHaveBeenCalledWith('archive', 'g-1');
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('names the count on the button, and its own confirming label when declared', () => {
    const invoke = harness(vi.fn());

    invoke({
      descriptor: {
        ...archive,
        confirm: { ...archive.confirm!, confirmLabelKey: 'entity:gadget.bin' },
      },
      target: 'all',
      object: '3 gadgets',
      count: 3,
    });

    expect(
      dialog().getByRole('button', { name: 'gadget.bin 3' }),
    ).toBeInTheDocument();
  });

  it('drops the verb when cancelled', async () => {
    const run = vi.fn();
    const invoke = harness(run);

    invoke({ descriptor: archive, target: 'g-1', object: 'Acme', count: 1 });
    await userEvent.click(dialog().getByRole('button', { name: 'Cancelar' }));

    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('asks for the record’s name to be typed for a typed verb', async () => {
    const run = vi.fn();
    const invoke = harness(run);

    invoke({
      descriptor: { ...archive, reversible: 'typed' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });
    const confirm = dialog().getByRole('button', { name: 'gadget.archive' });
    expect(confirm).toBeDisabled();

    await userEvent.type(
      dialog().getByLabelText('Escriba Acme para confirmar'),
      'Acme',
    );
    expect(confirm).toBeEnabled();
  });

  it('asks for the count over a matching selection past the threshold', () => {
    const invoke = harness(vi.fn(), { typedThreshold: 2 });

    invoke({
      descriptor: archive,
      target: 'all',
      object: '3 gadgets',
      count: 3,
      matching: true,
    });

    expect(
      dialog().getByLabelText('Escriba 3 para confirmar'),
    ).toBeInTheDocument();
  });

  it('runs an undo verb at once and offers Undo, which runs its inverse', async () => {
    const run = vi.fn();
    const invoke = harness(run, { toasts: true });

    invoke({
      descriptor: { ...archive, reversible: 'undo', inverse: 'restore' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(run).toHaveBeenCalledWith('archive', 'g-1');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Hecho: gadget.archive, Acme.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(run).toHaveBeenLastCalledWith('restore', 'g-1');
  });

  it('says what an undo verb did in its own words when it declares them', () => {
    const invoke = harness(vi.fn(), { toasts: true });

    invoke({
      descriptor: {
        ...archive,
        confirm: { ...archive.confirm!, doneKey: 'entity:gadget.archived' },
        reversible: 'undo',
        inverse: 'restore',
      },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(screen.getByRole('status')).toHaveTextContent('gadget.archived');
  });

  it('asks instead when there is no toast region to offer Undo in', () => {
    const run = vi.fn();
    const invoke = harness(run);

    invoke({
      descriptor: { ...archive, reversible: 'undo', inverse: 'restore' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('offers Undo when the served verbs hold the inverse', () => {
    const run = vi.fn();
    const invoke = harness(run, {
      toasts: true,
      served: [{ key: 'archive' }, { key: 'restore' }],
    });

    invoke({
      descriptor: { ...archive, reversible: 'undo', inverse: 'restore' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(run).toHaveBeenCalledWith('archive', 'g-1');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks instead when the caller may not run the inverse', () => {
    const run = vi.fn();
    const invoke = harness(run, { toasts: true, served: [{ key: 'archive' }] });

    invoke({
      descriptor: { ...archive, reversible: 'undo', inverse: 'restore' },
      target: 'g-1',
      object: 'Acme',
      count: 1,
    });

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
