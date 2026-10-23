/** Copy owned by the Next shells — back-office chrome and the tab workspace. */
export const shell = {
  nav: {
    primary: 'Principal',
    openInWorkspace: 'Abrir {{label}} en el espacio de trabajo',
    openInWorkspaceShort: 'Abrir en el espacio de trabajo',
    openInNewTab: 'Abrir {{label}} en una pestaña nueva',
    openInNewTabShort: 'Abrir en una pestaña nueva',
    /**
     * The screen taxonomy — the sidebar's top tier, above the
     * domain. `Definiciones` rather than `Maestros` because the ERP term needs
     * the ERP background to parse, and rather than `Catálogos` or `Referencias`
     * because both already mean something else here: the product catalog, and a
     * product's code in `storefront.category.sortByCode`.
     */
    screenType: {
      master: 'Definiciones',
      operation: 'Operaciones',
      wizard: 'Asistentes',
      report: 'Consultas',
    },
  },
  /**
   * La paleta de comandos. Vive en `shell:` y no en `controls:`
   * porque el control es agnóstico —recibe copia ya resuelta— y quien la
   * arma es el back office.
   */
  commandPalette: {
    /** El disparador visible, que existe justo porque un atajo puede fallar. */
    open: 'Buscar o ejecutar',
    /** El nombre accesible del diálogo y de su campo. */
    title: 'Buscar o ejecutar',
    placeholder: 'Busca un registro, una pantalla o un comando…',
    newPlaceholder: '¿Qué quieres crear?',
    newLabel: 'Nuevo…',
    /** El nombre de la página apilada, y también el del control para volver. */
    newTitle: 'Nuevo',
    back: 'Volver',
    empty: 'Sin resultados',
    loading: 'Buscando…',
    more_one: '{{count}} más',
    more_other: '{{count}} más',
    /** Escribe al menos dos caracteres — el suelo que impone `/api/search`. */
    typeMore: 'Escribe al menos {{count}} caracteres para buscar registros.',
    groups: {
      actions: 'Acciones',
      commands: 'Comandos',
      navigation: 'Navegación',
      tabs: 'Pestañas abiertas',
      records: 'Registros',
    },
    /**
     * Dos redacciones para dos cosas distintas: «no es tuyo» es el estado
     * **normal** de un operador sin organización, y pintarlo como avería en
     * cada tecleo enseña a ignorar el aviso que sí importa.
     */
    unavailableScope: 'No disponible aquí: {{reason}}',
    unavailableReach: 'No pudimos consultar este origen: {{reason}}',
    /** Sufijo del comando que abre un destino como pestaña del espacio. */
    openInWorkspaceHint: 'Pestaña',
  },
  sidebar: {
    expand: 'Expandir barra lateral',
    collapse: 'Contraer barra lateral',
    openMenu: 'Abrir el menú',
    closeMenu: 'Cerrar el menú',
    // The drawer is a dialog, so it needs a name of its own — the landmark
    // inside it is the nav, and a dialog with no accessible name is announced
    // as just "dialog".
    menu: 'Menú de navegación',
    expandGroup: 'Desplegar {{group}}',
    collapseGroup: 'Plegar {{group}}',
  },
  /**
   * The session strip, rendered by `SessionKeepalive` only inside the final
   * window before the absolute ceiling. One key, because the strip says one
   * thing: nothing here counts down, since a number that moves invites a person
   * to watch it rather than to save their work.
   */
  session: {
    expiringSoon:
      'Tu sesión está por expirar. Guarda tu trabajo e inicia sesión de nuevo para continuar.',
  },
  breadcrumbs: {
    home: 'Inicio',
    // The `/new` segment, which every domain's create route shares. It was
    // an auth-specific string until one host started serving two domains,
    // at which point a catalog page's breadcrumb read "New user".
    new: 'Nuevo',
  },
  /**
   * The account surface. The auth shell owns the screens, but `ACCOUNT_DESTINATIONS`
   * — the one list every app builds its menu from — lives in the shell, so the
   * shell owns their names too and resolves them itself.
   */
  account: {
    profile: 'Perfil',
    security: 'Seguridad',
    sessions: 'Sesiones',
    signOut: 'Cerrar sesión',
  },
  workspace: {
    copyLink: 'Copiar enlace',
    empty:
      'No hay pestañas abiertas. Elige un catálogo en la barra lateral para empezar.',
    unsupported: 'Esta pestaña no se puede abrir aquí.',
    // The confirmation that guards closing a dirty tab. The title carries the
    // question, so the message states the consequence rather than repeating it
    // — it was phrased as a question while `window.confirm` rendered it, which
    // had nowhere to put a title.
    discardTitle: 'Descartar cambios',
    discard:
      'Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.',
    discardConfirm: 'Descartar',
    // What became of a write the server has not finished. `count` is the
    // number in flight; a failure names no reason here, because the only one a
    // transaction carries is a server exception string in whatever language it
    // was written in — that is rendered beside this, unlocalized and marked so.
    pendingLabel: 'Estado de los guardados',
    savePending_one: 'Guardando 1 registro…',
    savePending_other: 'Guardando {{count}} registros…',
    saveFailed: 'No se pudo guardar el registro.',
    saveFailedDismiss: 'Descartar',
  },
  /**
   * The storefront. Its pages live in `shells-next-marketplace`, so its copy
   * lives here and not in an app catalog — `app:` is reserved for `apps/`.
   */
};
