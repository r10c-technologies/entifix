/** The example's own copy, in Spanish — the default locale. */
export const es = {
  entity: {
    book: {
      form: { editTitle: 'Editar libro', newTitle: 'Nuevo libro' },
      label: 'Libro',
      plural: 'Libros',
      fields: {
        id: 'ID',
        title: 'Título',
        author: 'Autor',
        year: 'Año',
        status: 'Estado',
      },
      values: { status: { available: 'Disponible', lent: 'Prestado' } },
    },
  },
  errors: {
    unexpected: 'Algo salió mal. Inténtalo de nuevo.',
    network: 'No se pudo conectar con el servicio.',
    notFound: 'No se encontró el libro.',
    invalidBody: 'El libro no es válido.',
  },
  app: {
    brand: 'entifix · minimal',
    title: 'entifix — ejemplo mínimo',
    description:
      'Una entidad de punta a punta: Postgres, un servicio Effect y las pantallas generadas.',
    nav: { books: 'Libros' },
  },
};

export type ExampleCatalog = typeof es;
