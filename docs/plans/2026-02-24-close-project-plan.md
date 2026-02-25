# Close Project Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Close Project" action to permanently mark on_going projects as finished, with report file uploads and a server-side closed date.

**Architecture:** New `ProjectClosedAtComponent` + `closeProject` GraphQL mutation on the backend. New `CloseProjectDialog` component on the frontend following the `WinProjectDialog` pattern. Files uploaded via existing media system.

**Tech Stack:** Bun + Bunsane (backend), React 19 + Apollo Client + CSS Modules (frontend)

---

### Task 1: Backend — Add `ProjectClosedAtComponent`

**Files:**
- Modify: `apps/backend/src/components/ProjectComponents.ts`

**Step 1: Add the new component**

Add after `ProjectResolvedStatusComponent` (line 84):

```typescript
@Component
export class ProjectClosedAtComponent extends BaseComponent {
  @CompData()
  value: string = "";
}
```

**Step 2: Commit**

```bash
git add apps/backend/src/components/ProjectComponents.ts
git commit -m "feat(backend): add ProjectClosedAtComponent"
```

---

### Task 2: Backend — Register `closedAt` field on `ProjectArcheType`

**Files:**
- Modify: `apps/backend/src/archetypes/ProjectArcheType.ts`

**Step 1: Import the new component**

Add `ProjectClosedAtComponent` to the import from `~/components/ProjectComponents`.

**Step 2: Add the archetype field**

Add after the `resolvedStatus` field (line 60):

```typescript
  @ArcheTypeField(ProjectClosedAtComponent, { nullable: true })
  closedAt!: ProjectClosedAtComponent;
```

**Step 3: Commit**

```bash
git add apps/backend/src/archetypes/ProjectArcheType.ts
git commit -m "feat(backend): add closedAt field to ProjectArcheType"
```

---

### Task 3: Backend — Add `closeProject` mutation to `ProjectService`

**Files:**
- Modify: `apps/backend/src/services/ProjectService.ts`

**Step 1: Import `ProjectClosedAtComponent`**

Add `ProjectClosedAtComponent` to the existing import from `~/components/ProjectComponents`.

**Step 2: Add the `closeProject` mutation**

Add before the `deleteProject` method (before line 436):

```typescript
  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: ProjectArcheType,
  })
  async closeProject(input: { id: string }, context: { request?: Request }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Project not found");

    const statusComp = await entity.get(ProjectStatusComponent);
    if (statusComp?.value !== "on_going") {
      throw new Error("Only on_going projects can be closed");
    }

    await entity.set(ProjectStatusComponent, { value: "closed" });
    await entity.set(ProjectClosedAtComponent, { value: new Date().toISOString() });
    await entity.save();

    // Enrich with Core data
    const coreRef = await entity.get(ProjectCoreRefComponent);
    if (coreRef?.value) {
      const authToken = extractAuthToken(context.request);
      const coreData = await fetchCoreProject(coreRef.value, authToken);
      enrichEntity(entity, coreData, "closed");
    } else {
      enrichEntity(entity, null, "closed");
    }

    return entity;
  }
```

**Step 3: Verify backend compiles**

Run: `cd apps/backend && bun run build`

**Step 4: Commit**

```bash
git add apps/backend/src/services/ProjectService.ts
git commit -m "feat(backend): add closeProject mutation"
```

---

### Task 4: Frontend — Add `"closed"` to `ProjectStatus` type and config

**Files:**
- Modify: `apps/frontend/src/types/project.ts`

**Step 1: Add `"closed"` to the `ProjectStatus` union**

Change line 1 from:
```typescript
export type ProjectStatus = "pending" | "prospect" | "win" | "won" | "on_going" | "canceled";
```
to:
```typescript
export type ProjectStatus = "pending" | "prospect" | "win" | "won" | "on_going" | "canceled" | "closed";
```

**Step 2: Add `closedAt` to the `Project` interface**

Add after `resolvedStatus` field (after line 28):
```typescript
    closedAt?: string;
```

**Step 3: Add `closed` entry to `PROJECT_STATUS_CONFIG`**

Add after the `canceled` entry (after line 67):
```typescript
    closed: { label: "Closed", color: "bg-purple-100 text-purple-700" },
```

**Step 4: Commit**

```bash
git add apps/frontend/src/types/project.ts
git commit -m "feat(frontend): add closed status to ProjectStatus type"
```

---

### Task 5: Frontend — Add `closedAt` to GraphQL fragment and hooks

**Files:**
- Modify: `apps/frontend/src/hooks/use-projects.ts`

**Step 1: Add `closedAt` to `PROJECT_FIELDS` fragment**

