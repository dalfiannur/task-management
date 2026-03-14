import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRef } from "react";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "@/components/shared/search-dropdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskDetail } from "@/components/tasks/task-detail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useDeleteModule } from "@/hooks/use-modules";
import { usePagesByModule, usePages, useUpdatePage } from "@/hooks/use-pages";
import { useLabels } from "@/hooks/use-labels";
import { useUser } from "@/hooks/use-users";
import { ChevronRight, FileText, FolderOpen, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { ModuleForm } from "./module-form";
import { CommentsDialog } from "@/components/tasks/comments-dialog";
import { useCommentCounts } from "@/hooks/use-comments";
import { TASK_STATUS_CONFIG, type Label, type Module, type Task, type TaskStatus, type UpdateTaskInput } from "@/types/task";
import { type ProjectDisplayStatus } from "@/types/project"
import { cn, getInitials } from "@/lib/utils";
import { Button } from "../ui/button";

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  todo: "bg-blue-400",
  in_progress: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-red-400",
};

const statusOptions: (SearchDropdownOption & { _key: TaskStatus })[] =
  (Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string; color: string }][]).map(
    ([key, config]) => ({ value: key, label: config.label, _key: key }),
  );

export const MODULE_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
];

interface ModuleSectionProps {
  module: Module;
  projectId: string;
  colorIndex: number;
  filters?: { status?: string; priority?: string; search?: string; assignees?: string[] };
  projectStatus?: ProjectDisplayStatus;
  subProjectCount?: number;
}

function AssigneeAvatar({ userId, showName }: { userId: string; showName?: boolean }) {
  const { data: user } = useUser(userId);
  if (!user) return null;
  const initials = getInitials(user.name);
  return (
    <>
      <Avatar className={showName ? "size-[1.125rem]" : "size-[1.125rem] shadow-[0_0_0_1px_var(--background)]"}>
        <AvatarImage src={user.avatarUrl} />
        <AvatarFallback className="text-[0.5625rem]">{initials}</AvatarFallback>
      </Avatar>
      {showName && <span className="text-sm leading-5 overflow-hidden text-ellipsis whitespace-nowrap">{user.name}</span>}
    </>
  );
}

