/**
 * Copy owned by `@entifix/react-controls` — the agnostic entity UI. It lives
 * here rather than next to the components because the typed-key augmentation has
 * to see every namespace from one module, and `@entifix/tooling` (T0) may not
 * import a T3 package.
 */
export const controls = {
  actions: {
    more: 'Más acciones',
    forRecord: 'Acciones para {{record}}',
  },
  table: {
    select: 'Seleccionar',
    actions: 'Acciones',
    new: 'Nuevo',
    filters: 'Filtros',
    sorting: 'Orden',
    loading: 'Cargando…',
    /**
     * La columna de selección. `selectRow` nombra la fila porque una casilla
     * sin etiqueta visible sólo se anuncia por su `aria-label`, y repetir el
     * encabezado en cada fila no diría cuál es.
     */
    selection: 'Selección',
    selectRow: 'Seleccionar {{record}}',
    expandRow: 'Expandir {{record}}',
    collapseRow: 'Contraer {{record}}',
    selectAllOnPage: 'Seleccionar todo en esta página',
    /**
     * La segunda selección — la que el servidor evalúa — lleva el número
     * siempre: es la diferencia entre actuar sobre 25 filas y sobre 3.200.
     */
    selectAllMatching_one: 'Seleccionar {{count}} coincidencia',
    selectAllMatching_other: 'Seleccionar las {{count}} coincidencias',
    selectedCount_one: '{{count}} seleccionado',
    selectedCount_other: '{{count}} seleccionados',
    clearSelection: 'Limpiar selección',
    /**
     * Lo que dice la región de estado tras filtrar, ordenar o cambiar de
     * página — nunca en la primera carga, que el lector pidió al llegar.
     */
    results_one: '{{count}} resultado',
    results_other: '{{count}} resultados',
    noResultsFiltered: 'Sin resultados para estos filtros',
    /** El `caption` de la tabla: qué contiene, cuántos y en qué orden. */
    caption: '{{entity}} · {{results}}',
    captionSorted:
      '{{entity}} · {{results}} · ordenado por {{column}}, {{direction}}',
  },
  /**
   * Una acción sobre una selección. El resultado es por fila, nunca un aviso
   * único: 40 seleccionadas y 3 fallidas no es ni un éxito ni un error.
   */
  bulk: {
    running: 'Ejecutando…',
    succeeded_one: '{{count}} registro actualizado',
    succeeded_other: '{{count}} registros actualizados',
    failed_one: '{{count}} registro falló',
    failed_other: '{{count}} registros fallaron',
    retryFailed: 'Reintentar los fallidos',
    dismiss: 'Cerrar resultado',
    resultLabel: 'Resultado de la acción masiva',
    barLabel: 'Acciones sobre la selección',
  },
  form: {
    details: 'Detalles',
    new: 'Nuevo',
    view: 'Ver',
    edit: 'Editar',
    save: 'Guardar',
    saving: 'Guardando…',
    delete: 'Eliminar',
    deleting: 'Eliminando…',
    clone: 'Duplicar',
    back: 'Volver',
    loading: 'Cargando…',
    pending: 'Esperando al servidor…',
    /** El resumen de un guardado rechazado: toma el foco, enlaza cada campo. */
    errorSummary_one: 'Revise {{count}} campo antes de guardar',
    errorSummary_other: 'Revise {{count}} campos antes de guardar',
    requiredHint: 'Los campos marcados con * son obligatorios.',
    requiredMarker: '*',
  },
  /**
   * Lo que dice una región cuando no muestra su contenido (ADR 0028): qué
   * pasó, qué hacer, sin culpar a nadie y sin códigos.
   */
  state: {
    retry: 'Reintentar',
    forbidden: 'No tiene permiso para ver {{plural}}.',
    stale: 'Lo que se muestra puede estar desactualizado.',
    noResults: 'No hay {{plural}} que coincidan con estos filtros.',
    clearFilters: 'Limpiar filtros',
    empty: 'Aquí aparecerán sus {{plural}}.',
    saved: 'Se guardó {{object}}.',
  },
  pagination: {
    label: 'Páginas',
    summary: 'Página {{current}} de {{total}} · {{items}} registros',
    rows: 'Filas',
    first: 'Primera',
    previous: 'Anterior',
    next: 'Siguiente',
    last: 'Última',
    /** Lo que se anuncia al cambiar de página. */
    page: 'Página {{current}} de {{total}}',
  },
  columns: {
    title: 'Columnas',
    subtitle: 'Visibilidad y orden',
    reset: 'Restablecer',
    moveUp: 'Subir {{column}}',
    moveDown: 'Bajar {{column}}',
  },
  filter: {
    match: 'Coincidir',
    all: 'todos',
    any: 'cualquiera',
    add: 'Añadir filtro',
    apply: 'Aplicar',
    clear: 'Limpiar',
    none: 'Esta entidad no tiene miembros filtrables.',
    listPlaceholder: 'valores, separados, por comas',
    matchAria: 'Coincidir todos o cualquiera de los filtros',
    member: 'Miembro del filtro',
    operator: 'Operador del filtro',
    value: 'Valor del filtro',
    rangeEnd: 'Fin del rango del filtro',
    remove: 'Quitar filtro',
    applyAria: 'Aplicar filtros',
    clearAria: 'Limpiar filtros',
    applied: 'Filtros aplicados',
    removeChip: 'Quitar filtro: {{filter}}',
    clearAll: 'Limpiar todo',
    /** Una opción con cuántos registros la tienen: «Borrador (3)». */
    withCount: '{{label}} ({{count}})',
  },
  sort: {
    by: 'Ordenar por',
    then: 'después por',
    ascending: 'ascendente',
    descending: 'descendente',
    add: 'Añadir orden',
    apply: 'Aplicar',
    clear: 'Limpiar',
    none: 'Esta entidad no tiene miembros ordenables.',
    member: 'Miembro de orden',
    direction: 'Dirección de orden',
    raisePriority: 'Subir prioridad de orden',
    lowerPriority: 'Bajar prioridad de orden',
    remove: 'Quitar orden',
    applyAria: 'Aplicar orden',
    clearAria: 'Limpiar orden',
  },
  alert: {
    dismiss: 'Descartar',
  },
  quantity: {
    decrease: 'Disminuir {{label}}',
    increase: 'Aumentar {{label}}',
  },
  tabs: {
    close: 'Cerrar {{label}}',
    new: 'Abrir una pestaña nueva',
    list: 'Pestañas del espacio de trabajo',
    withState: '{{label}}, {{state}}',
    dirty: 'cambios sin guardar',
    saving: 'guardando',
    error: 'sin guardar',
  },
  /**
   * El editor de una relación. `search` es la búsqueda rápida y `browse` abre el
   * catálogo completo; ambos botones son iconos, así que sus etiquetas `aria` son
   * lo único que un lector de pantalla anuncia.
   */
  link: {
    search: 'Buscar {{field}}',
    suggestAria: 'Ver sugerencias de {{field}}',
    browseAria: 'Examinar {{field}}',
    browseTitle: 'Seleccionar {{field}}',
    clear: 'Quitar {{field}}',
    empty: '— sin asignar —',
    loading: 'Cargando…',
    noResults: 'Sin coincidencias',
    error: 'No se pudieron cargar las opciones',
    close: 'Cerrar',
  },
  /**
   * La rejilla de detalle: las filas que un registro **posee** — las líneas de
   * un pedido, los renglones de una factura. `errorSummary` es el único
   * `role="alert"` del control: un aviso por celda anunciaría la rejilla entera
   * en cada pulsación, y un mensaje que sólo vive en la celda es inalcanzable
   * cuando la fila que falla está fuera de pantalla.
   */
  detail: {
    addRow: 'Añadir fila',
    removeRow: 'Quitar fila {{row}}',
    rowActions: 'Acciones de fila',
    empty: 'Todavía no hay filas.',
    errorSummary_one: '{{count}} celda con errores',
    errorSummary_other: '{{count}} celdas con errores',
  },
  value: {
    none: '— ninguno —',
    yes: 'Sí',
    no: 'No',
    /**
     * Una `composition` en una tabla: sus filas se editan en la pantalla del
     * maestro, no en la celda, así que la celda dice cuántas hay.
     */
    rowCount_one: '{{count}} fila',
    rowCount_other: '{{count}} filas',
  },
  /**
   * `required`…`option` son las reglas derivadas de la metadata. El resto es el
   * vocabulario en el que un Standard Schema de una entidad escribe sus
   * mensajes: el esquema lleva la *clave*, nunca una frase, para que la regla
   * siga siendo traducible.
   *
   * `field` es el único parámetro disponible — un issue de Standard Schema
   * expone un mensaje y una ruta, nada más — así que estos mensajes no indican
   * el límite. Una regla que deba enunciarlo escribe su propia clave en el
   * catálogo de su dominio (`entity:product-specification.validation.codeLength`).
   */
  validation: {
    required: '{{field}} es obligatorio',
    number: '{{field}} debe ser un número',
    date: '{{field}} debe ser una fecha',
    option: '{{field}} no es una opción válida',
    minLength: '{{field}} es demasiado corto',
    maxLength: '{{field}} es demasiado largo',
    min: '{{field}} es demasiado pequeño',
    max: '{{field}} es demasiado grande',
    pattern: '{{field}} tiene un formato inválido',
    minItems_one: '{{field}} necesita al menos {{count}} elemento',
    minItems_other: '{{field}} necesita al menos {{count}} elementos',
    maxItems_one: '{{field}} admite como máximo {{count}} elemento',
    maxItems_other: '{{field}} admite como máximo {{count}} elementos',
    notBefore: '{{field}} no puede ser anterior a {{other}}',
    locale: '{{field}} no tiene texto en {{locale}}',
  },
  /**
   * The filter vocabulary shown to a user. Deliberately distinct from
   * `RSQL_TOKENS` in `@entifix/core` — those are wire tokens (`==`, `=gt=`)
   * and must never be translated.
   */
  operator: {
    eq: 'es',
    ne: 'no es',
    gt: 'mayor que',
    gte: 'mayor o igual',
    lt: 'menor que',
    lte: 'menor o igual',
    in: 'es uno de',
    nin: 'no es ninguno de',
    between: 'entre',
    nbetween: 'fuera de',
    like: 'contiene',
    nlike: 'no contiene',
    isNull: 'está vacío',
    isNotNull: 'no está vacío',
  },
  density: {
    label: 'Densidad',
    comfortable: 'Cómoda',
    compact: 'Compacta',
  },
  theme: {
    label: 'Tema',
  },
  /**
   * Captions for the theme presets shipped by `@entifix/style`, plus the
   * per-app brand sets. They name design-system tokens, not app copy, so they
   * live beside the switcher that renders them and stay reachable from
   * Storybook, where no shell is mounted.
   */
  themes: {
    aurora: 'Aurora',
    sunset: 'Atardecer',
    midnight: 'Medianoche',
    ocean: 'Océano (en runtime)',
    marketplace: 'Marketplace',
    marketplaceDark: 'Marketplace oscuro',
    auth: 'Identidad',
    authDark: 'Identidad oscura',
  },
  confirm: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    question: '¿{{verb}} {{object}}?',
    verbCount_one: '{{verb}}',
    verbCount_other: '{{verb}} {{count}}',
    selection_one: '{{count}} {{label}}',
    selection_other: '{{count}} {{plural}}',
    typeToConfirm: 'Escriba {{expected}} para confirmar',
    done: 'Hecho: {{verb}}, {{object}}.',
    undo: 'Deshacer',
    deleteMessage: 'Se elimina de forma definitiva.',
    deleted: 'Se eliminó {{object}}.',
  },
  /** Las actualizaciones en vivo: se dicen al caer y al volver, nada más. */
  live: {
    reconnecting: 'Actualizaciones en vivo en pausa — reconectando',
    stopped: 'Actualizaciones en vivo detenidas',
    reconnect: 'Reconectar',
    resumed: 'Actualizaciones en vivo reanudadas',
    waiting: 'Esperando la conexión…',
  },
  toast: {
    region: 'Notificaciones',
    dismiss: 'Descartar',
  },
  breadcrumbs: {
    label: 'Ruta de navegación',
  },
  /**
   * El asistente. Las etiquetas de cada paso las traduce quien declara el
   * asistente, no el control: un paso es del dominio que lo definió, y su copy
   * vive en `shell:` junto al resto de sus nombres.
   */
  wizard: {
    steps: 'Pasos',
    previous: 'Atrás',
    /**
     * "Continuar" y no "Siguiente": una tabla dentro de un paso trae su propio
     * paginador, cuyo botón **es** "Siguiente". Dos controles con el mismo
     * nombre en la misma pantalla se anuncian igual y hacen cosas distintas.
     */
    next: 'Continuar',
    finish: 'Finalizar',
    /**
     * Un envío que **no** resuelve. El asistente entrega el trabajo y vuelve
     * antes de que la escritura termine, así que dice "enviando" y
     * nunca "guardado": lo segundo sería una afirmación que el control no puede
     * comprobar.
     */
    submitting: 'Enviando…',
    stepOf: 'Paso {{current}} de {{total}}',
    goToStep: 'Volver a {{label}}',
    /**
     * El estado de cada paso, anunciado además de mostrarse. El color por sí
     * solo no lo dice, y un lector de pantalla recorre la lista sin verlo.
     */
    status: {
      pending: 'pendiente',
      active: 'en curso',
      complete: 'completado',
      error: 'con errores',
    },
    /**
     * El recordatorio al retomar. La persistencia da el "continuar" gratis; lo
     * que no da es acordarse de lo ya decidido, que es la falla conocida de los
     * asistentes largos.
     */
    resume: {
      title: 'Retomando donde lo dejaste',
      dismiss: 'Entendido',
    },
  },
};