Add after `resolvedStatus { value }` (after line 45):
```graphql
    closedAt {
      value
    }
```

**Step 2: Add `closedAt` to `ProjectRaw` interface**

Add after `resolvedStatus` (after line 63):
```typescript
  closedAt?: { value: string };
```

**Step 3: Add `closedAt` mapping to `mapProject` function**

Add after `resolvedStatus` mapping (after line 80):
```typescript
    closedAt: raw.closedAt?.value,
```

**Step 4: Add `CLOSE_PROJECT` mutation and `useCloseProject` hook**

Add the mutation after `DELETE_PROJECT` (after line 124):
```typescript
const CLOSE_PROJECT = gql`
  ${PROJECT_FIELDS}
  mutation CloseProject($input: closeProjectInput!) {
    closeProject(input: $input) {
      ...ProjectFields
    }
  }
`;
```

Add the hook after `useDeleteProject` (after line 172):
```typescript
export const useCloseProject = createMutationHook<
  { id: string },
  ProjectRaw,
  Project
>({
  mutation: CLOSE_PROJECT,
  responseKey: "closeProject",
  mapResponse: mapProject,
  refetchQueries: [LIST_PROJECTS, GET_PROJECT],
});
```

**Step 5: Verify frontend type-checks**

Run: `cd apps/frontend && bun run tsc --noEmit`

**Step 6: Commit**

```bash
git add apps/frontend/src/hooks/use-projects.ts
git commit -m "feat(frontend): add closeProject mutation hook and closedAt field"
```

---

### Task 6: Frontend — Add `dotClosed` CSS class to project layout

**Files:**
- Modify: `apps/frontend/src/pages/project-layout.module.css`
- Modify: `apps/frontend/src/pages/project-layout.tsx`

**Step 1: Add `.dotClosed` style**

Add after `.dotCanceled` (after line 73) in `project-layout.module.css`:
```css
.dotClosed {
  background-color: #a855f7;
}
```

**Step 2: Add `closed` to `DOT_CLASS` map**

In `project-layout.tsx`, add after the `canceled` entry (after line 64):
```typescript
  closed: styles.dotClosed,
```

**Step 3: Commit**

```bash
git add apps/frontend/src/pages/project-layout.module.css apps/frontend/src/pages/project-layout.tsx
git commit -m "feat(frontend): add closed status dot color"
```

---

### Task 7: Frontend — Create `CloseProjectDialog` component

**Files:**
- Create: `apps/frontend/src/components/projects/close-project-dialog.tsx`
- Create: `apps/frontend/src/components/projects/close-project-dialog.module.css`

**Step 1: Create the CSS module**

Create `apps/frontend/src/components/projects/close-project-dialog.module.css`:

```css
.dialogContent {
  max-width: 32rem;
}

@media (min-width: 640px) {
  .dialogContent {
    max-width: 32rem;
  }
}

.warningText {
  font-size: 0.875rem;
  line-height: 1.375rem;
  color: var(--muted-foreground);
}

.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.875rem;
  padding-bottom: 0.875rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.attachmentRow {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.attachmentRow:hover .removeButton {
  opacity: 1;
}

.attachmentIconPurple {
  width: 0.875rem;
  height: 0.875rem;
  color: #a855f7;
}

.attachmentIconRed {
  width: 0.875rem;
  height: 0.875rem;
  color: #ef4444;
}

.attachmentIconDefault {
  width: 0.875rem;
  height: 0.875rem;
  color: var(--muted-foreground);
}

.fileName {
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.fileSize {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--muted-foreground);
  flex-shrink: 0;
}

.removeButton {
  width: 1.125rem;
  height: 1.125rem;
  opacity: 0;
  flex-shrink: 0;
}

.removeIcon {
  width: 0.75rem;
  height: 0.75rem;
}

.attachButton {
  height: 1.5rem;
  font-size: 0.875rem;
  line-height: 1rem;
  width: 100%;
  justify-content: flex-start;
  color: var(--muted-foreground);
}

.attachIcon {
  width: 0.75rem;
  height: 0.75rem;
  margin-right: 0.25rem;
}

.hiddenInput {
  display: none;
}

.closeButton {
  background-color: #7c3aed;
  color: white;
}

.closeButton:hover {
  background-color: #6d28d9;
}
```

**Step 2: Create the component**

Create `apps/frontend/src/components/projects/close-project-dialog.tsx`:

