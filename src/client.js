// Builds the authenticated GraphQL client using upstream's own config + auth.
import { GraphQLClient } from "affine-mcp-server/dist/graphqlClient.js";
import { AuthSession } from "affine-mcp-server/dist/authSession.js";
import { loadConfig } from "affine-mcp-server/dist/config.js";
import { storedCookieFor } from "./credentials.js";

export function createClient() {
  const config = loadConfig();

  // Environment always wins, so behaviour stays predictable. A session saved by
  // `affine login` is the fallback when nothing is configured.
  const stored = config.apiToken || config.cookie || (config.email && config.password)
    ? null
    : storedCookieFor(config.baseUrl);

  const cookie = config.apiToken ? undefined : (config.cookie || stored || undefined);
  const auth = new AuthSession({
    baseUrl: config.baseUrl,
    bearer: config.apiToken,
    cookie,
    email: config.apiToken || cookie ? undefined : config.email,
    password: config.apiToken || cookie ? undefined : config.password,
    headers: config.headers,
  });
  const authSource = config.apiToken ? "token"
    : config.cookie ? "cookie (env)"
    : stored ? "cookie (stored)"
    : config.email ? "email/password"
    : "none";

  const gql = new GraphQLClient({
    endpoint: config.graphqlEndpoint,
    headers: { ...(config.headers || {}) },
    authProvider: () => auth.ready(),
  });

  return { gql, auth, config, authSource };
}
