import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import { TASK_PRIORITIES, TASK_PRIORITY_CONFIG, type TaskPriority } from "@/features/tasks";
import { draftToProto } from "../api/mappers";
import { useCreateAutomation, useUpdateAutomation } from "../api/hooks";
import {
  MAX_ACTIONS,
  type Action,
  type ActionKind,
  type AutomationDraft,
  type Conditions,
  type Trigger,
  type TriggerKind,
} from "../types";
import type { Vocab } from "./use-vocab";

const ANY = "__any";
const CREATOR = "__creator";

const TRIGGERS: { kind: TriggerKind; label: string }[] = [
  { kind: "status_changed", label: "Status changes" },
  { kind: "task_created", label: "A task is created" },
  { kind: "assignee_added", label: "Someone is assigned" },
  { kind: "subtasks_done", label: "All subtasks are done" },
  { kind: "overdue", label: "A task becomes overdue" },
  { kind: "due_in", label: "A task is due within…" },
];

const ACTIONS: { kind: ActionKind; label: string }[] = [
  { kind: "set_status", label: "Set status" },
  { kind: "set_priority", label: "Set priority" },
  { kind: "add_label", label: "Add label" },
  { kind: "remove_label", label: "Remove label" },
  { kind: "assign", label: "Assign" },
  { kind: "unassign_all", label: "Unassign everyone" },
  { kind: "move_to_module", label: "Move to module" },
  { kind: "set_due_in", label: "Set due date" },
  { kind: "notify", label: "Send a notification" },
  { kind: "comment", label: "Add a comment" },
];

function blankTrigger(kind: TriggerKind): Trigger {
  if (kind === "status_changed") return { kind };
  if (kind === "due_in") return { kind, days: 2 };
  return { kind };
}

function blankAction(kind: ActionKind): Action {
  switch (kind) {
    case "set_status":
      return { kind, statusId: "" };
    case "set_priority":
      return { kind, priority: "high" };
    case "add_label":
    case "remove_label":
      return { kind, labelId: "" };
    case "assign":
      return { kind, userId: "" };
    case "unassign_all":
      return { kind };
    case "move_to_module":
      return { kind, moduleId: "" };
    case "set_due_in":
      return { kind, days: 1 };
    case "notify":
      return { kind, target: "assignees", userId: "", message: "" };
    case "comment":
      return { kind, text: "" };
  }
}

/** Why an action cannot be saved yet, or null. */
function actionProblem(a: Action): string | null {
  switch (a.kind) {
    case "set_status":
      return a.statusId ? null : "pick a status";
    case "add_label":
    case "remove_label":
      return a.labelId ? null : "pick a label";
    case "move_to_module":
      return a.moduleId ? null : "pick a module";
    case "set_due_in":
      return a.days >= 0 && a.days <= 365 ? null : "0–365 days";
    case "notify":
      if (a.target === "user" && !a.userId) return "pick a person";
      return a.message.trim() ? null : "write a message";
    case "comment":
      return a.text.trim() ? null : "write the comment";
    default:
      return null;
  }
}

function Pick({
  value,
  onChange,
  options,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={cn("h-8", className ?? "w-44")} aria-label={label}>
        <SelectValue placeholder={placeholder ?? "Choose…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Chips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:bg-accent",
              )}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <Input.Root className="w-20" aria-invalid={value < min || value > max || undefined}>
      <Input.Field
        type="number"
        min={min}
        max={max}
        aria-label={label}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </Input.Root>
  );
}