```tsx
import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCloseProject } from "@/hooks/use-projects";
import { useMediaFiles, useUploadMedia, useDeleteMedia } from "@/hooks/use-media";
import { isImage, formatFileSize } from "@/types/media";
import type { Project } from "@/types/project";
import { FileText, ImageIcon, File, Plus, X } from "lucide-react";
import styles from "./close-project-dialog.module.css";

interface CloseProjectDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className={styles.attachmentIconPurple} />;
  if (mimeType === "application/pdf")
    return <FileText className={styles.attachmentIconRed} />;
  return <File className={styles.attachmentIconDefault} />;
}

export function CloseProjectDialog({
  project,
  open,
  onOpenChange,
}: CloseProjectDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeProject = useCloseProject();

  const { data: files = [] } = useMediaFiles({ projectId: project.id });
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      await uploadMedia.mutateAsync({ file, projectId: project.id });
    }
    e.target.value = "";
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closeProject.mutate(
      { id: project.id },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Close Project</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <p className={styles.warningText}>
              This will permanently close the project. Closed projects cannot be
              reopened, and no new modules or tasks can be created.
            </p>
            <div className={styles.field}>
              <Label>Report Files</Label>
              {files.map((file) => (
                <div key={file.id} className={styles.attachmentRow}>
                  <AttachmentIcon mimeType={file.mediaFileInfo.mimeType} />
                  <span
                    className={styles.fileName}
                    title={file.mediaFileInfo.originalFileName}
                  >
                    {file.mediaFileInfo.originalFileName}
                  </span>
                  <span className={styles.fileSize}>
                    {formatFileSize(file.mediaFileInfo.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={styles.removeButton}
                    onClick={() => deleteMedia.mutate(file.id)}
                  >
                    <X className={styles.removeIcon} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={styles.attachButton}
                onClick={() => inputRef.current?.click()}
              >
                <Plus className={styles.attachIcon} />
                Attach report file
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className={styles.hiddenInput}
                onChange={handleFileSelect}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className={styles.closeButton}
              disabled={closeProject.isLoading}
            >
              {closeProject.isLoading ? "Closing..." : "Close Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Verify type-checks**

Run: `cd apps/frontend && bun run tsc --noEmit`

**Step 4: Commit**

```bash
git add apps/frontend/src/components/projects/close-project-dialog.tsx apps/frontend/src/components/projects/close-project-dialog.module.css
git commit -m "feat(frontend): add CloseProjectDialog component"
```

---

### Task 8: Frontend — Integrate `CloseProjectDialog` into project layout

**Files:**
- Modify: `apps/frontend/src/pages/project-layout.tsx`

**Step 1: Import the dialog and icon**

Add to imports:
```typescript
import { CloseProjectDialog } from "@/components/projects/close-project-dialog";
import { Lock } from "lucide-react";
```

Note: `Lock` icon from lucide-react — add it to the existing lucide-react import.

**Step 2: Add state for the close dialog**

Add after `deleteDialogOpen` state (after line 86):
```typescript
const [closeDialogOpen, setCloseDialogOpen] = useState(false);
```

**Step 3: Add "Close Project" menu item to dropdown**

Add after the WIN menu item block and before `<DropdownMenuSeparator />` (before line 219):
```tsx
{project.status.value === "on_going" && (
  <DropdownMenuItem
    className={styles.closeItem}
    onClick={() => setCloseDialogOpen(true)}
  >
    <Lock className={styles.menuIcon} />
    Close Project
  </DropdownMenuItem>
)}
```

**Step 4: Add the dialog component**

Add after the `ProjectMembersDialog` (after line 363):
```tsx
{project.status.value === "on_going" && (
  <CloseProjectDialog
    project={project}
    open={closeDialogOpen}
    onOpenChange={setCloseDialogOpen}
  />
)}
```

**Step 5: Add `.closeItem` CSS**

Add to `apps/frontend/src/pages/project-layout.module.css` after `.winItem:focus` (after line 408):
```css
.closeItem {
  color: #7c3aed;
}

.closeItem:focus {
  color: #7c3aed;
}
```

**Step 6: Verify type-checks**

Run: `cd apps/frontend && bun run tsc --noEmit`

**Step 7: Commit**

```bash
git add apps/frontend/src/pages/project-layout.tsx apps/frontend/src/pages/project-layout.module.css
git commit -m "feat(frontend): integrate CloseProjectDialog into project layout"
```

---

### Task 9: Final verification

**Step 1: Backend build**

Run: `cd apps/backend && bun run build`
Expected: Successful build with no errors.

**Step 2: Frontend type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: No new errors (pre-existing errors in subtask components are acceptable).

**Step 3: Frontend lint**

Run: `cd apps/frontend && bun run lint`
Expected: No new errors.

**Step 4: Backend lint**

Run: `cd apps/backend && bun run lint`
Expected: No new errors.
