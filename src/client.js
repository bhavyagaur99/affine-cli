// Builds the authenticated GraphQL client using upstream's own config + auth.
import { GraphQLClient } from "affine-mcp-server/dist/graphqlClient.js";
import { AuthSession } from "affine-mcp-server/dist/authSession.js";
import { loadConfig } from "affine-mcp-server/dist/config.js";

export function createClient() {
  const config = loadConfig();

  const auth = new AuthSession({
    baseUrl: config.baseUrl,
    bearer: config.apiToken,
    cookie: config.apiToken ? undefined : config.cookie,
    email: config.apiToken || config.cookie ? undefined : config.email,
    password: config.apiToken || config.cookie ? undefined : config.password,
    headers: config.headers,
  });

  const gql = new GraphQLClient({
    endpoint: config.graphqlEndpoint,
    headers: { ...(config.headers || {}) },
    authProvider: () => auth.ready(),
  });

  return { gql, auth, config };
}
