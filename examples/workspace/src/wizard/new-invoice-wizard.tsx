'use client';

import { loadUCFactory } from '@entifix/business';
import {
  assertWizardDefinition,
  emptyWizardState,
  type Entity,
  type EntityRowDraft,
  newRowKey,
  readStepDraft,
  readStepIds,
  ROW_KEY,
  type WizardDefinition,
} from '@entifix/core';
import {
  Customer,
  Invoice,
  InvoiceLine,
} from '@entifix/example-workspace-domain';
import {
  useFollowWizardStepUrl,
  useWizardDraft,
  useWizardStepUrl,
} from '@entifix/next-shell';
import {
  Button,
  Cluster,
  Select,
  Stack,
  Text,
  TextInput,
  useT,
  Wizard,
} from '@entifix/react-controls';
import { useDataLoading } from '@entifix/react-integration';
import { Context, Effect } from 'effect';
import { useCallback, useState } from 'react';

import { repositories, useExampleAdapters } from '../adapters';

export const NEW_INVOICE_WIZARD_KEY = 'new-invoice';

/**
 * The step graph is data. Three steps in a line, so no step needs a `next()`
 * to choose between edges.
 */
export const NEW_INVOICE_WIZARD: WizardDefinition = {
  key: NEW_INVOICE_WIZARD_KEY,
  steps: [
    {
      id: 'customer',
      kind: 'selection',
      labelKey: 'app:wizard.steps.customer',
      to: ['lines'],
    },
    {
      id: 'lines',
      kind: 'form',
      labelKey: 'app:wizard.steps.lines',
      to: ['review'],
    },
    {
      id: 'review',
      kind: 'summary',
      labelKey: 'app:wizard.steps.review',
      to: [],
    },
  ],
};

assertWizardDefinition(NEW_INVOICE_WIZARD);

const ENTRY_STEP = 'customer';
const STEP_IDS = NEW_INVOICE_WIZARD.steps.map(step => step.id);

interface Line {
  readonly key: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

// A wizard draft is JSON, so lines travel as row drafts of strings.
const readLines = (rows: readonly EntityRowDraft[]): Line[] =>
  rows.map(row => ({
    key: row[ROW_KEY] ?? newRowKey(),
    description: row['description'] ?? '',
    quantity: Number(row['quantity'] ?? '0'),
    unitPrice: Number(row['unitPrice'] ?? '0'),
  }));

const writeLines = (lines: readonly Line[]): EntityRowDraft[] =>
  lines.map(line => ({
    [ROW_KEY]: line.key,
    description: line.description,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
  }));

/** Unique enough for a tab's lifetime; a real service would own the sequence. */
const nextInvoiceNumber = (): string => `INV-${String(Date.now()).slice(-6)}`;

export interface NewInvoiceWizardProps {
  /** A step named by the address, honoured only if the path already reached it. */
  readonly step?: string;
  /** Called with the new invoice's id once it is saved. */
  readonly onCreated: (id: string) => void;
}

/**
 * A guided create, with its state autosaved above the forms.
 *
 * The draft lives in IndexedDB under `wizard:new-invoice`, so a reload resumes
 * on the step you were on with what you had typed. The active step is also in
 * the URL, which is what makes Back and Forward walk the steps.
 */
export function NewInvoiceWizard({ step, onCreated }: NewInvoiceWizardProps) {
  const t = useT('app');
  const translateStep = useT();
  const adapters = useExampleAdapters();
  const draft = useWizardDraft(`wizard:${NEW_INVOICE_WIZARD_KEY}`);
  const state = draft.state ?? emptyWizardState(ENTRY_STEP);

  const writeStep = useWizardStepUrl();
  // A step named by the address wins over the draft's, but only a known one.
  const [activeStep, setActiveStep] = useState<string>(() =>
    step !== undefined && STEP_IDS.includes(step)
      ? step
      : (draft.state?.activeStep ?? ENTRY_STEP),
  );
  const goTo = useCallback(
    (stepId: string) => {
      setActiveStep(stepId);
      writeStep(stepId);
    },
    [writeStep],
  );
  useFollowWizardStepUrl({ activeStep, entryStep: ENTRY_STEP, goTo });

  const customers = useDataLoading<Customer, unknown>({
    uc: loadUCFactory<Customer>(),
    ctx: Context.merge(adapters.customers, adapters.configuration) as never,
    initialPageSize: 50,
    queryKey: ['customer', 'new-invoice-wizard'],
  });

  const [customerId] = readStepIds(state, 'customer');
  const lines = readLines(
    (readStepDraft(state, 'lines')['lines'] ?? []) as readonly EntityRowDraft[],
  );

  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [saving, setSaving] = useState(false);

  const setCustomer = (id: string) =>
    draft.save({
      ...state,
      activeStep,
      steps: {
        ...state.steps,
        customer: { kind: 'selection', ids: id === '' ? [] : [id] },
      },
    });

  const setLines = (next: readonly Line[]) =>
    draft.save({
      ...state,
      activeStep,
      steps: {
        ...state.steps,
        lines: { kind: 'form', values: { lines: writeLines(next) } },
      },
    });

  const addLine = () => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(unitPrice);
    if (
      description.trim() === '' ||
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0 ||
      !Number.isFinite(parsedPrice)
    ) {
      return;
    }
    setLines([
      ...lines,
      {
        key: newRowKey(),
        description: description.trim(),
        quantity: parsedQuantity,
        unitPrice: parsedPrice,
      },
    ]);
    setDescription('');
    setQuantity('1');
    setUnitPrice('0');
  };