function TaskAssigneeCell({ assigneeIds }: { assigneeIds: string[] }) {
  if (assigneeIds.length === 0) {
    return <span className="text-muted-foreground">&mdash;</span>;
  }

  if (assigneeIds.length === 1) {
    return (
      <div className="flex items-center gap-1.5">
        <AssigneeAvatar userId={assigneeIds[0]} showName />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[0.3125rem]">
      <div className="flex items-center [&>*+*]:-ml-1.5">
        {assigneeIds.slice(0, 3).map((id) => (
          <AssigneeAvatar key={id} userId={id} />
        ))}
      </div>
      {assigneeIds.length > 3 && (
        <span className="font-mono text-sm leading-4 text-muted-foreground tabular-nums">+{assigneeIds.length - 3}</span>
      )}
    </div>
  );
}

export function ModuleSection({
  module,
  projectId,
  colorIndex,
  filters,
  projectStatus,
  subProjectCount,
}: ModuleSectionProps) {
  const navigate = useNavigate();
  const { assignees, ...backendFilters } = filters ?? {};
  const { data: rawTasks, isLoading } = useTasks({ moduleId: module.id, ...backendFilters });
  const tasks = assignees && assignees.length > 0
    ? rawTasks?.filter((t) => t.assigneeIds.some((id) => assignees.includes(id)))
    : rawTasks;
  const updateTask = useUpdateTask();
  const deleteModule = useDeleteModule();
  const { data: linkedPages = [] } = usePagesByModule(module.id);
  const { data: allPages = [] } = usePages(projectId);
  const updatePage = useUpdatePage();
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [commentsTaskId, setCommentsTaskId] = useState<string | null>(null);
  const [pagesPopoverOpen, setPagesPopoverOpen] = useState(false);

  const availablePages = allPages.filter(
    (p) => !p.pageInfo.linkedTaskId && !p.pageInfo.linkedModuleId,
  );
  const { data: picUser } = useUser(module.picId);
  const { data: labels = [] } = useLabels(projectId);
  const taskIds = tasks?.map((t) => t.id) ?? [];
  const { data: commentCounts } = useCommentCounts(taskIds);
  const color = MODULE_COLORS[colorIndex % MODULE_COLORS.length];

  const taskCount = tasks?.length ?? 0;
  const doneCount = tasks?.filter((t) => t.status === "done").length ?? 0;
  const progressPct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  return (
    <>
      <Collapsible defaultOpen className="group/module">
        <div
          className="rounded-xl border border-l-4 bg-white"
          style={{ borderLeftColor: color }}
        >
          <div className="flex w-full min-w-0 overflow-hidden items-center gap-2 px-3.5 py-2.5">
            <CollapsibleTrigger className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden rounded-[calc(var(--radius)-2px)] -m-0.5 p-0.5 transition-colors hover:bg-slate-50">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/module:rotate-90" />
              <span className="font-semibold text-sm leading-5" style={{ color }}>
                {module.name}
              </span>
              <Badge variant="secondary" className="font-mono ml-0.5 text-sm leading-4 tabular-nums">
                {isLoading ? "..." : taskCount}
              </Badge>
              {subProjectCount != null && subProjectCount > 0 && (
                <Badge variant="outline" className="inline-flex items-center gap-0.5 font-mono text-xs leading-4 px-1.5 text-muted-foreground tabular-nums">
                  <FolderOpen className="size-[0.6875rem]" />
                  {subProjectCount}
                </Badge>
              )}
              {linkedPages.length > 0 && (
                <Badge variant="outline" className="inline-flex items-center gap-0.5 font-mono text-xs leading-4 px-1.5 text-muted-foreground tabular-nums">
                  <FileText className="size-[0.6875rem]" />
                  {linkedPages.length}
                </Badge>
              )}
              {module.description && (
                <span className="flex-[0_1_auto] min-w-0 max-w-[30rem] text-muted-foreground text-[0.8125rem] leading-5 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                  {module.description}
                </span>
              )}
              {!isLoading && taskCount > 0 && (
                <div className="flex items-center gap-1.5 ml-auto mr-0.5">
                  <div className="h-1 w-14 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className="font-mono text-sm text-muted-foreground tabular-nums w-6 text-right">
                    {progressPct}%
                  </span>
                </div>
              )}
              {picUser && (
                <span className="flex items-center gap-[0.3125rem] shrink-0">
                  <Avatar className="size-4">
                    <AvatarImage src={picUser.avatarUrl} />
                    <AvatarFallback className="text-[0.5625rem]">
                      {getInitials(picUser.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[0.8125rem] leading-5 text-muted-foreground font-medium whitespace-nowrap">
                    {picUser.name}
                  </span>
                </span>
              )}
            </CollapsibleTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-auto size-6 shrink-0">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditFormOpen(true)}>
                  <Pencil className="size-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPagesPopoverOpen(true)}>
                  <FileText className="size-3.5" />
                  Pages
                  {linkedPages.length > 0 && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{linkedPages.length}</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete module?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the module &quot;{module.name}&quot; and all its tasks.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleteModule.isLoading}
                    onClick={() => deleteModule.mutate(module.id)}
                  >
                    {deleteModule.isLoading ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Popover open={pagesPopoverOpen} onOpenChange={setPagesPopoverOpen}>
              <PopoverTrigger asChild>
                <span />
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <p className="text-xs font-semibold font-mono uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 mb-1">Linked Pages</p>
                {linkedPages.length > 0 && (
                  <div className="max-h-40 overflow-y-auto">
                    {linkedPages.map((page) => (
                      <div key={page.id} className="group/page flex items-center">
                        <Button
                          variant="ghost"
                          className="flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-[0.3125rem] text-[0.8125rem] bg-transparent border-none rounded-[var(--radius)] cursor-pointer text-left transition-colors hover:bg-accent"
                          onClick={() => {
                            navigate(`/projects/${projectId}/pages/${page.id}`);
                            setPagesPopoverOpen(false);
                          }}
                        >
                          <span className="text-xs shrink-0">
                            {page.pageInfo.icon || <FileText className="size-3 text-muted-foreground" />}
                          </span>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            {page.pageInfo.title || "Untitled"}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="flex items-center justify-center size-5 rounded-[var(--radius)] bg-transparent border-none cursor-pointer text-muted-foreground opacity-0 shrink-0 transition-[opacity,color] group-hover/page:opacity-100 hover:!text-destructive"
                          onClick={() =>
                            updatePage.mutate({
                              id: page.id,
                              projectId,
                              linkedModuleId: "",
                            })
                          }
                        >
                          <X className="size-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {linkedPages.length === 0 && (
                  <p className="text-[0.8125rem] text-muted-foreground text-center py-2">No pages linked</p>
                )}
                {availablePages.length > 0 && (
                  <>
                    <div className="h-px bg-border my-1.5" />
                    <p className="text-[0.6875rem] font-mono uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 mb-0.5">Link a page</p>
                    <div className="max-h-40 overflow-y-auto">
                      {availablePages.map((page) => (
                        <Button
                          variant="ghost"
                          key={page.id}
                          className="flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-[0.3125rem] text-[0.8125rem] bg-transparent border-none rounded-[var(--radius)] cursor-pointer text-left transition-colors hover:bg-accent w-full"
                          onClick={() => {
                            updatePage.mutate({
                              id: page.id,
                              projectId,
                              linkedModuleId: module.id,
                            });
                          }}
                        >
                          <span className="text-xs shrink-0">
                            {page.pageInfo.icon || <FileText className="size-3 text-muted-foreground" />}
                          </span>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            {page.pageInfo.title || "Untitled"}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <CollapsibleContent>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-8">Task</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[100px]">Priority</TableHead>
                  <TableHead className="w-[140px]">Labels</TableHead>
                  <TableHead className="w-[110px]">Start Date</TableHead>
                  <TableHead className="w-[110px]">Due Date</TableHead>
                  <TableHead className="w-[150px]">Assignee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <>
                    {[1, 2].map((i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-8">
                          <Skeleton className="h-4 w-40" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}

                {!isLoading && tasks?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-5 text-muted-foreground"
                    >
                      No tasks in this module
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading &&
                  tasks?.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      labels={labels}
                      updateTask={updateTask}
                      onNavigate={() => setSelectedTaskId(task.id)}
                      commentCount={commentCounts?.[task.id] ?? 0}
                      onOpenComments={() => setCommentsTaskId(task.id)}
                    />
                  ))}

                {!(projectStatus === "proposal" && module.name !== "Proposal") && (
                  <TableRow
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setTaskFormOpen(true)}
                  >
                    <TableCell colSpan={7} className="pl-8 py-1.5">
                      <span className="inline-flex items-center gap-0.5 text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground">
                        <Plus className="size-3.5" />
                        Add task
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <TaskForm
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        moduleId={module.id}
        projectId={projectId}
      />

      <ModuleForm
        open={editFormOpen}
        onOpenChange={setEditFormOpen}
        projectId={projectId}
        module={module}
      />

      {selectedTaskId && (
        <TaskDetail
          taskId={selectedTaskId}
          projectId={projectId}
          moduleId={module.id}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {commentsTaskId && (
        <CommentsDialog
          open={!!commentsTaskId}
          onOpenChange={(open) => !open && setCommentsTaskId(null)}
          taskId={commentsTaskId}
          projectId={projectId}
          taskTitle={tasks?.find((t) => t.id === commentsTaskId)?.title}
        />
      )}
    </>
  );
}

function InlineStatusCell({
  task,
  updateTask,
}: {
  task: Task;
  updateTask: ReturnType<typeof useUpdateTask>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "font-mono h-auto rounded-full border-transparent px-2 py-0.5 text-sm leading-4 font-medium w-fit shadow-none inline-flex items-center",
          TASK_STATUS_CONFIG[task.status].color,
        )}
      >
        {TASK_STATUS_CONFIG[task.status].label}
      </button>
      <SearchDropdown
        open={open}
        onClose={() => setOpen(false)}
        containerRef={containerRef}
        options={statusOptions}
        isSelected={(o) => o.value === task.status}
        onSelect={(o) => {
          const newStatus = o._key;
          const input: UpdateTaskInput = { status: newStatus };
          if (newStatus === "in_progress" && !task.startDate) {
            input.startDate = new Date().toISOString();
          }
          updateTask.mutate({ id: task.id, input });
          setOpen(false);
        }}
        filterLocally
        renderOption={(o) => (
          <div className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full shrink-0", STATUS_DOT_COLORS[o._key])} />
            {o.label}
          </div>
        )}
        width="w-[180px]"
      />
    </div>
  );
}

function TaskRow({
  task,
  labels,
  updateTask,
  onNavigate,
  commentCount,
  onOpenComments,
}: {
  task: Task;
  labels: Label[];
  updateTask: ReturnType<typeof useUpdateTask>;
  onNavigate: () => void;
  commentCount: number;
  onOpenComments: () => void;
}) {
  const taskLabels = labels.filter((l) => task.labelIds.includes(l.id));
  const cleanTitle = task.title.replace(/^[•·]\s*/, "");
  return (
    <TableRow
      className="cursor-pointer hover:bg-slate-50"
      onClick={onNavigate}
    >
      <TableCell className="pl-8 font-medium">
        {cleanTitle}
        {commentCount > 0 && (
          <Button
            variant="ghost"
            className="inline-flex items-center gap-0.5 ml-2 px-[0.3125rem] py-px rounded-full border-none bg-muted/50 text-muted-foreground text-xs font-mono cursor-pointer transition-colors align-middle hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => { e.stopPropagation(); onOpenComments(); }}
          >
            <MessageSquare className="size-3" />
            <span>{commentCount}</span>
          </Button>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <InlineStatusCell
          task={task}
          updateTask={updateTask}
        />
      </TableCell>
      <TableCell>
        <TaskPriorityBadge priority={task.priority} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {taskLabels.map((label) => (
            <Badge
              key={label.id}
              variant="outline"
              className="text-xs leading-4 px-1.5"
              style={{ borderColor: label.color, color: label.color }}
            >
              {label.name}
            </Badge>
          ))}
          {taskLabels.length === 0 && (
            <span className="text-muted-foreground">&mdash;</span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {task.startDate ? new Date(task.startDate).toLocaleDateString() : "\u2014"}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "\u2014"}
      </TableCell>
      <TableCell>
        <TaskAssigneeCell assigneeIds={task.assigneeIds} />
      </TableCell>
    </TableRow>
  );
}