function ActionRow({
  action,
  vocab,
  onChange,
  onRemove,
}: {
  action: Action;
  vocab: Vocab;
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  const priorities = TASK_PRIORITIES.map((p) => ({ id: p, name: TASK_PRIORITY_CONFIG[p].label }));
  const params = (() => {
    switch (action.kind) {
      case "set_status":
        return (
          <Pick label="Status" value={action.statusId} options={vocab.statuses}
            onChange={(v) => onChange({ ...action, statusId: v })} />
        );
      case "set_priority":
        return (
          <Pick label="Priority" value={action.priority} options={priorities}
            onChange={(v) => onChange({ ...action, priority: v as TaskPriority })} />
        );
      case "add_label":
      case "remove_label":
        return (
          <Pick label="Label" value={action.labelId} options={vocab.labels}
            placeholder={vocab.labels.length ? "Choose…" : "No labels yet"}
            onChange={(v) => onChange({ ...action, labelId: v })} />
        );
      case "assign":
        return (
          <Pick label="Person" value={action.userId || CREATOR}
            options={[{ id: CREATOR, name: "The task's creator" }, ...vocab.members]}
            onChange={(v) => onChange({ ...action, userId: v === CREATOR ? "" : v })} />
        );
      case "move_to_module":
        return (
          <Pick label="Module" value={action.moduleId} options={vocab.modules}
            onChange={(v) => onChange({ ...action, moduleId: v })} />
        );
      case "set_due_in":
        return (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <NumberField label="Days from then" value={action.days} min={0} max={365}
              onChange={(n) => onChange({ ...action, days: n })} />
            days from when it runs
          </span>
        );
      case "notify":
        return (
          <div className="flex w-full flex-wrap items-center gap-2">
            <Pick label="Recipients" value={action.target} className="w-40"
              options={[
                { id: "assignees", name: "The assignees" },
                { id: "owner", name: "The project owner" },
                { id: "user", name: "A person…" },
              ]}
              onChange={(v) => onChange({ ...action, target: v as typeof action.target })} />
            {action.target === "user" && (
              <Pick label="Person" value={action.userId} options={vocab.members}
                onChange={(v) => onChange({ ...action, userId: v })} />
            )}
            <Input.Root className="min-w-48 flex-1">
              <Input.Field aria-label="Message" placeholder="Message" maxLength={500}
                value={action.message} onChange={(e) => onChange({ ...action, message: e.target.value })} />
            </Input.Root>
          </div>
        );
      case "comment":
        return (
          <Input.Root className="min-w-48 flex-1">
            <Input.Field aria-label="Comment" placeholder="Comment text" maxLength={500}
              value={action.text} onChange={(e) => onChange({ ...action, text: e.target.value })} />
          </Input.Root>
        );
      default:
        return null;
    }
  })();
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <Pick label="Action" value={action.kind} options={ACTIONS.map((a) => ({ id: a.kind, name: a.label }))}
        onChange={(v) => onChange(blankAction(v as ActionKind))} />
      {params}
      <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7"
        aria-label="Remove action" onClick={onRemove}>
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}

/** Create or edit a rule as "When … if … then …". */
export function AutomationDialog({
  projectId,
  vocab,
  editingId,
  initial,
  open,
  onOpenChange,
}: {
  projectId: string;
  vocab: Vocab;
  /** Set when editing an existing rule. */
  editingId?: string;
  initial: AutomationDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const [draft, setDraft] = useState<AutomationDraft>(initial);
  const [seed, setSeed] = useState(initial);
  // Re-seed whenever a different rule or preset is opened.
  if (seed !== initial) {
    setSeed(initial);
    setDraft(initial);
  }
  const pending = create.isPending || update.isPending;
  const t = draft.trigger;
  const setTrigger = (trigger: Trigger) => setDraft({ ...draft, trigger });
  const setConditions = (c: Partial<Conditions>) =>
    setDraft({ ...draft, conditions: { ...draft.conditions, ...c } });
  const setAction = (i: number, a: Action) =>
    setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  const problems = [
    !draft.name.trim() && "Name the rule.",
    t.kind === "due_in" && !(t.days >= 1 && t.days <= 30) && "'Due within' takes 1–30 days.",
    draft.actions.length === 0 && "Add at least one action.",
    ...draft.actions.map((a, i) => {
      const p = actionProblem(a);
      return p && `Action ${i + 1}: ${p}.`;
    }),
  ].filter(Boolean) as string[];

  function save() {
    if (problems.length) return;
    const body = draftToProto(draft);
    const done = {
      onSuccess: () => {
        toast.success(editingId ? "Automation saved." : "Automation created.");
        onOpenChange(false);
      },
      onError: (e: { message: string }) => toast.error(e.message || "Failed to save"),
    };
    if (editingId) update.mutate({ id: editingId, projectId, ...body }, done);
    else create.mutate({ projectId, enabled: true, ...body }, done);
  }

  const statusOpts = [{ id: ANY, name: "Any status" }, ...vocab.statuses];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>
            Runs as you, right after the change that triggers it. Overdue and due-soon
            rules are checked every 15 minutes, once per task and due date.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="automation-name">Name</Label>
            <Input.Root>
              <Input.Field id="automation-name" maxLength={80} value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Done → unassign" />
            </Input.Root>
          </div>

          <section className="space-y-2">
            <h3 className="text-label">When</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Pick label="Trigger" className="w-52" value={t.kind}
                options={TRIGGERS.map((x) => ({ id: x.kind, name: x.label }))}
                onChange={(v) => setTrigger(blankTrigger(v as TriggerKind))} />
              {t.kind === "status_changed" && (
                <>
                  <span className="text-sm text-muted-foreground">from</span>
                  <Pick label="From status" value={t.fromStatusId || ANY} options={statusOpts}
                    onChange={(v) => setTrigger({ ...t, fromStatusId: v === ANY ? undefined : v })} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Pick label="To status" value={t.toStatusId || ANY} options={statusOpts}
                    onChange={(v) => setTrigger({ ...t, toStatusId: v === ANY ? undefined : v })} />
                </>
              )}
              {t.kind === "due_in" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <NumberField label="Days" value={t.days} min={1} max={30}
                    onChange={(n) => setTrigger({ ...t, days: n })} />
                  days
                </span>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-label">If (optional)</h3>
            <p className="text-xs text-muted-foreground">
              Pick none to run on every task. Within a row any choice matches; across rows all must.
            </p>
            <Chips label="Priority" selected={draft.conditions.priorities}
              options={TASK_PRIORITIES.map((p) => ({ id: p, name: TASK_PRIORITY_CONFIG[p].label }))}
              onChange={(ids) => setConditions({ priorities: ids as TaskPriority[] })} />
            <Chips label="Label" options={vocab.labels} selected={draft.conditions.labelIds}
              onChange={(ids) => setConditions({ labelIds: ids })} />
            <Chips label="Module" options={vocab.modules} selected={draft.conditions.moduleIds}
              onChange={(ids) => setConditions({ moduleIds: ids })} />
          </section>

          <section className="space-y-2">
            <h3 className="text-label">Then</h3>
            <ul className="space-y-2">
              {draft.actions.map((a, i) => (
                <ActionRow key={i} action={a} vocab={vocab}
                  onChange={(next) => setAction(i, next)}
                  onRemove={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })} />
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm"
              disabled={draft.actions.length >= MAX_ACTIONS}
              onClick={() => setDraft({ ...draft, actions: [...draft.actions, blankAction("set_priority")] })}>
              <Plus className="mr-1 h-4 w-4" />
              Add action
            </Button>
          </section>

          {problems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground" aria-live="polite">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || problems.length > 0}>
              {pending ? "Saving…" : editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
