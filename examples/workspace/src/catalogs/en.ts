import type { ExampleCatalog } from './es';

/** The example's own copy, in English. Typed by the Spanish catalog. */
export const en: ExampleCatalog = {
  entity: {
    customer: {
      form: { editTitle: 'Edit customer', newTitle: 'New customer' },
      label: 'Customer',
      plural: 'Customers',
      fields: {
        id: 'ID',
        name: 'Name',
        email: 'Email',
        tier: 'Tier',
      },
      values: {
        tier: { standard: 'Standard', preferred: 'Preferred' },
      },
    },
    invoice: {
      form: { editTitle: 'Edit invoice', newTitle: 'New invoice' },
      label: 'Invoice',
      plural: 'Invoices',
      fields: {
        id: 'ID',
        number: 'Number',
        customer: 'Customer',
        status: 'Status',
        lines: 'Lines',
      },
      lineFields: {
        description: 'Description',
        quantity: 'Quantity',
        unitPrice: 'Unit price',
      },
      values: {
        status: { draft: 'Draft', issued: 'Issued' },
      },
      useCases: {
        issue: 'Issue',
        resetDemo: 'Reset the example data',
        resetDemoKeywords: 'reset, seed, data',
      },
    },
  },
  errors: {
    unexpected: 'Something went wrong. Try again.',
    network: 'Could not connect.',
    notFound: 'The record was not found.',
  },
  app: {
    brand: 'entifix · workspace',
    title: 'entifix — workspace example',
    description:
      'entifix’s UI with no backend: tabs, a generated table and form, master-detail, a wizard and the command palette.',
    nav: {
      customers: 'Customers',
      invoices: 'Invoices',
      newInvoice: 'New invoice',
    },
    home: {
      title: 'A workspace with no backend',
      body: 'Everything here runs in this tab over an in-memory repository. Drafts survive a reload; saved records go back to the example data.',
      openWorkspace: 'Open the workspace',
    },
    preferences: {
      density: 'Density',
      compact: 'Compact',
      comfortable: 'Comfortable',
      locale: 'Language',
      es: 'Español',
      en: 'English',
    },
    wizard: {
      title: 'New invoice',
      steps: {
        customer: 'Customer',
        lines: 'Lines',
        review: 'Review',
      },
      customerHint: 'Choose who is billed.',
      linesHint: 'Add at least one line.',
      description: 'Description',
      quantity: 'Quantity',
      unitPrice: 'Unit price',
      addLine: 'Add line',
      removeLine: 'Remove',
      noLines: 'No lines yet.',
      total: 'Total',
    },
  },
};
