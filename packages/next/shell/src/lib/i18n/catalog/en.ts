type EsShell = typeof import('./es.js').shell;

export const shell: EsShell = {
  /**
   * The stock surface — the first Operaciones screens in the back office.
   *
   * The *tier* name ("Operaciones") comes from `nav.screenType.operation`; this
   * names the group inside it.
   */
  stock: {
    nav: {
      stock: 'Stock',
      items: 'Stock on hand',
      movements: 'Movement ledger',
      reservations: 'Reservations',
    },
  },
  order: {
    nav: {
      orders: 'Orders',
    },
  },
  settlement: {
    nav: {
      settlement: 'Settlement',
      agreements: 'Agreements',
      entries: 'Commission entries',
      runs: 'Settlement runs',
      payouts: 'Vendor payouts',
    },
    agreement: {
      channelRatesHint:
        'Leave blank to charge the default commission on that channel. A 0 means nothing is charged.',
      channelRateDefault: 'Default',
      noChannelRates: 'No per-channel rates',
    },
  },
  sales: {
    nav: {
      sales: 'Sales',
      channels: 'Sales channels',
      guided: 'Sales',
      counterSale: 'Sell at the counter',
    },
    counterSale: {
      title: 'Counter sale',
      steps: {
        channel: 'Channel',
        lines: 'Products',
        payment: 'Payment',
        summary: 'Summary',
      },
      channelHint: 'Pick the channel this sale goes through.',
      linesHint: 'Add the published products you are selling.',
      addLine: 'Add product',
      removeLine: 'Remove',
      quantity: 'Quantity',
      offering: 'Product',
      total: 'Total',
      paymentMethod: 'Payment method',
      charge: 'Charge',
      sold: 'Sale recorded',
      soldDetail: 'The stock is already drawn down and the order is written.',
      newSale: 'New sale',
      emptyLines: 'Add at least one product to charge for.',
    },
  },
  marketplaceAdmin: {
    nav: {
      catalog: 'Catalog',
      products: 'Products',
      brands: 'Brands',
      categories: 'Categories',
      offerings: 'Product offerings',
      offeringPrices: 'Offering prices',
      guided: 'Catalog',
    },
    wizard: {
      productSetup: {
        title: 'New product',
        launch: 'Guided new product',
        steps: {
          start: 'Source',
          source: 'Base product',
          identity: 'Identification',
          classification: 'Classification',
          summary: 'Summary',
        },
        start: {
          question: 'How do you want to start?',
          blank: 'From scratch',
          blankHint: 'Enter the details by hand.',
          duplicate: 'Duplicate an existing one',
          duplicateHint:
            'Start from a product already on file. The code is not copied: it identifies the original.',
        },
        source: {
          prompt: 'Pick the product to start from.',
          chosen: 'Base product: {{name}}',
          required: 'Pick a product to continue.',
        },
        summary: {
          prompt: 'Check what you entered before creating it.',
          origin: 'Source',
          originBlank: 'From scratch',
          originDuplicate: 'Duplicated from {{name}}',
          empty: 'Not set',
        },
        recap: 'You had already answered:',
      },
    },
  },
  systemManagement: {
    nav: {
      section: 'System',
      configuration: 'Configuration',
    },
    configuration: {
      title: 'Platform configuration',
      description:
        'Parameters every service resolves at boot. Editing a value affects that service on its next start.',
      secretPlaceholder: '•••••• (unchanged)',
      secretHint:
        'Leaving this blank keeps the stored value. Typing a new one replaces it.',
    },
  },
  nav: {
    primary: 'Primary',
    openInWorkspace: 'Open {{label}} in workspace',
    openInWorkspaceShort: 'Open in workspace',
    openInNewTab: 'Open {{label}} in a new tab',
    openInNewTabShort: 'Open in a new tab',
    /**
     * The screen taxonomy (ADR 0033). Translated like every other string rather
     * than kept in Spanish: what that decision fixed was which *Spanish* word
     * ships to the default locale, not that the term is untranslatable.
     */
    screenType: {
      master: 'Definitions',
      operation: 'Operations',
      wizard: 'Wizards',
      report: 'Reports',
    },
  },
  commandPalette: {
    open: 'Search or run',
    title: 'Search or run',
    placeholder: 'Search a record, a screen or a command…',
    newPlaceholder: 'What would you like to create?',
    newLabel: 'New…',
    newTitle: 'New',
    back: 'Back',
    empty: 'No results',
    loading: 'Searching…',
    more_one: '{{count}} more',
    more_other: '{{count}} more',
    typeMore: 'Type at least {{count}} characters to search records.',
    groups: {
      actions: 'Actions',
      commands: 'Commands',
      navigation: 'Navigation',
      tabs: 'Open tabs',
      records: 'Records',
    },
    unavailableScope: 'Not available here: {{reason}}',
    unavailableReach: 'We could not reach this source: {{reason}}',
    openInWorkspaceHint: 'Tab',
  },
  sidebar: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    openMenu: 'Open the menu',
    closeMenu: 'Close the menu',
    menu: 'Navigation menu',
    expandGroup: 'Expand {{group}}',
    collapseGroup: 'Collapse {{group}}',
  },
  session: {
    expiringSoon:
      'Your session is about to expire. Save your work and sign in again to continue.',
  },
  breadcrumbs: {
    home: 'Home',
    // The `/new` segment, which every domain's create route shares. It was
    // an auth-specific string until one host started serving two domains,
    // at which point a catalog page's breadcrumb read "New user".
    new: 'New',
  },
  account: {
    profile: 'Profile',
    security: 'Security',
    sessions: 'Sessions',
    signOut: 'Sign out',
  },
  workspace: {
    copyLink: 'Copy link',
    empty: 'No open tabs. Pick a catalog from the sidebar to start.',
    unsupported: "This tab can't be opened here.",
    discardTitle: 'Discard changes',
    discard: 'This tab has unsaved changes. Closing it will lose them.',
    discardConfirm: 'Discard',
    // See the Spanish catalog for why a failure's reason is not a key here.
    pendingLabel: 'Save status',
    savePending_one: 'Saving 1 record…',
    savePending_other: 'Saving {{count}} records…',
    saveFailed: 'The record could not be saved.',
    saveFailedDismiss: 'Dismiss',
  },
};
