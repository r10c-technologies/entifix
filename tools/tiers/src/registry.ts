/**
 * The tier register: what entifix ships, and what each package is allowed to
 * drag in with it.
 *
 * Declared here rather than derived from the tree, for the reason
 * `tools/slices` declares its stores: a scan can only tell you what the code
 * currently does, and the point of a register is to say what it is *allowed*
 * to do. `tiers.spec.ts` checks the two against each other in both directions.
 *
 * See [ADR 0001](../../../docs/adr/0001-the-tier-contract-and-the-host-seam.md).
 */

export const TIERS = {
  0: 'standalone',
  1: 'entity',
  2: 'adapters',
  3: 'ui',
  4: 'app framework',
  5: 'testing',
} as const;

export type Tier = keyof typeof TIERS;

export interface PackageDeclaration {
  /** The manifest `name`. */
  readonly name: string;
  /** Repo-relative directory holding its `package.json`. */
  readonly dir: string;
  readonly tier: Tier;
}

/**
 * Everything entifix publishes. A package under `packages/` that is
 * missing here fails the build, and so does an entry pointing at a directory
 * that does not exist — the register is not allowed to drift in either
 * direction.
 *
 * `@entifix/authz` ships the authorization *vocabulary* and the two policy
 * ports only. A host's grant table — which role may do what — is a value it
 * supplies at composition, never something this package can know
 * ([ADR 0001](../../../docs/adr/0001-the-tier-contract-and-the-host-seam.md)).
 */
export const PACKAGES: readonly PackageDeclaration[] = [
  // T0 — standalone. Nothing below them; each is usable on its own.
  { name: '@entifix/style', dir: 'packages/style', tier: 0 },
  {
    name: '@entifix/tooling',
    dir: 'packages/ts/tooling',
    tier: 0,
  },

  // T1 — the entity system and the contracts a use case is written against.
  { name: '@entifix/core', dir: 'packages/ts/core', tier: 1 },
  {
    name: '@entifix/business',
    dir: 'packages/ts/business',
    tier: 1,
  },

  // T2 — adapters. One per external system, so an adopter sees what they
  // installed: `mongodb` and `amqplib` are different answers to "what did this
  // pull in", which is why these are packages rather than subpaths.
  {
    name: '@entifix/mongo',
    dir: 'packages/ts/mongo-client',
    tier: 2,
  },
  {
    name: '@entifix/sql',
    dir: 'packages/ts/sql-client',
    tier: 2,
  },
  {
    name: '@entifix/redis',
    dir: 'packages/ts/redis-client',
    tier: 2,
  },
  {
    name: '@entifix/amqp',
    dir: 'packages/ts/amqp-client',
    tier: 2,
  },
  {
    name: '@entifix/rest',
    dir: 'packages/ts/rest-client',
    tier: 2,
  },
  {
    name: '@entifix/transactions',
    dir: 'packages/ts/transactions',
    tier: 2,
  },
  {
    name: '@entifix/jwt',
    dir: 'packages/ts/jwt-client',
    tier: 2,
  },
  {
    name: '@entifix/zitadel',
    dir: 'packages/ts/zitadel-client',
    tier: 2,
  },
  {
    name: '@entifix/posthog',
    dir: 'packages/ts/posthog-client',
    tier: 2,
  },
  // The i18next binding of the translator seam — an adapter to an external
  // library exactly as the datastore clients are, which is why it is not T0.
  { name: '@entifix/i18n', dir: 'packages/ts/i18n', tier: 2 },

  // T3 — the agnostic UI. Adoptable without T0: a table must not arrive with
  // i18next and a Spanish catalog attached.
  {
    name: '@entifix/react-controls',
    dir: 'packages/react/controls',
    tier: 3,
  },
  {
    name: '@entifix/react-integration',
    dir: 'packages/react/integration',
    tier: 3,
  },

  // T4 — the application framework: the authorization vocabulary and the two
  // shells that serve and render an entity.
  {
    name: '@entifix/authz',
    dir: 'packages/ts/authz',
    tier: 4,
  },
  {
    name: '@entifix/service-shell',
    dir: 'packages/effect/service-shell',
    tier: 4,
  },
  {
    name: '@entifix/next-shell',
    dir: 'packages/next/shell',
    tier: 4,
  },
  {
    name: '@entifix/next-i18n',
    dir: 'packages/next/i18n',
    tier: 4,
  },

  // T5 — testing. Above everything because a double may impersonate anything.
  {
    name: '@entifix/testing-unit',
    dir: 'packages/ts/testing-unit',
    tier: 5,
  },
  {
    name: '@entifix/testing-e2e',
    dir: 'packages/ts/testing-e2e',
    tier: 5,
  },
  // A stub principal, so an example can serve `$metadata` without an identity
  // provider — by replacing the token and policy ports, never by opening the
  // route. `type:testing`, because its token service trusts every token.
  {
    name: '@entifix/testing-auth',
    dir: 'packages/ts/testing-auth',
    tier: 5,
  },
];

