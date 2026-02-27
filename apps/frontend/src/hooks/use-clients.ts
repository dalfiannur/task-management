import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import {
  createMutationHook,
  createVoidMutationHook,
  normalizeQueryResult,
} from "@/lib/hook-factories";
import type { Client, ClientStatus } from "@/types/client";

// --- Fragments ---

const CLIENT_FIELDS = gql`
  fragment ClientFields on Client {
    id
    name {
      name
      legalName
    }
    companyRef
    companyDetail {
      name {
        name
      }
    }
    address {
      street
      city
      state
      postalCode
      country
    }
    contact {
      attentionName
      email
      phoneNumber
    }
    status
  }
`;

// --- Operations ---

const LIST_CLIENTS = gql`
  ${CLIENT_FIELDS}
  query ListClients($input: listClientsInput!) {
    listClients(input: $input) {
      ...ClientFields
    }
  }
`;

const GET_CLIENT = gql`
  ${CLIENT_FIELDS}
  query GetClient($input: getClientInput!) {
    getClient(input: $input) {
      ...ClientFields
    }
  }
`;

const SEARCH_CLIENTS = gql`
  ${CLIENT_FIELDS}
  query SearchClients($input: searchClientsInput!) {
    searchClients(input: $input) {
      ...ClientFields
    }
  }
`;

const CREATE_CLIENT = gql`
  ${CLIENT_FIELDS}
  mutation CreateClient($input: createClientInput!) {
    createClient(input: $input) {
      ...ClientFields
    }
  }
`;

const UPDATE_CLIENT = gql`
  ${CLIENT_FIELDS}
  mutation UpdateClient($input: updateClientInput!) {
    updateClient(input: $input) {
      ...ClientFields
    }
  }
`;

const DELETE_CLIENT = gql`
  mutation DeleteClient($input: deleteClientInput!) {
    deleteClient(input: $input)
  }
`;

// --- Raw response interfaces ---

interface ClientRaw {
  id: string;
  name: { name: string; legalName: string };
  companyRef: string | null;
  companyDetail: { name: { name: string } } | null;
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  } | null;
  contact: {
    attentionName: string;
    email: string;
    phoneNumber: string;
  } | null;
  status: string;
}

// --- Mapper ---

function mapClient(raw: ClientRaw): Client {
  return {
    id: raw.id,
    name: raw.name.name,
    legalName: raw.name.legalName || undefined,
    companyId: raw.companyRef || undefined,
    companyName: raw.companyDetail?.name?.name || undefined,
    street: raw.address?.street || undefined,
    city: raw.address?.city || undefined,
    state: raw.address?.state || undefined,
    postalCode: raw.address?.postalCode || undefined,
    country: raw.address?.country || undefined,
    attentionName: raw.contact?.attentionName || undefined,
    email: raw.contact?.email || undefined,
    phoneNumber: raw.contact?.phoneNumber || undefined,
    status: raw.status as ClientStatus,
  };
}

// --- Query hooks ---

interface UseClientsOptions {
  status?: ClientStatus;
  search?: string;
  companyId?: string;
}

export function useClients(options?: UseClientsOptions) {
  const result = useQuery<{ listClients: ClientRaw[] }>(LIST_CLIENTS, {
    variables: {
      input: {
        status: options?.status,
        search: options?.search || undefined,
        companyId: options?.companyId,
      },
    },
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listClients.map(mapClient));
}

export function useClient(id?: string) {
  const result = useQuery<{ getClient: ClientRaw }>(GET_CLIENT, {
    variables: { input: { id } },
    skip: !id,
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => mapClient(d.getClient));
}

export function useSearchClients(q?: string) {
  const result = useQuery<{ searchClients: ClientRaw[] }>(SEARCH_CLIENTS, {
    variables: { input: { q: q || "" } },
    skip: !q,
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.searchClients.map(mapClient));
}

// --- Mutation hooks ---

interface CreateClientInput {
  name: string;
  legalName?: string;
  companyId?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  attentionName?: string;
  email?: string;
  phoneNumber?: string;
}

export const useCreateClient = createMutationHook<
  CreateClientInput,
  ClientRaw,
  Client
>({
  mutation: CREATE_CLIENT,
  responseKey: "createClient",
  mapResponse: mapClient,
  client: coreClient,
  refetchQueries: [LIST_CLIENTS],
});

interface UpdateClientInput {
  id: string;
  name?: string;
  legalName?: string;
  companyId?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  attentionName?: string;
  email?: string;
  phoneNumber?: string;
  status?: ClientStatus;
}

export const useUpdateClient = createMutationHook<
  UpdateClientInput,
  ClientRaw,
  Client
>({
  mutation: UPDATE_CLIENT,
  responseKey: "updateClient",
  mapResponse: mapClient,
  client: coreClient,
  refetchQueries: [LIST_CLIENTS],
});

export const useDeleteClient = createVoidMutationHook<string>({
  mutation: DELETE_CLIENT,
  mapVariables: (id) => ({ input: { id } }),
  client: coreClient,
  refetchQueries: [LIST_CLIENTS],
});
