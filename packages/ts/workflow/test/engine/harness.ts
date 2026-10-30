import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

import { PgClient } from '@effect/sql-pg';
import type { Slip, SlipStep } from '@entifix/business/flow';
import { Effect, type Layer, ManagedRuntime, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';

/*
 * The chaos suite's side of the runner processes: a database of its own per
 * case, runners spawned over the built packages and killed with SIGKILL, and
 * what the participant recorded read straight out of Postgres.
 */

const url = process.env['ENTIFIX_PG_URL'];
if (url === undefined || url === '')
  throw new Error(
    'ENTIFIX_PG_URL is not set: the chaos suite runs against a real Postgres',
  );

const RUNNER_SCRIPT = join(import.meta.dirname, 'runner.mjs');

const sqlAt = (target: string) =>
  ManagedRuntime.make(
    PgClient.layer({
      url: Redacted.make(target),
    }) as Layer.Layer<SqlClient.SqlClient>,
  );

type Sql = ManagedRuntime.ManagedRuntime<SqlClient.SqlClient, unknown>;

const query = <A extends object>(
  sql: Sql,
  text: string,
  ...params: unknown[]
) =>
  sql.runPromise(
    Effect.flatMap(SqlClient.SqlClient, client =>
      client.unsafe<A>(text, params as never),
    ),
  );

export interface Runner {
  readonly name: string;
  readonly controlPort: number;
  process: ChildProcess;
  log: string;
}

export interface Call {
  readonly step: string;
  readonly kind: string;
  readonly runner: string;
}

let cases = 0;

/** One case's world: its database, its two runners, and what was recorded. */
export const chaosWorld = async (
  options: { readonly breakKey?: boolean } = {},
) => {
  cases += 1;
  const name = `entifix_chaos_${String(process.pid)}_${String(cases)}`;
  const admin = sqlAt(url);
  await query(admin, `DROP DATABASE IF EXISTS ${name}`);
  await query(admin, `CREATE DATABASE ${name}`);
  await admin.dispose();
  const target = new URL(url);
  target.pathname = `/${name}`;
  const database = target.toString();
  const sql = sqlAt(database);
  await query(
    sql,
    `CREATE TABLE chaos_calls (id serial PRIMARY KEY, flow_id text, step text, kind text, key text, runner text)`,
  );
  await query(
    sql,
    `CREATE TABLE chaos_effects (key text PRIMARY KEY, flow_id text, step text, kind text, runner text)`,
  );
  await query(sql, `CREATE TABLE chaos_flags (flag text PRIMARY KEY)`);

  // Ports of their own per case, so a killed runner's socket never answers
  // for the next case's.
  const base = 46_000 + (cases % 50) * 20;
  const runners: Runner[] = [];

  const boot = (runner: Runner, index: number) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [RUNNER_SCRIPT], {
        env: {
          ...process.env,
          // The built packages, as a host runs them — not the source condition
          // the test runner resolves with.
          NODE_OPTIONS: '',
          CHAOS_PG_URL: database,
          CHAOS_RUNNER: runner.name,
          CHAOS_RUNNER_PORT: String(base + index),
          CHAOS_CONTROL_PORT: String(runner.controlPort),
          CHAOS_BREAK_KEY: options.breakKey === true ? '1' : '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runner.process = child;
      runner.log = '';
      const timer = setTimeout(() => {
        reject(
          new Error(`runner ${runner.name} never became ready:\n${runner.log}`),
        );
      }, 30_000);
      const read = (chunk: Buffer) => {
        runner.log += chunk.toString();
        if (runner.log.includes('ready\n')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('exit', code => {
        clearTimeout(timer);
        if (!runner.log.includes('ready\n'))
          reject(
            new Error(
              `runner ${runner.name} exited ${String(code)}:\n${runner.log}`,
            ),
          );
      });
    });

  const runnerNamed = (name: string) => {
    const runner = runners.find(candidate => candidate.name === name);
    if (runner === undefined) throw new Error(`no runner ${name}`);
    return runner;
  };

  /** Starts a runner, or starts a killed one again on the same ports. */
  const start = async (name: string) => {
    const index = name === 'a' ? 0 : 1;
    const known = runners.find(runner => runner.name === name);
    const runner =
      known ?? ({ name, controlPort: base + 10 + index, log: '' } as Runner);
    if (known === undefined) runners.push(runner);
    await boot(runner, index);
    return runner;
  };

  const kill = async (name: string) => {
    const { process: child } = runnerNamed(name);
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
  };

  /** Waits for a runner that kills itself on cue. */
  const exited = (name: string) => {
    const { process: child } = runnerNamed(name);
    return child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>(resolve => child.once('exit', () => resolve()));
  };

  const control = async (name: string, path: string, body: unknown) => {
    const response = await fetch(
      `http://localhost:${String(runnerNamed(name).controlPort)}${path}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };

  const status = async (flowId: string) =>
    (
      await query<{ state: string; step: string | null }>(
        sql,
        'SELECT state, step FROM entifix_flow_status WHERE flow_id = $1',
        flowId,
      )
    )[0];

  const calls = (flowId: string) =>
    query<Call>(
      sql,
      'SELECT step, kind, runner FROM chaos_calls WHERE flow_id = $1 ORDER BY id',
      flowId,
    );

  /** Steps whose effect was applied more than once — what dedup must prevent. */
  const duplicatedEffects = async (flowId: string) =>
    (
      await query<{ step: string; kind: string }>(
        sql,
        `SELECT step, kind FROM chaos_effects WHERE flow_id = $1
         GROUP BY step, kind HAVING count(*) > 1 ORDER BY step`,
        flowId,
      )
    ).map(row => `${row.step}:${row.kind}`);

  return {
    start,
    kill,
    exited,
    control,
    status,
    calls,
    duplicatedEffects,
    runners: () => runners.map(runner => runner.name),
    logs: () =>
      runners.map(runner => `--- ${runner.name}\n${runner.log}`).join('\n'),
    dispose: async () => {
      for (const runner of runners) await kill(runner.name);
      await sql.dispose();
    },
  };
};

export type ChaosWorld = Awaited<ReturnType<typeof chaosWorld>>;

/** Polls `read` until `done` holds, or fails with what it last saw. */
export const eventually = async <A>(
  read: () => Promise<A>,
  done: (value: A) => boolean,
  timeoutMs = 30_000,
): Promise<A> => {
  const until = Date.now() + timeoutMs;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > until)
      throw new Error(`gave up waiting; last saw ${JSON.stringify(last)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
    last = await read();
  }
  return last;
};

export const step = (
  name: string,
  parameters?: SlipStep['parameters'],
): SlipStep => ({
  ref: `chaos.${name === 'await' ? 'await' : name}@1`,
  step: name,
  cardinality: 'one',
  participant: 'chaos',
  ...(parameters === undefined ? {} : { parameters }),
});

export const slipOf = (flowId: string, steps: readonly SlipStep[]): Slip => ({
  slipVersion: 1,
  flowId,
  recipe: 'chaos',
  stages: [{ name: 'main', steps }],
  resolution: [],
  composedAt: '2026-01-01T00:00:00.000Z',
});
