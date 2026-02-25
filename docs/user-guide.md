# Sedjiwa Task Management — User Guide

Welcome to Sedjiwa Task Management, a project and task management tool built for teams. This guide walks you through every feature of the application.

---

## Getting Started

### Signing In

Sedjiwa Task Management uses Single Sign-On (SSO) through the Sedjiwa Portal. When you first visit the application, you will see the landing page with a **Sign In** button.

![Landing page](images/01-landing.png)

1. Click **Sign In** to be redirected to the Sedjiwa Portal login page.
2. Enter your phone number and password.
3. After successful authentication, you will be redirected back to the **Dashboard**.

> You do not need to create a separate account — your Sedjiwa Portal credentials are used automatically.

---

## Dashboard

The Dashboard is your home screen. It provides a quick summary of your work across all projects.

![Dashboard](images/02-dashboard.png)

The dashboard includes:

- **Summary cards** — Total Tasks, In Progress, Pending Review, and Active Projects at a glance.
- **Task Overview** — A breakdown of tasks by status (Todo, In Progress, Done, etc.) with percentages.
- **New Leads** — Recent leads from the Sedjiwa Portal.
- **Active Projects** — A quick view of your ongoing projects with a link to view all.
- **Recent Tasks** — The latest tasks across all projects, showing priority, status, and when they were last updated.

---

## Sidebar Navigation

The sidebar on the left provides quick access to all areas of the application.

![Sidebar navigation](images/12-sidebar.png)

The sidebar contains:

- **Dashboard** — Return to the main overview.
- **Projects** — A collapsible section listing all your projects. Click the **+** button to create a new project.
- **Settings** — Application settings.
- **User menu** — Your name and avatar at the bottom. Click to access account options.

---

## Projects

### Browsing Projects

The Projects page lists all projects you have access to.

![Projects list](images/03-projects.png)

From this page you can:

- View all projects with their status indicators.
- Click a project name to open its detail page.
- Create a new project using the **+** button in the sidebar.

### Project Detail

The project detail page is the central hub for managing a single project.

![Project detail](images/04-project-detail.png)

At the top, you will see:

- **Project name and status** (e.g., Prospect, Active, Won).
- **Action buttons**: Delete, Timeline, Pages, Media & Files, Members, Sub-Project.

Below the header:

- **Filters** — Filter tasks by Status and Priority using the dropdown menus.
- **Search** — Search for specific tasks within the project.
- **Modules** — Tasks are organized into modules (e.g., "Proposal"). Each module shows its task count and completion percentage. Click the module header to expand or collapse it.
- **Task table** — A table listing all tasks in the module with columns for Task name, Status, Priority, Due Date, and Assignee.
- **Add task** — Click the "+ Add task" row at the bottom of any module to create a new task.

---

## Tasks

### Creating a Task

Click **+ Add task** at the bottom of any module to open the New Task dialog.

![New Task form](images/05-task-form.png)

The task form has two sections:

**Left panel — Content:**
- **Title** — Enter the task name (required).
- **Description** — A rich text editor with a full formatting toolbar: bold, italic, underline, strikethrough, inline code, highlight, subscript, superscript, headings (H1–H3), bullet lists, ordered lists, task lists, blockquotes, code blocks, horizontal rules, text alignment, and links.

**Right panel — Properties:**
- **Status** — Set the task status (Todo, In Progress, In Review, Done, Cancelled).
- **Priority** — Set priority (No priority, Low, Medium, High, Urgent).
- **Assignee** — Assign the task to a team member.
- **Labels** — Attach labels for categorization.
- **Start** — Set a start date.
- **Due** — Set a due date.

Press **Cmd+Enter** (or **Ctrl+Enter**) to quickly submit, or click **Create Task**.

### Task Detail

Click any task row to open the Task Details dialog.

![Task detail](images/06-task-detail.png)

The task detail dialog shows:

**Left panel:**
- **Title** — The task name (editable).
- **Description** — The task description with rich text formatting.
- **Comments** — A comment section where team members can discuss the task. Use `@` to mention someone. Press **Ctrl+Enter** to submit a comment.
- **Activity** — A chronological log of all changes made to the task (created, assigned, status changes, date changes, title changes, description updates, etc.).

**Right panel — Properties:**
- **Status** and **Priority** — Editable dropdowns.
- **Assignee** — Click to reassign.
- **Start** and **Due dates** — With a visual indicator showing the duration (e.g., "6 days").
- **Labels** — Add or remove labels.
- **Module** — Shows which module the task belongs to.
- **Files** — Attach files to the task.
- **Created/Updated** timestamps at the bottom.
- **Delete Task** — Permanently remove the task.

