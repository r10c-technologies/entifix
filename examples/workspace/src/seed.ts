import {
  Customer,
  type CustomerTier,
  Invoice,
  InvoiceLine,
  type InvoiceStatus,
} from '@entifix/example-workspace-domain';

/**
 * The records the example starts with, as plain data.
 *
 * Plain rather than instances because two readers need them: the in-memory
 * repositories in the page, which build instances from it, and the search route
 * on the server, which only needs names and ids. The server cannot see what the
 * page later saves — the repositories live in the browser tab — so a search
 * finds the seed and nothing typed since.
 */
export const CUSTOMER_SEED: ReadonlyArray<{
  id: string;
  name: string;
  email: string;
  tier: CustomerTier;
}> = [
  {
    id: 'c-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    tier: 'preferred',
  },
  {
    id: 'c-2',
    name: 'Alan Turing',
    email: 'alan@example.com',
    tier: 'standard',
  },
  {
    id: 'c-3',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    tier: 'preferred',
  },
];

export const INVOICE_SEED: ReadonlyArray<{
  id: string;
  number: string;
  customerId: string;
  status: InvoiceStatus;
  lines: ReadonlyArray<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}> = [
  {
    id: 'i-1',
    number: 'INV-0001',
    customerId: 'c-1',
    status: 'issued',
    lines: [
      {
        description: 'Analytical engine consulting',
        quantity: 3,
        unitPrice: 120,
      },
      { description: 'Punched cards', quantity: 500, unitPrice: 0.1 },
    ],
  },
  {
    id: 'i-2',
    number: 'INV-0002',
    customerId: 'c-3',
    status: 'draft',
    lines: [{ description: 'Compiler support', quantity: 8, unitPrice: 95 }],
  },
];

export const customerInstances = (): Customer[] =>
  CUSTOMER_SEED.map(data => Object.assign(new Customer(), data));

export const invoiceInstances = (): Invoice[] =>
  INVOICE_SEED.map(({ lines, ...data }) =>
    Object.assign(new Invoice(), data, {
      lines: lines.map(line => Object.assign(new InvoiceLine(), line)),
    }),
  );
