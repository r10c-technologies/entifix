/**
 * How entifix's UI meets each WCAG 2.2 A and AA success criterion, and what
 * established it. The report is generated from this, adding for each criterion
 * the axe rules the accessibility gate runs against it (ADR 0024).
 *
 * Methods:
 * - `gate` — axe, against every Storybook story in five theme × scale ×
 *   density cells, and against every screen of the workspace example;
 * - `walk` — the keyboard walk over every example screen: skip link first,
 *   tab order, a visible and unobscured focus indicator on every stop;
 * - `spec` — unit and end-to-end specs asserting the behaviour;
 * - `review` — a reading of the components against the criterion.
 */
export type Level =
  'supports' | 'partially-supports' | 'does-not-support' | 'not-applicable';

export type Method = 'gate' | 'walk' | 'spec' | 'review';

export interface Assessment {
  readonly level: Level;
  readonly methods: readonly Method[];
  readonly notes: string;
}

export const ASSESSMENT: Readonly<Record<string, Assessment>> = {
  // Level A
  '1.1.1': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'Glyphs and skeletons are aria-hidden; every icon-only control is named; MediaGallery requires alternative text for each image.',
  },
  '1.2.1': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library renders no audio or video.',
  },
  '1.2.2': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library renders no audio or video.',
  },
  '1.2.3': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library renders no audio or video.',
  },
  '1.3.1': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'Tables carry a caption and column headers with aria-sort; card lists are lists of articles named by headings; read mode is a description list; fields are labelled and grouped; regions and landmarks are named.',
  },
  '1.3.2': {
    level: 'supports',
    methods: ['walk'],
    notes:
      'DOM order is reading order; the walk fails a stop that jumps back a row.',
  },
  '1.3.3': {
    level: 'supports',
    methods: ['review'],
    notes:
      'Copy names controls by their label, never by shape, colour or position.',
  },
  '1.4.1': {
    level: 'supports',
    methods: ['gate', 'review'],
    notes:
      'State is never colour alone: toggles show a count and aria-expanded, chosen menu options a mark, invalid fields a message, links an underline.',
  },
  '1.4.2': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library plays no audio.',
  },
  '2.1.1': {
    level: 'supports',
    methods: ['walk', 'spec'],
    notes:
      'Every action is a native control or a WAI-ARIA pattern (menu, combobox, dialog, spinbutton, disclosure) with its keyboard model; header sort, row menus, card selection and the palette are keyboard operable.',
  },
  '2.1.2': {
    level: 'supports',
    methods: ['walk', 'spec'],
    notes:
      'Dialogs and the drawer trap focus while open and release it on Escape or close.',
  },
  '2.1.4': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Every shortcut holds Mod: a chord without it, Alt+letter, or an editing chord is refused when it is declared or bound (ADR 0026).',
  },
  '2.2.1': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'No content is timed out from under the reader: a failure toast and a toast offering an action stay until dismissed; only an informational toast leaves on its own.',
  },
  '2.2.2': {
    level: 'supports',
    methods: ['review'],
    notes:
      'Nothing moves on its own beyond a loading shimmer, which stops when content arrives and honours prefers-reduced-motion.',
  },
  '2.3.1': {
    level: 'supports',
    methods: ['review'],
    notes: 'Nothing flashes.',
  },
  '2.4.1': {
    level: 'supports',
    methods: ['walk', 'spec'],
    notes:
      'The back-office shell renders a skip link as the first stop, landing on main; the walk requires it and the first stop in main within three.',
  },
  '2.4.2': {
    level: 'not-applicable',
    methods: ['review'],
    notes:
      'A page title is the host application’s (Next metadata); the workspace example titles every page.',
  },
  '2.4.3': {
    level: 'supports',
    methods: ['walk', 'spec'],
    notes:
      'Tab order follows reading order; after a save, a delete or a hand-off focus moves to the region’s heading, never to the body.',
  },
  '2.4.4': {
    level: 'supports',
    methods: ['spec', 'review'],
    notes:
      'A row’s title is its link; a row’s menu is named for its record; no identical “Open” links remain.',
  },
  '2.5.1': {
    level: 'supports',
    methods: ['review'],
    notes: 'No path-based or multipoint gesture is required.',
  },
  '2.5.2': {
    level: 'supports',
    methods: ['review'],
    notes: 'Controls are native buttons and links, which act on release.',
  },
  '2.5.3': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'A control’s accessible name contains its visible text, the palette’s Back included.',
  },
  '2.5.4': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'Nothing responds to device motion.',
  },
  '3.1.1': {
    level: 'not-applicable',
    methods: ['review'],
    notes:
      'The page language is the host’s; the shell routes each locale under its own prefix and the example sets lang from it.',
  },
  '3.2.1': {
    level: 'supports',
    methods: ['review'],
    notes: 'Focus never changes context.',
  },
  '3.2.2': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Input changes nothing until it is applied: filters and sorting take effect on Apply, forms on Save.',
  },
  '3.2.6': {
    level: 'not-applicable',
    methods: ['review'],
    notes:
      'The library renders no help mechanism; a host that adds one keeps it in one place across pages.',
  },
  '3.3.1': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'An invalid field carries aria-invalid and an aria-describedby naming its message; a refused save shows a summary of links that takes focus.',
  },
  '3.3.2': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'Every field is labelled; required fields are marked, with aria-required and a hint, before anyone submits.',
  },
  '3.3.7': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Forms autosave a draft and a wizard keeps every answer, so nothing entered is asked for again.',
  },
  '4.1.1': {
    level: 'supports',
    methods: ['review'],
    notes: 'Obsolete in WCAG 2.2, where it is always satisfied.',
  },
  '4.1.2': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'Controls expose name, role and state: aria-expanded, aria-checked, aria-sort, aria-current, aria-busy and aria-disabled where they apply.',
  },
  // Level AA
  '1.2.4': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library renders no audio or video.',
  },
  '1.2.5': {
    level: 'not-applicable',
    methods: ['review'],
    notes: 'The library renders no audio or video.',
  },
  '1.3.4': {
    level: 'supports',
    methods: ['review'],
    notes: 'Nothing locks orientation.',
  },
  '1.3.5': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'An entity member declares its autofill token with @accessor({ autocomplete }), and the generated field renders it.',
  },
  '1.4.3': {
    level: 'supports',
    methods: ['gate'],
    notes:
      'Every palette holds its text pairs to 4.5:1 by the token contract (ADR 0025), checked in all five cells; a refetch keeps full contrast.',
  },
  '1.4.4': {
    level: 'supports',
    methods: ['review'],
    notes:
      'Type and spacing are rem-based tokens; nothing fixes a text container’s height.',
  },
  '1.4.5': {
    level: 'supports',
    methods: ['review'],
    notes: 'No text is rendered as an image.',
  },
  '1.4.10': {
    level: 'supports',
    methods: ['gate', 'review'],
    notes:
      'A table becomes a list of cards when its own container is too narrow for its columns; the shell becomes a drawer below the rail width.',
  },
  '1.4.11': {
    level: 'supports',
    methods: ['gate'],
    notes:
      'Control borders, the focus ring and selection hold 3:1 by the token contract, checked in all five cells.',
  },
  '1.4.12': {
    level: 'supports',
    methods: ['review'],
    notes:
      'Text containers size to their content; nothing clips increased spacing.',
  },
  '1.4.13': {
    level: 'supports',
    methods: ['review'],
    notes:
      'No content appears on hover alone; menus and popovers open on activation and close on Escape.',
  },
  '2.4.5': {
    level: 'supports',
    methods: ['review'],
    notes:
      'The back-office shell offers the sidebar, the command palette and record search to reach any screen.',
  },
  '2.4.6': {
    level: 'supports',
    methods: ['spec', 'review'],
    notes:
      'Every page, region, dialog and menu group is headed or named by what it holds.',
  },
  '2.4.7': {
    level: 'supports',
    methods: ['walk', 'gate'],
    notes:
      'Every Tab stop shows a focus ring of 3:1 against its surface; the walk fails a stop without one.',
  },
  '2.4.11': {
    level: 'supports',
    methods: ['walk'],
    notes:
      'The walk fails a focused stop covered by anything; scroll padding keeps a focused row clear of a sticky header and of toasts.',
  },
  '2.5.7': {
    level: 'supports',
    methods: ['review'],
    notes:
      'Nothing requires dragging: column order and sort priority move by buttons.',
  },
  '2.5.8': {
    level: 'supports',
    methods: ['gate', 'spec'],
    notes:
      'Every target reaches --target-min (24px) in every scale and density; the gate measures hit areas in the compact cell and the example’s navigation at both densities.',
  },
  '3.1.2': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Localized text shown from another locale, as a fallback, is marked with that language.',
  },
  '3.2.3': {
    level: 'supports',
    methods: ['review'],
    notes:
      'The shell renders the same navigation, in the same order, on every page.',
  },
  '3.2.4': {
    level: 'supports',
    methods: ['review'],
    notes:
      'One ActionBar renders every action surface, so a verb has one name and one place wherever it appears.',
  },
  '3.3.3': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Validation messages say what the field needs, from the catalog, and never show a key.',
  },
  '3.3.4': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'A destructive verb declares how it is undone — Undo, a confirmation, or the name typed — and Server Action forms confirm with or without JavaScript (ADR 0026).',
  },
  '3.3.8': {
    level: 'not-applicable',
    methods: ['review'],
    notes:
      'The library renders no authentication; sign-in is the host’s identity provider, which the host must assess.',
  },
  '4.1.3': {
    level: 'supports',
    methods: ['spec'],
    notes:
      'Results, saves, deletions, page changes, live-update drops and recoveries are announced through status regions without moving focus; failures through alerts.',
  },
};