---

## Comments & Activity

### Adding Comments

In the task detail dialog, scroll down to the **Comments** section.

- Type your comment in the text box.
- Use `@` followed by a name to mention a team member — they will receive a notification.
- Press **Ctrl+Enter** to submit your comment.

### Activity Log

The **Activity** section below comments shows a complete history of task changes, including:

- Task creation
- Assignee changes
- Status and priority updates
- Date changes
- Title and description edits

Each activity entry shows what changed and when.

---

## Timeline

The Timeline view provides a Gantt-style chart of tasks across your project.

![Timeline view](images/07-timeline.png)

To open the Timeline:

1. Navigate to a project detail page.
2. Click the **Timeline** button in the project header.

The timeline displays:

- **Date grid** — A calendar grid showing days, with the current date highlighted in red.
- **Modules** — Each module is listed as a row. Tasks with start and due dates appear as bars on the timeline.
- **Back button** — Click **Back** to return to the project detail.

Use the timeline to visualize task schedules and identify scheduling conflicts.

---

## Pages

Pages are project wiki-style documents for notes, documentation, and shared knowledge.

### Pages List

![Pages list](images/08-pages.png)

To access pages:

1. Navigate to a project detail page.
2. Click the **Pages** button in the project header.

The pages list shows:

- All pages with their titles and emoji icons.
- Last edited information (who edited and when).
- A **Search pages** box to filter pages.
- A **New Page** button to create a new page.
- Drag handles to reorder pages.

### Page Editor

Click any page to open the editor.

![Page editor](images/09-page-editor.png)

The page editor features:

- **Title** — Click the title to edit it. Click the icon next to the title to choose an emoji.
- **Rich text editor** — The same powerful editor used in task descriptions, with a full formatting toolbar: bold, italic, underline, strikethrough, inline code, highlight, subscript, superscript, headings, lists, blockquotes, code blocks, horizontal rules, text alignment, and links.
- **Auto-save** — Changes are saved automatically.
- **Last edited** — Shows who last edited the page and when.
- **Delete** — Click the red **Delete** button in the top-right to remove the page.
- **Back to Pages** — Click the back arrow to return to the pages list.

---

## Media & Files

The Media & Files section lets you manage file attachments for a project.

![Media & Files](images/10-media.png)

To access Media & Files:

1. Navigate to a project detail page.
2. Click the **Media & Files** button in the project header.

Features include:

- **Upload files** — Drag and drop files or click to upload.
- **File grid** — View uploaded files in a visual grid layout.
- **Empty state** — When no files have been uploaded, you will see a prompt to get started.

Files can also be attached directly to individual tasks from the task detail dialog.

---

## Notifications

The notification bell in the top-right corner keeps you informed about important updates.

![Notifications](images/11-notifications.png)

Click the bell icon to open the notifications dropdown. The badge shows the number of unread notifications.

Notification types include:

- **Mentions** — When someone mentions you in a comment (e.g., "mentioned you in a comment on 'A'").
- **Assignments** — When a task is assigned to you (e.g., "assigned you to 'This Is One'").

Actions:

- Click a notification to navigate to the relevant task.
- Click **Mark all read** to clear the unread badge.
- Unread notifications are indicated with a blue dot.

---

## Labels

Labels help you categorize and filter tasks across your project.

To manage labels:

1. Open a task (either the new task form or a task detail).
2. Click the **Labels** dropdown in the properties panel.
3. Select existing labels or create new ones.

Labels appear as colored tags on tasks, making it easy to visually identify task categories.

---

## Project Members

Manage who has access to your project through the Members feature.

To manage members:

1. Navigate to a project detail page.
2. Click the **Members** button in the project header.

From the members panel you can:

- View all current project members.
- Add new members from your organization.
- Remove members from the project.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Enter` | Submit a new task or comment |
| `@` in comments | Mention a team member |
| `Escape` | Close dialogs |
| `Alt + T` | Toggle notifications |

---

## Tips & Tricks

- **Quick task creation** — Click "+ Add task" in any module and type a title to quickly add tasks.
- **Status updates** — Change task status directly from the task table by clicking the status dropdown — no need to open the task detail.
- **Search** — Use the global search bar in the top header to find tasks across all projects.
- **Breadcrumbs** — Use the breadcrumb navigation at the top to quickly move between Projects and Project details.
