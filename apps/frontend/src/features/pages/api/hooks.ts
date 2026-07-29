// Pages (wiki) RPC hooks. ListPages returns full pages (incl. content), so the
// editor is driven from the list — no separate GetPage. Member-gated CRUD.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { PageService } from "@/lib/gen/pages_pb";
import { queryClient } from "@/lib/query";
import type { Page } from "../types";
import { mapPage } from "./mappers";

function invalidatePages() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: PageService,
      cardinality: "finite",
    }),
  });
}

export function usePages(projectId: string) {
  const result = useQuery(
    PageService.method.listPages,
    { projectId },
    { enabled: !!projectId },
  );
  const pages: Page[] = (result.data?.pages ?? [])
    .map(mapPage)
    .sort((a, b) => a.order - b.order);
  return { ...result, pages };
}

export function useCreatePage() {
  return useMutation(PageService.method.createPage, {
    onSuccess: invalidatePages,
  });
}
export function useUpdatePage() {
  return useMutation(PageService.method.updatePage, {
    onSuccess: invalidatePages,
  });
}
export function useDeletePage() {
  return useMutation(PageService.method.deletePage, {
    onSuccess: invalidatePages,
  });
}
export function useReorderPages() {
  return useMutation(PageService.method.reorderPages, {
    onSuccess: invalidatePages,
  });
}
