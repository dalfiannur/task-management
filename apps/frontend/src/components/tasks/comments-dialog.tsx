import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskActivityTimeline } from "./task-activity-timeline";
import { AddCommentForm } from "./task-comments";
import styles from "./comments-dialog.module.css";

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
      <DialogContent className={styles.dialogContent}>
        <DialogHeader>
          <DialogTitle>{taskTitle ? `Comments — ${taskTitle}` : "Comments"}</DialogTitle>
          <DialogDescription className="sr-only">
            Comments and activity for {taskTitle ?? "this task"}
          </DialogDescription>
        </DialogHeader>
        <div className={styles.body}>
          <div className={styles.timelineScroll}>
            <TaskActivityTimeline taskId={taskId} projectId={projectId} />
          </div>
          <div className={styles.inputArea}>
            <AddCommentForm taskId={taskId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
