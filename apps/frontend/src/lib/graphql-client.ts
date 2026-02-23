import { GraphQLClient } from "graphql-request";

const API_URL = window.location.origin + "/api-tasks/graphql";
const CORE_API_URL = window.location.origin + "/api-core/graphql";
const OIDC_API_URL = window.location.origin + "/api-oidc/graphql";

export const graphqlClient = new GraphQLClient(API_URL, {
  credentials: "include",
});

export const coreGraphClient = new GraphQLClient(CORE_API_URL, {
  credentials: "include",
});

export const oidcGraphClient = new GraphQLClient(OIDC_API_URL, {
  credentials: "include",
});

let currentToken: string | null = null;

export function getAuthToken(): string | null {
  return currentToken;
}

export function setAuthToken(token: string | null) {
  currentToken = token;
  if (token) {
    graphqlClient.setHeader("Authorization", `Bearer ${token}`);
    coreGraphClient.setHeader("Authorization", `Bearer ${token}`);
    oidcGraphClient.setHeader("Authorization", `Bearer ${token}`);
  } else {
    graphqlClient.setHeader("Authorization", "");
    coreGraphClient.setHeader("Authorization", "");
    oidcGraphClient.setHeader("Authorization", "");
  }
}
