import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  ApolloLink,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { toast } from "sonner";

export { gql } from "@apollo/client";
export { useQuery, useMutation, ApolloProvider } from "@apollo/client/react";

const TASKS_URL = window.location.origin + "/api/tasks/graphql";
export const CORE_URL = window.location.origin + "/api/core/graphql";
export const OIDC_URL = window.location.origin + "/api/oidc/graphql";
export const MEDIA_URL = window.location.origin + "/api/media/graphql";
export const MEDIA_API_BASE = window.location.origin + "/api/media";
export const SALES_URL = window.location.origin + "/api/sales/graphql";

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

function createErrorLink() {
  return onError((response: any) => {
    const graphQLErrors = response.graphQLErrors as Array<{ message?: string; extensions?: { code?: string } }> | undefined;
    const networkError = response.networkError as (Error & { statusCode?: number }) | undefined;

    const isAuthError =
      graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED') ||
      (networkError && 'statusCode' in networkError && networkError.statusCode === 401);

    if (isAuthError) return;

    graphQLErrors?.forEach((error) => {
      toast.error(error.message || 'An unexpected error occurred');
    });

    if (networkError) {
      toast.error(networkError.message || 'Network error');
    }
  });
}

function makeClient(uri: string) {
  return new ApolloClient({
    link: ApolloLink.from([authLink, createErrorLink(), createHttpLink({ uri })]),
    cache: new InMemoryCache(),
  });
}

export const client = makeClient(TASKS_URL);
export const coreClient = makeClient(CORE_URL);
export const oidcClient = makeClient(OIDC_URL);
export const mediaClient = makeClient(MEDIA_URL);
export const salesClient = makeClient(SALES_URL);
