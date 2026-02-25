# Close Project Feature Design

## Summary

Add a "Close Project" action to the project detail page dropdown menu. Closing a project is a permanent action that marks it as successfully finished, stores the closed date, and allows attaching report files.

## Requirements

- New `"closed"` project status for successfully finished projects
- Dialog with report file uploads (any file type, reuses existing media system)
- `closedAt` date saved to database (server-side timestamp)
- Closing is permanent — no reopening
- Only `on_going` projects can be closed
- Triggered from dropdown menu in project layout header

## Data Model

### New Backend Component

`ProjectClosedAtComponent` — single string field storing ISO date of closure.

### Updated Archetype

`ProjectArcheType` gains a `closedAt` field mapped from the new component.

### Status

Add `"closed"` to frontend `ProjectStatus` type. Backend stores status as plain string — no schema migration needed.

## Backend: `closeProject` Mutation

- **Input:** `{ id: string }`
- Sets `status` to `"closed"` and `closedAt` to `new Date().toISOString()`
- Validates current status is `"on_going"`
- Returns updated `Project` archetype
- Report files uploaded separately via existing `POST /api/media/upload`

## Frontend: `CloseProjectDialog`

Follows `WinProjectDialog` pattern:

- **Trigger:** "Close Project" menu item in project layout dropdown (visible only when `status === "on_going"`)
- **Dialog contents:**
  1. Confirmation text (permanent action warning)
  2. File attachment area for report files (immediate upload on selection)
  3. Cancel + "Close Project" submit button
- **On submit:** Calls `closeProject` mutation, closes dialog on success

## UI Guards

- "New Module" button: hidden when closed (already gated on `on_going`)
- "Close Project" menu item: hidden when not `on_going`
- Task creation: disabled when project is closed
- Status badge config: `closed: { label: "Closed", color: "bg-purple-100 text-purple-700" }`

## Approach

Dedicated `closeProject` mutation (Approach A) — closing is a significant, permanent action that deserves its own explicit operation, paralleling `approveProject`.
