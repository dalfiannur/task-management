import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  ApolloLink,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { toast } from "sonner";
import { useCompanyStore } from "@/stores/company-store";

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

const companyLink = setContext((_, { headers }) => {
  const companyId = useCompanyStore.getState().selectedCompanyId;
  return {
    headers: {
      ...headers,
      ...(companyId ? { "X-Company-Id": companyId } : {}),
    },
  };
});

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

function makeClient(uri: string, cache?: InMemoryCache) {
  return new ApolloClient({
    link: ApolloLink.from([authLink, createErrorLink(), createHttpLink({ uri })]),
    cache: cache ?? new InMemoryCache(),
  });
}

const tasksCache = new InMemoryCache({
  typePolicies: {
    Task: { keyFields: ["id"] },
    Module: { keyFields: ["id"] },
    Label: { keyFields: ["id"] },
    Comment: { keyFields: ["id"] },
    Notification: { keyFields: ["id"] },
    Activity: { keyFields: ["id"] },
    Project: { keyFields: ["id"] },
  },
});

const coreCache = new InMemoryCache({
  typePolicies: {
    Project: { keyFields: ["id"] },
  },
});

export const client = makeClient(TASKS_URL, tasksCache);
export const coreClient = makeClient(CORE_URL, coreCache);
export const oidcClient = makeClient(OIDC_URL);
export const mediaClient = makeClient(MEDIA_URL);
function makeSalesClient(uri: string) {
  return new ApolloClient({
    link: ApolloLink.from([
      authLink,
      companyLink,
      createErrorLink(),
      createHttpLink({ uri }),
    ]),
    cache: new InMemoryCache(),
  });
}

export const salesClient = makeSalesClient(SALES_URL);

export function resetAllStores() {
  return Promise.all([
    client.resetStore(),
    coreClient.resetStore(),
    salesClient.resetStore(),
    mediaClient.resetStore(),
  ]);
}