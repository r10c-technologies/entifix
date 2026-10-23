type EsShell = typeof import('./es.js').shell;

export const shell: EsShell = {
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
