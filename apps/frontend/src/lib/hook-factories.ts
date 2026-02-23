import type { DocumentNode } from "@apollo/client";
import type { ApolloClient } from "@apollo/client";
import { useMutation } from "@/lib/graphql-client";

// --- Mutation factory ---

interface MutationHookOptions<TInput, TRaw, TMapped> {
  mutation: DocumentNode;
  responseKey: string;
  mapVariables?: (input: TInput) => Record<string, unknown>;
  mapResponse?: (raw: TRaw) => TMapped;
  client?: ApolloClient;
  refetchQueries?: DocumentNode[];
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
  } = options;

  return function useMutationHook() {
    const [exec, { loading }] = useMutation<Record<string, TRaw>>(
      mutation,
      {
        ...(client ? { client } : {}),
        ...(refetchQueries ? { refetchQueries, awaitRefetchQueries: true } : {}),
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
}

export function createVoidMutationHook<TInput>(
  options: VoidMutationHookOptions<TInput>,
) {
  const { mutation, mapVariables, client, refetchQueries } = options;

  return function useVoidMutationHook() {
    const [exec, { loading }] = useMutation(
      mutation,
      {
        ...(client ? { client } : {}),
        ...(refetchQueries ? { refetchQueries, awaitRefetchQueries: true } : {}),
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
