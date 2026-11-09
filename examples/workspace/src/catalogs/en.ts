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
        parent: 'Branch of',
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
        status: { draft: 'Draft', issued: 'Issued', void: 'Void' },
      },
      useCases: {
        issue: 'Issue',
        resetDemo: 'Reset the example data',
        resetDemoKeywords: 'reset, seed, data',
        void: 'Void',
        voidConfirm: 'It stops counting as owed.',
        voided: 'Invoice voided.',
        reopen: 'Reopen',
        purgeDrafts: 'Delete drafts',
        purgeDraftsConfirm:
          'Every draft invoice in this list is deleted for good.',
      },
    },
    payment: {
      form: { editTitle: 'Payment', newTitle: 'Payment' },
      label: 'Payment',
      plural: 'Payments',
      fields: {
        id: 'ID',
        reference: 'Reference',
        invoice: 'Invoice',
        amount: 'Amount',
        method: 'Method',
      },
      values: {
        method: { card: 'Card', transfer: 'Transfer' },
      },
    },
  },
  errors: {
    unexpected: 'Something went wrong. Try again.',
    network: 'Could not connect.',
    notFound: 'The record was not found.',
    noActiveOrganization: 'Choose an organization to see its records.',
    noActiveOrganizationAction: 'Choose organization',
  },
  app: {
    brand: 'entifix · workspace',
    title: 'entifix — workspace example',
    description:
      'entifix’s UI with no backend: tabs, a generated table and form, master-detail, a wizard and the command palette.',
    nav: {
      customers: 'Customers',
      invoices: 'Invoices',
      payments: 'Payments',
      newInvoice: 'New invoice',
    },
    home: {
      title: 'A workspace with no backend',
      body: 'Everything here runs in this tab over an in-memory repository. Drafts survive a reload; saved records go back to the example data.',
      openWorkspace: 'Open the workspace',
    },
    subscription: {
      title: 'Subscription',
      active: 'Your subscription is active.',
      ended: 'Your subscription has ended.',
      end: 'Unsubscribe',
      keep: 'Keep it',
      confirmTitle: 'Unsubscribe?',
      confirmMessage:
        'Deliveries stop today. To come back you will have to subscribe again.',
    },
    account: {
      guest: 'Guest',
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
