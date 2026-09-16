import type { RecordSearchResponse } from '@entifix/next-shell';

import { CUSTOMER_SEED, INVOICE_SEED } from '../../../seed';

/**
 * Record search for the command palette's `#` scope.
 *
 * The palette always asks `GET /api/search?q=`. A served application answers
 * with `createRecordSearchRoute` from `@entifix/next-shell/server`, which fans
 * out to its services under the caller's session. This example has neither, so
 * it searches the **seed**: a record saved in the browser tab lives in that
 * tab's memory, which a server cannot read.
 */
export function GET(request: Request) {
  const term = (new URL(request.url).searchParams.get('q') ?? '').trim();
  const needle = term.toLocaleLowerCase();
  const match = (value: string) => value.toLocaleLowerCase().includes(needle);

  const customers = CUSTOMER_SEED.filter(customer => match(customer.name));
  const invoices = INVOICE_SEED.filter(invoice => match(invoice.number));

  const body: RecordSearchResponse = {
    term,
    groups: [
      {
        source: 'customer',
        entity: 'customer',
        labelKey: 'entity:customer.plural',
        total: customers.length,
        items: customers.map(customer => ({
          id: customer.id,
          label: customer.name,
          sublabel: customer.email,
          entity: 'customer',
          href: `/customers/${customer.id}`,
        })),
      },
      {
        source: 'invoice',
        entity: 'invoice',
        labelKey: 'entity:invoice.plural',
        total: invoices.length,
        items: invoices.map(invoice => ({
          id: invoice.id,
          label: invoice.number,
          entity: 'invoice',
          href: `/invoices/${invoice.id}`,
        })),
      },
    ],
    unavailable: [],
  };
  return Response.json(body);
}
