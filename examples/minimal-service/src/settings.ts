/** Environment, with local defaults matching `examples/compose.yaml`. */
export interface MinimalServiceSettings {
  readonly port: number;
  readonly databaseUrl: string;
}

export const readSettings = (
  env: Record<string, string | undefined>,
): MinimalServiceSettings => ({
  port: Number(env['PORT'] ?? 3301),
  databaseUrl:
    env['DATABASE_URL'] ??
    'postgres://entifix:entifix@localhost:5432/example_minimal',
});
