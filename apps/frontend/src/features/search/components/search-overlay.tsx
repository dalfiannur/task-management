import { useEffect, useMemo, useState } from "react";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import {
  FileText,
  FolderKanban,
  ListTodo,
  MessageSquare,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MIN_QUERY, useSearch } from "../api/hooks";
import { searchOpenAtom, searchPersonAtom } from "../atoms/overlay";
import type { SearchHit, SearchKind } from "../types";
import { Snippet } from "./snippet";

// Fixed order — NOT re-sorted by which kind currently has the most hits. A
// group order that shifted under the user's cursor as they typed would be
// worse than one that's merely not "optimal" for a given query.
const GROUPS: { kind: SearchKind; label: string; icon: LucideIcon }[] = [
  { kind: "task", label: "Tasks", icon: ListTodo },
  { kind: "page", label: "Pages", icon: FileText },
  { kind: "comment", label: "Comments", icon: MessageSquare },
  { kind: "project", label: "Projects", icon: FolderKanban },
  { kind: "user", label: "People", icon: User },
];

/**
 * Global Cmd+K / Ctrl+K search. Mounted once in the app shell.
 *
 * cmdk's own client-side text filter is turned off (`shouldFilter={false}`
 * on CommandDialog) — results are already ranked server-side by Postgres
 * full-text search, and re-filtering them against the raw query would drop
 * rows that only matched a stemmed form (the exact thing FTS is for).
 */
export function SearchOverlay() {
  const [open, setOpen] = useAtom(searchOpenAtom);
  const [person, setPerson] = useAtom(searchPersonAtom);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  function onOpenChange(o: boolean) {
    setOpen(o);
    // The person chip is left alone: refine-then-reopen ("find John" → pick
    // John → close → Cmd+K again to look at something else of his) is a
    // normal loop, not a state that should reset with the dialog.
    if (!o) setQuery("");
  }

  const assigneeIds = useMemo(() => (person ? [person.id] : []), [person]);
  const { hits, isSearching, isError, belowMin } = useSearch(query, assigneeIds);

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        hits: hits
          .filter((h) => h.kind === g.kind)
          .sort((a, b) => b.score - a.score),
      })).filter((g) => g.hits.length > 0),
    [hits],
  );

  // cmdk's automatic "select the first item" only fires off its own
  // filter/score pass, which is disabled below (`shouldFilter={false}`) —
  // so with a server-ranked list, nothing re-selects a row when the result
  // set is swapped out from under it (works once, then the first item stays
  // unselected on every subsequent query). Drive selection explicitly via
  // cmdk's controlled `value`/`onValueChange` instead: reset to the first
  // rendered row whenever the *result set itself* changes (this list is
  // referentially stable across unrelated re-renders — see the memo in
  // useSearch — so this does not re-fire on every render, e.g. an arrow-key
  // selection change, which would otherwise fight the user's own navigation).
  const orderedValues = useMemo(
    () => groups.flatMap((g) => g.hits.map((h) => `${h.kind}:${h.id}`)),
    [groups],
  );
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected(orderedValues[0] ?? "");
  }, [orderedValues]);

  // `belowMin` comes from the hook (debounce-consistent — see its comment);
  // `trimmed` here is only for display text, so it always echoes what's
  // currently in the input.
  const trimmed = query.trim();

  function onSelect(hit: SearchHit) {
    switch (hit.kind) {
      case "task":
        if (!hit.projectId) return;
        navigate({
          to: "/projects/$projectId/all-tasks",
          params: { projectId: hit.projectId },
          search: { task: hit.id },
        });
        onOpenChange(false);
        return;
      case "comment":
        if (!hit.projectId || !hit.taskId) return;
        navigate({
          to: "/projects/$projectId/all-tasks",
          params: { projectId: hit.projectId },
          search: { task: hit.taskId, comment: hit.id },
        });
        onOpenChange(false);
        return;
      case "page":
        if (!hit.projectId) return;
        navigate({
          to: "/projects/$projectId/pages",
          params: { projectId: hit.projectId },
          search: { page: hit.id },
        });
        onOpenChange(false);
        return;
      case "project":
        navigate({
          to: "/projects/$projectId",
          params: { projectId: hit.id },
        });
        onOpenChange(false);
        return;
      case "user":
        // No person page exists — refine instead of navigating. Overlay
        // stays open; clear the query so the chip's own name doesn't keep
        // matching itself on the next search.
        setPerson({ id: hit.id, name: hit.title });
        setQuery("");
        return;
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      title="Search"
      description="Search tasks, pages, comments, projects, and people"
    >
      {person && (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle py-1 pr-1 pl-2.5 text-xs font-medium text-brand-text">
            Assigned to {person.name}
            <button
              type="button"
              onClick={() => setPerson(null)}
              aria-label={`Clear "${person.name}" filter`}
              className="rounded-full p-0.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tasks, pages, comments, projects, people…"
      />
      <CommandList>
        {belowMin ? (
          <div className="py-8 text-center text-sm text-text-muted">
            Type at least {MIN_QUERY} characters to search.
          </div>
        ) : isError ? (
          // One clear row, no retry — the app must not unmount anything.
          <div className="py-8 text-center text-sm text-danger">
            Search failed. Try again in a moment.
          </div>
        ) : isSearching ? (
          <div className="py-8 text-center text-sm text-text-muted">
            Searching…
          </div>
        ) : groups.length === 0 ? (
          <CommandEmpty>No results for “{trimmed}”.</CommandEmpty>
        ) : (
          groups.map((g) => (
            <CommandGroup key={g.kind} heading={g.label}>
              {g.hits.map((hit) => (
                <CommandItem
                  key={`${hit.kind}:${hit.id}`}
                  value={`${hit.kind}:${hit.id}`}
                  onSelect={() => onSelect(hit)}
                  // `group` so the muted sub-lines below can react to this
                  // item's own `data-selected` via group-data-* (see Snippet
                  // and the project-name span) instead of staying grey once
                  // the row's background turns brand-subtle.
                  className="group"
                >
                  <g.icon />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{hit.title}</div>
                    {/* People rows show name only — their indexed body is a
                        phone number, a matching aid, not display content. */}
                    {hit.kind !== "user" && hit.snippet && (
                      <Snippet html={hit.snippet} />
                    )}
                    {/* A subtask result's most useful context is which task
                        it belongs to, not which project — the project name
                        line stands in for that everywhere else, but here it
                        would just repeat what "Tasks" already implies. */}
                    {hit.kind !== "project" &&
                      (hit.parentTitle ? (
                        <span className="block truncate text-xs text-text-subtle group-data-[selected=true]:text-brand-text">
                          Subtask of {hit.parentTitle}
                        </span>
                      ) : (
                        hit.projectName && (
                          <span className="block truncate text-xs text-text-subtle group-data-[selected=true]:text-brand-text">
                            {hit.projectName}
                          </span>
                        )
                      ))}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </CommandDialog>
  );
}
