import { useQuery, useMutation, gql } from "@/lib/graphql-client";

export interface AdminUser {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
  createdAt: string | null;
  lastLoginAt: string | null;
}

const LIST_USERS = gql`query ListUsers($input: listUsersInput!) { listUsers(input: $input) }`;
const CREATE_USER = gql`mutation CreateUser($input: createUserInput!) { createUser(input: $input) }`;
const ACTIVATE_USER = gql`mutation ActivateUser($input: activateUserInput!) { activateUser(input: $input) }`;
const SUSPEND_USER = gql`mutation SuspendUser($input: suspendUserInput!) { suspendUser(input: $input) }`;
const SET_ADMIN = gql`mutation SetAdmin($input: setAdminInput!) { setAdmin(input: $input) }`;
const RESET_PASSWORD = gql`mutation ResetPassword($input: resetPasswordInput!) { resetPassword(input: $input) }`;
const DELETE_USER = gql`mutation DeleteUser($input: deleteUserInput!) { deleteUser(input: $input) }`;

export function useAdminUsers(status?: string) {
  const { data, loading, error, refetch } = useQuery<{ listUsers: AdminUser[] }>(LIST_USERS, {
    variables: { input: { status } },
    fetchPolicy: "cache-and-network",
  });
  return { users: data?.listUsers ?? [], isLoading: loading, error: error ?? null, refetch };
}

export function useUserAdminActions() {
  const [createUser] = useMutation(CREATE_USER);
  const [activateUser] = useMutation(ACTIVATE_USER);
  const [suspendUser] = useMutation(SUSPEND_USER);
  const [setAdmin] = useMutation(SET_ADMIN);
  const [resetPassword] = useMutation(RESET_PASSWORD);
  const [deleteUser] = useMutation(DELETE_USER);
  return { createUser, activateUser, suspendUser, setAdmin, resetPassword, deleteUser };
}
