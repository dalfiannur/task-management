import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  ApolloLink,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";

export { gql } from "@apollo/client";
export { useQuery, useMutation, ApolloProvider } from "@apollo/client/react";

const TASKS_URL = window.location.origin + "/api-tasks/graphql";
export const CORE_URL = window.location.origin + "/api-core/graphql";
export const OIDC_URL = window.location.origin + "/api-oidc/graphql";
export const MEDIA_URL = window.location.origin + "/api-media/graphql";
export const MEDIA_API_BASE = window.location.origin + "/api-media";

let currentToken: string | null = null;

export function getAuthToken(): string | null {
  return currentToken;
}

export function setAuthToken(token: string | null) {
  currentToken = token;
}

const authLink = setContext((_, { headers }) => ({
  headers: {
    ...headers,
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
  },
}));

function makeClient(uri: string) {
  return new ApolloClient({
    link: ApolloLink.from([authLink, createHttpLink({ uri })]),
    cache: new InMemoryCache(),
  });
}

export const client = makeClient(TASKS_URL);
export const coreClient = makeClient(CORE_URL);
export const oidcClient = makeClient(OIDC_URL);
export const mediaClient = makeClient(MEDIA_URL);
