// Users feature barrel — directory reads shared across features (pickers, owner
// resolution) plus the admin management page behind /admin/users.

export {
  useUserDirectory,
  useUserMap,
  useUsersPage,
  USERS_PAGE_SIZE,
  useActivateUser,
  useSuspendUser,
  useSetAdmin,
} from "./api/hooks";
export { ManageUsersPage } from "./components/manage-users-page";
export type { AppUser } from "@/features/auth";
