import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskActivityTimeline } from "./task-activity-timeline";
import { AddCommentForm } from "./task-comments";

interface CommentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  projectId: string;
  taskTitle?: string;
}

export function CommentsDialog({
  open,
  onOpenChange,
  taskId,
  projectId,
  taskTitle,
}: CommentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[40rem] max-h-[80vh] flex flex-col overflow-hidden p-6 gap-4 rounded-2xl">
        <DialogHeader>
          <DialogTitle>{taskTitle ? `Comments — ${taskTitle}` : "Comments"}</DialogTitle>
          <DialogDescription className="sr-only">
            Comments and activity for {taskTitle ?? "this task"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <div className="flex-1 overflow-y-auto pr-1">
            <TaskActivityTimeline taskId={taskId} projectId={projectId} />
          </div>
          <div className="shrink-0 border-t border-border pt-4">
            <AddCommentForm taskId={taskId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
