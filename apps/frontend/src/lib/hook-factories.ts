import type { DocumentNode } from "@apollo/client";
import type { ApolloClient } from "@apollo/client";
import { useMutation } from "@/lib/graphql-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutationUpdateFn = (cache: any, result: any) => void;

// --- Mutation factory ---

interface MutationHookOptions<TInput, TRaw, TMapped> {
  mutation: DocumentNode;
  responseKey: string;
  mapVariables?: (input: TInput) => Record<string, unknown>;
  mapResponse?: (raw: TRaw) => TMapped;
  client?: ApolloClient;
  refetchQueries?: DocumentNode[];
  update?: MutationUpdateFn;
}

export function createMutationHook<TInput, TRaw, TMapped = TRaw>(
  options: MutationHookOptions<TInput, TRaw, TMapped>,
) {
  const {
    mutation,
    responseKey,
    mapVariables,
    mapResponse,
    client,
    refetchQueries,
    update,
  } = options;

  return function useMutationHook() {
    const [exec, { loading }] = useMutation<Record<string, TRaw>>(
      mutation,
      {
        ...(client ? { client } : {}),
        ...(refetchQueries ? { refetchQueries } : {}),
        ...(update ? { update } : {}),
      },
    );

    const buildVars = (input: TInput) =>
      mapVariables ? { variables: mapVariables(input) } : { variables: { input } };

    const transform = (raw: TRaw): TMapped =>
      mapResponse ? mapResponse(raw) : (raw as unknown as TMapped);

    return {
      mutate: (
        input: TInput,
        opts?: { onSuccess?: (data: TMapped) => void },
      ) => {
        exec(buildVars(input)).then((res) => {
          if (res.data) opts?.onSuccess?.(transform(res.data[responseKey]));
        });
      },
      mutateAsync: async (input: TInput): Promise<TMapped> => {
        const res = await exec(buildVars(input));
        return transform(res.data![responseKey]);
      },
      isLoading: loading,
    };
  };
}

// --- Void mutation factory (delete / mark-read style) ---

interface VoidMutationHookOptions<TInput> {
  mutation: DocumentNode;
  mapVariables?: (input: TInput) => Record<string, unknown>;
  client?: ApolloClient;
  refetchQueries?: DocumentNode[];
  update?: MutationUpdateFn;
}

export function createVoidMutationHook<TInput>(
  options: VoidMutationHookOptions<TInput>,
) {
  const { mutation, mapVariables, client, refetchQueries, update } = options;

  return function useVoidMutationHook() {
    const [exec, { loading }] = useMutation(
      mutation,
      {
        ...(client ? { client } : {}),
        ...(refetchQueries ? { refetchQueries } : {}),
        ...(update ? { update } : {}),
      },
    );

    const buildVars = (input: TInput) =>
      mapVariables ? { variables: mapVariables(input) } : { variables: { input } };

    return {
      mutate: (input: TInput, opts?: { onSuccess?: () => void }) => {
        exec(buildVars(input)).then(() => {
          opts?.onSuccess?.();
        });
      },
      mutateAsync: async (input: TInput): Promise<void> => {
        await exec(buildVars(input));
      },
      isLoading: loading,
    };
  };
}

// --- Query result normalizer ---

interface QueryResultLike<TData> {
  data?: TData;
  loading: boolean;
  error?: { message: string } | null;
}

export function normalizeQueryResult<TData, TMapped>(
  result: QueryResultLike<TData>,
  extractFn: (data: TData) => TMapped,
) {
  return {
    data: result.data ? extractFn(result.data) : undefined,
    isLoading: result.loading,
    error: result.error ?? null,
  };
}

// --- Paginated query result ---

export interface PageInfo {
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export function normalizePaginatedResult<TData, TMapped>(
  result: QueryResultLike<TData>,
  extractFn: (data: TData) => { items: unknown[]; pageInfo: PageInfo },
  mapFn: (item: unknown) => TMapped,
) {
  if (!result.data) {
    return {
      data: undefined as TMapped[] | undefined,
      pageInfo: null as PageInfo | null,
      isLoading: result.loading,
      error: result.error ?? null,
    };
  }
  const extracted = extractFn(result.data);
  return {
    data: extracted.items.map(mapFn),
    pageInfo: extracted.pageInfo,
    isLoading: result.loading,
    error: result.error ?? null,
  };
}
