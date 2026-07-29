// Users feature barrel — directory reads shared across features (pickers, owner
// resolution). Admin CRUD lands in the dedicated users/admin flow.

export { useUserDirectory, useUserMap } from "./api/hooks";
export type { AppUser } from "@/features/auth";
