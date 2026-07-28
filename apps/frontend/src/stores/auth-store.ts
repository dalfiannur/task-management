// apps/frontend/src/stores/auth-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { client, gql, setAuthToken } from "@/lib/graphql-client";

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
}

const LOGIN = gql`mutation Login($input: loginInput!) { login(input: $input) }`;
const REGISTER = gql`mutation Register($input: registerInput!) { register(input: $input) }`;

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAdmin: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, displayName: string) => Promise<AuthUser>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAdmin: false,
      async login(phone, password) {
        const { data } = await client.mutate({ mutation: LOGIN, variables: { input: { phone, password } } });
        const { token, user } = data.login as { token: string; user: AuthUser };
        setAuthToken(token);
        set({ token, user, isAdmin: user.isAdmin });
      },
      async register(phone, password, displayName) {
        const { data } = await client.mutate({ mutation: REGISTER, variables: { input: { phone, password, displayName } } });
        return (data.register as { user: AuthUser }).user;
      },
      logout() {
        setAuthToken(null);
        set({ token: null, user: null, isAdmin: false });
      },
    }),
    {
      name: "task-auth",
      onRehydrateStorage: () => (state) => {
        if (state?.token) setAuthToken(state.token);
      },
    },
  ),
);