export interface SidewaysEdge {
  readonly from: string;
  readonly to: string;
  readonly because: string;
}

/**
 * The dependencies allowed between two packages **in the same tier**. Every
 * other same-tier edge fails the build.
 *
 * Tier order alone permits any sideways edge, and most of them would be wrong:
 * a Mongo adapter reaching into the SQL one, `react-controls` and
 * `react-integration` importing each other, one shell mounting another. The
 * tag ordering this repository inherited from r10c used to forbid those, and
 * issue #6 retired it in favour of this list — which names the handful of
 * sideways edges the framework actually takes, each with its reason, so a new
 * one is a decision somebody wrote down.
 *
 * Checked against `dependencies` and `peerDependencies`. An import without a
 * manifest entry is already refused by `@nx/dependency-checks`.
 */
export const SIDEWAYS_EDGES: readonly SidewaysEdge[] = [
  {
    from: '@entifix/business',
    to: '@entifix/core',
    because:
      'a use case is written against entities, and T1 is the pair of them',
  },
  ...['@entifix/mongo', '@entifix/redis', '@entifix/amqp'].map(from => ({
    from,
    to: '@entifix/transactions',
    because:
      'the outbox binding for this driver, behind the `/transactions` ' +
      'subpath and an optional peer',
  })),
  {
    from: '@entifix/rest',
    to: '@entifix/transactions',
    because:
      'a save over REST is a command envelope; see the exemption in ' +
      'OPTIONAL_CAPABILITIES',
  },
  ...['@entifix/service-shell', '@entifix/next-shell'].map(from => ({
    from,
    to: '@entifix/authz',
    because:
      'a shell guards its routes and filters its navigation with the ' +
      'authorization vocabulary',
  })),
  {
    from: '@entifix/testing-e2e',
    to: '@entifix/testing-unit',
    because: 'the e2e fixtures reuse the unit doubles rather than forking them',
  },
];

export interface CapabilityException {
  readonly name: string;
  readonly because: string;
}

export interface OptionalCapability {
  readonly name: string;
  /** Tiers for which this must be an optional peer rather than a dependency. */
  readonly optionalFor: readonly Tier[];
  /** What an adopter would otherwise install without asking for it. */
  readonly otherwiseInstalls: string;
  /**
   * Packages in those tiers that may hard-depend on it anyway.
   *
   * Named one at a time, with the reason on the line, so an exemption is a
   * thing somebody decided rather than a hole in the rule. A new package in the
   * tier still fails by default.
   */
  readonly except?: readonly CapabilityException[];
}

/**
 * The invariant that actually makes entifix composable, and it is **not about
 * direction** — every edge below points downward, which is legal.
 *
 * What is not legal is a *hard* dependency on a capability the tier is supposed
 * to be adoptable without. Such an edge must be a `peerDependencies` entry
 * carrying `peerDependenciesMeta.optional`, reached through a subpath export:
 * package-level dependencies are not per-subpath, so the optional peer is the
 * part that does the work.
 */
export const OPTIONAL_CAPABILITIES: readonly OptionalCapability[] = [
  {
    name: '@entifix/i18n',
    optionalFor: [1, 2, 3],
    otherwiseInstalls: 'i18next, react-i18next and a Spanish catalog',
  },
  {
    name: '@entifix/transactions',
    optionalFor: [2],
    otherwiseInstalls: 'the transactional outbox and the saga engine',
    except: [
      {
        name: '@entifix/rest',
        because:
          'the REST save adapter writes `makeCommandEnvelope` onto the wire ' +
          'and reads `readTransactionAcceptedEnvelope` back, which is the ' +
          'shape of a save in this framework rather than an optional extra. ' +
          'The sink itself is already optional at runtime — the adapter asks ' +
          'for it with `Effect.serviceOption` — but the envelope is not, so a ' +
          'subpath here would hold the whole of entity CRUD over REST.',
      },
    ],
  },
  {
    name: '@entifix/mongo',
    optionalFor: [5],
    otherwiseInstalls: 'the `mongodb` driver',
  },
  {
    name: '@entifix/redis',
    optionalFor: [5],
    otherwiseInstalls: 'the `ioredis` driver',
  },
  {
    name: '@entifix/amqp',
    optionalFor: [5],
    otherwiseInstalls: 'the `amqplib` driver',
  },
];

/**
 * Directories scanned for packages that ought to be registered above. Every
 * `package.json` found under one of these must appear in {@link PACKAGES}.
 *
 * Everything this framework publishes lives under `packages/`, so the scan has
 * one root. A directory here that holds no `package.json` is not an error; a
 * `package.json` under one that is missing from {@link PACKAGES} is.
 */
export const SCANNED_ROOTS = ['packages'] as const;
