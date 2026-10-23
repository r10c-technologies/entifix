/**
 * Where an app's configuration is fetched from on the server, and what the
 * request carries.
 *
 * Both halves are the host's: the URL a configuration service answers on and
 * the credential it asks for are that deployment's protocol, so the routes here
 * take them as a value rather than composing either. A function rather than an
 * object so a rotated secret — or a test that sets one — is read on each
 * request.
 *
 * Server-only: the headers usually carry a secret, and nothing here is
 * exported from the client entry.
 */
export type ConfigurationSource = () => {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
};
