// Display labels for the activity summary — shared by the on-screen summary
// and the Excel export so both name a change the same way.

export const ENTITY_LABEL: Record<string, string> = {
  task: "Task",
  module: "Module",
  membership: "Membership",
  ownership: "Ownership",
  page: "Page",
  media: "Media",
  other: "Other",
};

export const ACTION_LABEL: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  other: "changed",
};
