// The entity-free half of the design system, published as
// `@entifix/react-controls/primitives`.
//
// It exists because the package's main barrel is one flat re-export of
// everything, and a bundler cannot drop what a module graph reaches: a
// storefront page importing `Card` from `.` pulled `EntityTable`,
// `FilterBuilder`, `SortBuilder`, `ColumnSettings` and the RSQL machinery
// behind them into its client bundle — 541 KB of back-office UI shipped to a
// visitor looking at a product.
//
// The line drawn here is not "small vs large", it is **presentational vs
// entity-aware**: everything below can be understood without knowing what an
// entity is. Anything that reads entity metadata (`CellValue`, `FieldControl`,
// `EntityTable`, `EntityForm`, the filter/sort/column builders, the link
// inputs) stays behind the main entry, where the back-office already imports it.
//
// Consumers that need both may import both; nothing is duplicated, and the main
// barrel keeps re-exporting all of this so no existing import breaks.

// Providers every app mounts, whatever it renders.
//
// `./preferences` is deliberately **not** here. The UI-preferences store is
// backed by Effect `Layer`s, so re-exporting it drags the whole Effect runtime
// into the browser — and what it remembers (column visibility, table density)
// only exists in the back-office. A storefront has no preferences to store.
export * from './i18n/index.js';
export * from './theme/index.js';

// Atoms — text, buttons, fields, tables, loading placeholders.
export * from './ui/atoms/button/index.js';
export * from './ui/atoms/field/index.js';
export * from './ui/atoms/skeleton/index.js';
export * from './ui/atoms/table/index.js';
export * from './ui/atoms/text/index.js';

// Layout primitives (Every Layout): flex-first, with `Grid` the one CSS-Grid
// escape hatch.
export * from './ui/layout/box/index.js';
export * from './ui/layout/center/index.js';
export * from './ui/layout/cluster/index.js';
export * from './ui/layout/cover/index.js';
export * from './ui/layout/grid/index.js';
export * from './ui/layout/sidebar/index.js';
export * from './ui/layout/switcher/index.js';

// Molecules that compose the above and nothing else.
export * from './ui/molecules/breadcrumbs/index.js';
export * from './ui/molecules/card/index.js';
export * from './ui/molecules/confirm-dialog/index.js';
export * from './ui/molecules/loading-boundary/index.js';
export * from './ui/molecules/menu/index.js';
export * from './ui/molecules/pagination/index.js';
export * from './ui/molecules/stack/index.js';
export * from './ui/molecules/tab-strip/index.js';
export * from './ui/molecules/theme-switcher/index.js';
export * from './ui/utils/cn.js';