  const create = async () => {
    setSaving(true);
    const invoice = new Invoice();
    invoice.number = nextInvoiceNumber();
    invoice.customerId = customerId;
    invoice.lines = lines.map(line =>
      Object.assign(new InvoiceLine(), {
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }),
    );
    const saved = await Effect.runPromise(
      repositories.invoices
        .save(invoice as Entity)
        .pipe(Effect.provide(adapters.configuration)) as Effect.Effect<Entity>,
    );
    setSaving(false);
    draft.clear();
    goTo(ENTRY_STEP);
    onCreated(String(saved.id));
  };

  const stepIndex = STEP_IDS.indexOf(activeStep);
  const stepBy = (offset: number) => {
    const index = Math.min(
      Math.max(stepIndex + offset, 0),
      STEP_IDS.length - 1,
    );
    goTo(STEP_IDS[index] as string);
  };

  const canAdvance =
    activeStep === 'customer'
      ? customerId !== undefined
      : activeStep === 'lines'
        ? lines.length > 0
        : true;

  const customerName = customers.items.find(
    customer => String(customer.id) === customerId,
  )?.name;
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );

  return (
    <Wizard
      steps={NEW_INVOICE_WIZARD.steps.map((candidate, index) => ({
        id: candidate.id,
        label: translateStep(candidate.labelKey as 'app:wizard.steps.customer'),
        status:
          index < stepIndex
            ? 'complete'
            : index === stepIndex
              ? 'active'
              : 'pending',
      }))}
      activeStep={activeStep}
      title={t('wizard.title')}
      canFinish={activeStep === 'review'}
      canAdvance={canAdvance}
      isSubmitting={saving}
      onNext={() => stepBy(1)}
      onPrevious={stepIndex > 0 ? () => stepBy(-1) : undefined}
      onFinish={() => {
        void create();
      }}
    >
      {activeStep === 'customer' && (
        <Stack>
          <Text>{t('wizard.customerHint')}</Text>
          <Select
            aria-label={t('wizard.steps.customer')}
            value={customerId ?? ''}
            onChange={event => setCustomer(event.target.value)}
            disabled={customers.isLoading}
          >
            <option value="">—</option>
            {customers.items.map(customer => (
              <option key={String(customer.id)} value={String(customer.id)}>
                {customer.name}
              </option>
            ))}
          </Select>
        </Stack>
      )}

      {activeStep === 'lines' && (
        <Stack>
          <Text>{t('wizard.linesHint')}</Text>
          <Cluster>
            <TextInput
              aria-label={t('wizard.description')}
              value={description}
              onChange={event => setDescription(event.target.value)}
            />
            <TextInput
              aria-label={t('wizard.quantity')}
              type="number"
              min={1}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
            />
            <TextInput
              aria-label={t('wizard.unitPrice')}
              type="number"
              min={0}
              step="0.01"
              value={unitPrice}
              onChange={event => setUnitPrice(event.target.value)}
            />
            <Button onClick={addLine}>{t('wizard.addLine')}</Button>
          </Cluster>
          <Stack>
            {lines.map(line => (
              <Cluster key={line.key}>
                <Text>
                  {line.quantity} × {line.description}
                </Text>
                <Button
                  onClick={() =>
                    setLines(lines.filter(other => other.key !== line.key))
                  }
                >
                  {t('wizard.removeLine')}
                </Button>
              </Cluster>
            ))}
            {lines.length === 0 && <Text>{t('wizard.noLines')}</Text>}
          </Stack>
        </Stack>
      )}

      {activeStep === 'review' && (
        <Stack>
          <Text>{customerName}</Text>
          {lines.map(line => (
            <Text key={line.key}>
              {line.quantity} × {line.description} —{' '}
              {line.quantity * line.unitPrice}
            </Text>
          ))}
          <Text>
            {t('wizard.total')}: {total}
          </Text>
        </Stack>
      )}
    </Wizard>
  );
}
