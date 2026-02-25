# Features

## Authentication
- OIDC-based login via external provider
- Role-based access: **Manager** vs **Member**
- Auto-redirect for unauthenticated users

## Dashboard
- Stats overview: total tasks, in progress, pending review, active projects
- Task distribution chart (by status)
- Active projects with progress indicators
- Recent tasks list
- **New leads approval** (manager-only) — approve projects from Core Portal

## Projects
- Create, edit, delete projects
- Project statuses: `pending` → `prospect` → `win` → `on_going` / `canceled`
- **Sub-projects** (parent-child hierarchy, cascade delete)
- **Project members** management (add/remove users)
- **PIC (Person In Charge)** assignment
- Progress tracking (% task completion)
- Approve leads & mark project as WIN

## Modules
- Create, edit, delete modules within a project
- Group tasks by module
- 8 distinct color options

## Tasks
- Full CRUD with: title, description (rich text), status, priority, start/due dates
- **6 statuses**: backlog, todo, in_progress, in_review, done, cancelled
- **5 priorities**: none, low, medium, high, urgent
- Multiple **assignees** per task
- Multiple **labels** per task
- **Drag-and-drop reorder** within modules
- Filter by status, priority, search text

## Timeline (Gantt)
- Gantt chart visualization of tasks by date
- Scrollable horizontal timeline grid

## Pages (Wiki/Documentation)
- Create, edit, delete pages per project
- Rich text editor with auto-save
- Emoji/icon picker per page
- Drag-and-drop page reordering
- Tracks last edited by

## Media & Files
- Upload files to project (optionally linked to a task)
- Grid view or table view toggle
- Filter by MIME type and task
- S3-compatible storage backend
- Download and delete files

## Comments
- Add, edit, delete comments on tasks
- Rich text support
- **@mention users** (triggers notifications)
- Only author can edit/delete

## Activity Log
- Full audit trail per task
- Tracks: created, updated, deleted actions
- Records field-level changes with before/after values

## Notifications
- Real-time unread count (polls every 30s)
- Types: task assignment, mentions
- Mark individual or all as read
- Toast on new notifications

## Labels
- Create, edit, delete labels per project
- Custom name + color

## Users
- User search (from OIDC provider)
- Set user role (manager-only)
- Auto-sync from OIDC claims

## Settings
- Placeholder page (not yet implemented)
