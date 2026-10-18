import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "sedjiwa-ui";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { useCreateProject, useTemplateProjects } from "../api/hooks";

const BLANK = "blank";

/**
 * Create-project dialog → navigates to the new project's detail on success.
 * "Start from" copies a template's statuses, labels, modules and tasks; a
 * start date moves every copied date along with it.
 */
export function CreateProjectDialog({
  source,
  trigger,
}: {
  /** Preselect this project as the starting point (e.g. "Use template"). */
  source?: { id: string; name: string };
  trigger?: ReactNode;
}) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState(source?.id ?? BLANK);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const { templates } = useTemplateProjects(open);

  // The preselected source may be a plain project, not in the templates list.
  const options =
    source && !templates.some((t) => t.id === source.id)
      ? [{ id: source.id, name: source.name }, ...templates]
      : templates;
  const fromTemplate = sourceId !== BLANK;

  function reset() {
    setName("");
    setDescription("");
    setSourceId(source?.id ?? BLANK);
    setStartDate(undefined);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        fromProjectId: fromTemplate ? sourceId : undefined,
        startDate: fromTemplate && startDate ? format(startDate, "yyyy-MM-dd") : undefined,
      },
      {
        onSuccess: (project) => {
          setOpen(false);
          reset();
          navigate({
            to: "/projects/$projectId/all-tasks",
            params: { projectId: project.id },
          });
        },
        onError: (err) => toast.error(err.message || "Failed to create project"),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1 h-4 w-4" />
            New project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            You become the owner. Members and tasks come next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {(options.length > 0 || source) && (
            <div className="space-y-2">
              <Label htmlFor="project-source">Start from</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="project-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK}>Blank project</SelectItem>
                  {options.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fromTemplate && (
                <p className="text-xs text-muted-foreground">
                  Copies its statuses, labels, modules and tasks (with subtasks,
                  estimates and dependencies). Assignees, comments and time are not
                  copied.
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input.Root>
              <Input.Field
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </Input.Root>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {fromTemplate && (
            <div className="space-y-2">
              <Label>Start date</Label>
              <DatePickerField
                value={startDate}
                onChange={setStartDate}
                placeholder="Keep the template's dates"
              />
              <p className="text-xs text-muted-foreground">
                Task dates move so the copy starts on this day.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
