import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useUIStore } from "@/stores/ui-store";

export type SortField = "name" | "size" | "date" | "type";
export type SortDir = "asc" | "desc";

export type FmLevel = "project" | "module" | "task";

export interface FileManagerState {
  selectedModuleId: string | null;
  selectedTaskId: string | null;
  flatten: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  searchQuery: string;
  level: FmLevel;

  navigateToProject: () => void;
  navigateToModule: (id: string) => void;
  navigateToTask: (id: string) => void;
  goUp: () => void;
  toggleFlatten: () => void;
  setSortBy: (field: SortField) => void;
  setSortDir: (dir: SortDir) => void;
  setSearchQuery: (q: string) => void;
}

export function useFileManager(): FileManagerState {
  const [searchParams, setSearchParams] = useSearchParams();
  const { fmFlatten, setFmFlatten } = useUIStore();

  const [sortBy, setSortBy] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");

  const selectedModuleId = searchParams.get("module");
  const selectedTaskId = searchParams.get("task");

  const level: FmLevel = useMemo(() => {
    if (fmFlatten) return "project";
    if (selectedTaskId) return "task";
    if (selectedModuleId) return "module";
    return "project";
  }, [selectedModuleId, selectedTaskId, fmFlatten]);

  const navigateToProject = useCallback(() => {
    setSearchParams((prev) => {
      prev.delete("module");
      prev.delete("task");
      return prev;
    });
  }, [setSearchParams]);

  const navigateToModule = useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        prev.set("module", id);
        prev.delete("task");
        return prev;
      });
    },
    [setSearchParams],
  );

  const navigateToTask = useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        prev.set("task", id);
        return prev;
      });
    },
    [setSearchParams],
  );

  const goUp = useCallback(() => {
    if (selectedTaskId) {
      setSearchParams((prev) => {
        prev.delete("task");
        return prev;
      });
    } else if (selectedModuleId) {
      setSearchParams((prev) => {
        prev.delete("module");
        prev.delete("task");
        return prev;
      });
    }
  }, [selectedModuleId, selectedTaskId, setSearchParams]);

  const toggleFlatten = useCallback(() => {
    const next = !fmFlatten;
    setFmFlatten(next);
    if (next) {
      setSearchParams((prev) => {
        prev.delete("module");
        prev.delete("task");
        return prev;
      });
    }
  }, [fmFlatten, setFmFlatten, setSearchParams]);

  return {
    selectedModuleId,
    selectedTaskId,
    flatten: fmFlatten,
    sortBy,
    sortDir,
    searchQuery,
    level,
    navigateToProject,
    navigateToModule,
    navigateToTask,
    goUp,
    toggleFlatten,
    setSortBy,
    setSortDir,
    setSearchQuery,
  };
}
