// Saved views of the Tasks tab (connect-query over SavedViewService).

import { useMemo } from "react";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import {
  SavedViewService,
  ViewLayout as PbLayout,
  type SavedView as PbSavedView,
} from "@/lib/gen/views_pb";
import { queryClient } from "@/lib/query";
import type { TasksView } from "../atoms/view";

export interface SavedView {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  /** The Tasks tab's URL query string, without `?`. */
  query: string;
  layout: TasksView;
  shared: boolean;
}

export function layoutToProto(l: TasksView): PbLayout {
  return l === "board" ? PbLayout.BOARD : PbLayout.LIST;
}

function mapView(v: PbSavedView): SavedView {
  return {
    id: v.id,
    projectId: v.projectId,
    ownerId: v.ownerId,
    name: v.name,
    query: v.query,
    layout: v.layout === PbLayout.BOARD ? "board" : "list",
    shared: v.shared,
  };
}

const invalidateViews = () =>
  queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({ schema: SavedViewService, cardinality: "finite" }),
  });

export function useSavedViews(projectId: string) {
  const result = useQuery(
    SavedViewService.method.listSavedViews,
    { projectId },
    { enabled: !!projectId },
  );
  const views = useMemo(() => (result.data?.views ?? []).map(mapView), [result.data]);
  return { ...result, views };
}

export function useCreateSavedView() {
  return useMutation(SavedViewService.method.createSavedView, { onSuccess: invalidateViews });
}
export function useUpdateSavedView() {
  return useMutation(SavedViewService.method.updateSavedView, { onSuccess: invalidateViews });
}
export function useDeleteSavedView() {
  return useMutation(SavedViewService.method.deleteSavedView, { onSuccess: invalidateViews });
}
