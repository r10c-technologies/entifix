/**
 * The example's own copy, in Spanish — the default locale.
 *
 * Three namespaces, and each is the host's rather than the framework's:
 * `entity` names *these* entities, `errors` holds the codes a screen may render,
 * and `app` is the chrome this example draws around the framework's screens.
 * `en.ts` must declare the same keys; its type is this one.
 */
export const es = {
  entity: {
    customer: {
      form: { editTitle: 'Editar cliente', newTitle: 'Nuevo cliente' },
      label: 'Cliente',
      plural: 'Clientes',
      fields: {
        id: 'ID',
        name: 'Nombre',
        email: 'Correo',
        tier: 'Categoría',
        parent: 'Sucursal de',
      },
      values: {
        tier: { standard: 'Estándar', preferred: 'Preferente' },
      },
    },
    invoice: {
      form: { editTitle: 'Editar factura', newTitle: 'Nueva factura' },
      label: 'Factura',
      plural: 'Facturas',
      fields: {
        id: 'ID',
        number: 'Número',
        customer: 'Cliente',
        status: 'Estado',
        lines: 'Líneas',
      },
      lineFields: {
        description: 'Descripción',
        quantity: 'Cantidad',
        unitPrice: 'Precio unitario',
      },
      values: {
        status: { draft: 'Borrador', issued: 'Emitida', void: 'Anulada' },
      },
      useCases: {
        issue: 'Emitir',
        resetDemo: 'Restablecer los datos de ejemplo',
        resetDemoKeywords: 'reiniciar, semilla, datos',
        void: 'Anular',
        voidConfirm: 'Deja de contar como pendiente.',
        voided: 'Factura anulada.',
        reopen: 'Reabrir',
        purgeDrafts: 'Eliminar borradores',
        purgeDraftsConfirm:
          'Se eliminan de forma definitiva todos los borradores de esta lista.',
      },
    },
    payment: {
      form: { editTitle: 'Pago', newTitle: 'Pago' },
      label: 'Pago',
      plural: 'Pagos',
      fields: {
        id: 'ID',
        reference: 'Referencia',
        invoice: 'Factura',
        amount: 'Importe',
        method: 'Método',
      },
      values: {
        method: { card: 'Tarjeta', transfer: 'Transferencia' },
      },
    },
  },
  errors: {
    unexpected: 'Algo salió mal. Inténtalo de nuevo.',
    network: 'No se pudo conectar.',
    notFound: 'No se encontró el registro.',
    noActiveOrganization: 'Elija una organización para ver sus registros.',
    noActiveOrganizationAction: 'Elegir organización',
  },
  app: {
    brand: 'entifix · workspace',
    title: 'entifix — ejemplo de workspace',
    description:
      'La interfaz de entifix sin backend: pestañas, tabla y formulario generados, maestro-detalle, asistente y paleta de comandos.',
    nav: {
      customers: 'Clientes',
      invoices: 'Facturas',
      payments: 'Pagos',
      newInvoice: 'Nueva factura',
    },
    home: {
      title: 'Un workspace sin backend',
      body: 'Todo lo que ves corre en esta pestaña sobre un repositorio en memoria. Los borradores sobreviven a una recarga; los registros guardados vuelven a los datos de ejemplo.',
      openWorkspace: 'Abrir el workspace',
    },
    subscription: {
      title: 'Suscripción',
      active: 'Su suscripción está activa.',
      ended: 'Su suscripción terminó.',
      end: 'Dar de baja',
      keep: 'Conservar',
      confirmTitle: '¿Dar de baja la suscripción?',
      confirmMessage:
        'Dejará de recibir los envíos desde hoy. Para volver tendrá que suscribirse de nuevo.',
    },
    preferences: {
      density: 'Densidad',
      compact: 'Compacta',
      comfortable: 'Cómoda',
      locale: 'Idioma',
      es: 'Español',
      en: 'English',
    },
    wizard: {
      title: 'Nueva factura',
      steps: {
        customer: 'Cliente',
        lines: 'Líneas',
        review: 'Revisión',
      },
      customerHint: 'Elige a quién se factura.',
      linesHint: 'Agrega al menos una línea.',
      description: 'Descripción',
      quantity: 'Cantidad',
      unitPrice: 'Precio unitario',
      addLine: 'Agregar línea',
      removeLine: 'Quitar',
      noLines: 'Todavía no hay líneas.',
      total: 'Total',
    },
  },
};

export type ExampleCatalog = typeof es;
