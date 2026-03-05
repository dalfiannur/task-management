# Company Selector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a global company selector to the header that filters all data by the selected company and injects `X-Company-Id` header for sales API requests.

**Architecture:** Zustand store persisted to localStorage holds selected company. A `CompanyInitializer` component fetches user companies on auth and populates the store. A `companyLink` in the Apollo link chain auto-injects `X-Company-Id` for salesClient. Hooks are updated to pass `ownerId` filter for core API queries.

**Tech Stack:** Zustand, Apollo Client (setContext), react-oidc-context (useAuth), shadcn Select, CSS Modules.

---

## Task 1: Create Company Zustand Store

**Files:**
- Create: `apps/frontend/src/stores/company-store.ts`

**Step 1: Create the store**

```typescript
// apps/frontend/src/stores/company-store.ts
import { create } from "zustand";

const STORAGE_KEY = "selectedCompanyId";

export interface UserCompany {
  id: string;
  name: string;
}

interface CompanyState {
  companies: UserCompany[];
  selectedCompanyId: string | null;
  isLoading: boolean;
  setCompanies: (companies: UserCompany[]) => void;
  selectCompany: (companyId: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useCompanyStore = create<CompanyState>((set) => ({
  companies: [],
  selectedCompanyId: localStorage.getItem(STORAGE_KEY),
  isLoading: true,
  setCompanies: (companies) =>
    set((state) => {
      const persisted = state.selectedCompanyId;
      const valid = companies.some((c) => c.id === persisted);
      const selectedCompanyId = valid ? persisted : companies[0]?.id ?? null;
      if (selectedCompanyId) localStorage.setItem(STORAGE_KEY, selectedCompanyId);
      return { companies, selectedCompanyId, isLoading: false };
    }),
  selectCompany: (companyId) => {
    localStorage.setItem(STORAGE_KEY, companyId);
    set({ selectedCompanyId: companyId });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
```

**Step 2: Commit**

```bash
git add apps/frontend/src/stores/company-store.ts
git commit -m "feat: add company Zustand store with localStorage persistence"
```

---

## Task 2: Add `useUserCompanies` Hook

**Files:**
- Modify: `apps/frontend/src/hooks/use-companies.ts`

The core API's `listUserCompanies` returns `CompanyMembership[]` with `companyRef` (ID) and `companyDetail { name { name } }`.

**Step 1: Add the query and hook**

Append to `apps/frontend/src/hooks/use-companies.ts`:

```typescript
// --- User's companies (membership-based) ---

const LIST_USER_COMPANIES = gql`
  query ListUserCompanies($input: listUserCompaniesInput!) {
    listUserCompanies(input: $input) {
      companyRef
      companyDetail {
        name { name }
        status { value }
      }
    }
  }
`;

interface CompanyMembershipRaw {
  companyRef: string;
  companyDetail: {
    name: { name: string };
    status: { value: string };
  } | null;
}

export function useUserCompanies(userId?: string) {
  const result = useQuery<{ listUserCompanies: CompanyMembershipRaw[] }>(
    LIST_USER_COMPANIES,
    {
      variables: { input: { userRefId: userId } },
      skip: !userId,
      client: coreClient,
    }
  );
  return normalizeQueryResult(result, (d) =>
    d.listUserCompanies
      .filter((m) => m.companyDetail?.status?.value === "active")
      .map((m) => ({
        id: m.companyRef,
        name: m.companyDetail?.name?.name ?? "Unknown",
      }))
  );
}
```

**Step 2: Commit**

```bash
git add apps/frontend/src/hooks/use-companies.ts
git commit -m "feat: add useUserCompanies hook for fetching user company memberships"
```

---

## Task 3: Add `companyLink` to Sales GraphQL Client

**Files:**
- Modify: `apps/frontend/src/lib/graphql-client.ts`

Instead of per-query `context: { headers: { 'X-Company-Id': ... } }`, inject it globally via a dedicated link for `salesClient`.

**Step 1: Add companyLink and modify salesClient**

In `graphql-client.ts`, add after the `authLink` definition:

```typescript
import { useCompanyStore } from "@/stores/company-store";

const companyLink = setContext((_, { headers }) => {
  const companyId = useCompanyStore.getState().selectedCompanyId;
  return {
    headers: {
      ...headers,
      ...(companyId ? { "X-Company-Id": companyId } : {}),
    },
  };
});
```

Then change `salesClient` from:
```typescript
export const salesClient = makeClient(SALES_URL);
```
to:
```typescript
function makeSalesClient(uri: string) {
  return new ApolloClient({
    link: ApolloLink.from([authLink, companyLink, createErrorLink(), createHttpLink({ uri })]),
    cache: new InMemoryCache(),
  });
}

export const salesClient = makeSalesClient(SALES_URL);
```

Also export a `resetAllStores` helper for soft refresh:
```typescript
export function resetAllStores() {
  return Promise.all([
    client.resetStore(),
    coreClient.resetStore(),
    salesClient.resetStore(),
    mediaClient.resetStore(),
  ]);
}
```

**Step 2: Commit**

```bash
git add apps/frontend/src/lib/graphql-client.ts
git commit -m "feat: add companyLink for automatic X-Company-Id header on sales API"
```

---

## Task 4: Add CompanyInitializer Component

**Files:**
- Create: `apps/frontend/src/components/layout/company-initializer.tsx`
- Modify: `apps/frontend/src/components/layout/app-layout.tsx`

This component runs after auth, fetches user companies, populates the Zustand store.

**Step 1: Create CompanyInitializer**

```typescript
// apps/frontend/src/components/layout/company-initializer.tsx
import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import { useUserCompanies } from "@/hooks/use-companies";
import { useCompanyStore } from "@/stores/company-store";

export function CompanyInitializer() {
  const auth = useAuth();
  const userId = auth.user?.profile?.sub;
  const { data: companies, isLoading } = useUserCompanies(userId);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setLoading = useCompanyStore((s) => s.setLoading);

  useEffect(() => {
    if (isLoading) {
      setLoading(true);
      return;
    }
    setCompanies(companies ?? []);
  }, [companies, isLoading, setCompanies, setLoading]);

  return null;
}
```

**Step 2: Add to AppLayout**

In `apps/frontend/src/components/layout/app-layout.tsx`, import and render:

```typescript
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";
import { CompanyInitializer } from "./company-initializer";
import styles from "./app-layout.module.css";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <CompanyInitializer />
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className={styles.main}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

**Step 3: Commit**

```bash
git add apps/frontend/src/components/layout/company-initializer.tsx apps/frontend/src/components/layout/app-layout.tsx
git commit -m "feat: add CompanyInitializer to fetch and set user companies on auth"
```

---

## Task 5: Add CompanySelector to Header

**Files:**
- Create: `apps/frontend/src/components/layout/company-selector.tsx`
- Create: `apps/frontend/src/components/layout/company-selector.module.css`
- Modify: `apps/frontend/src/components/layout/header.tsx`

**Step 1: Create CompanySelector component**

```typescript
// apps/frontend/src/components/layout/company-selector.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompanyStore } from "@/stores/company-store";
import { resetAllStores } from "@/lib/graphql-client";
import { Building2 } from "lucide-react";
import styles from "./company-selector.module.css";

export function CompanySelector() {
  const { companies, selectedCompanyId, selectCompany, isLoading } =
    useCompanyStore();

  if (isLoading || companies.length === 0) return null;

  function handleChange(value: string) {
    selectCompany(value);
    resetAllStores();
  }

  // Single company — just show the name, no dropdown
  if (companies.length === 1) {
    return (
      <div className={styles.single}>
        <Building2 className={styles.icon} />
        <span className={styles.name}>{companies[0].name}</span>
      </div>
    );
  }

  return (
    <Select value={selectedCompanyId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className={styles.trigger}>
        <Building2 className={styles.icon} />
        <SelectValue placeholder="Select company" />
      </SelectTrigger>
      <SelectContent>
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

**Step 2: Create CSS module**

```css
/* apps/frontend/src/components/layout/company-selector.module.css */
.trigger {
  height: 1.75rem;
  min-width: 8rem;
  max-width: 14rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.8125rem;
  gap: 0.375rem;
  padding: 0 0.5rem;
  background-color: transparent;
}

.trigger:focus {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ring) 30%, transparent);
}

.single {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  padding: 0 0.25rem;
}

.icon {
  width: 0.8125rem;
  height: 0.8125rem;
  flex-shrink: 0;
  color: var(--muted-foreground);
}

.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}
```

**Step 3: Add to Header**

In `apps/frontend/src/components/layout/header.tsx`, import and render after the breadcrumb separator:

Add import:
```typescript
import { CompanySelector } from "./company-selector";
```

In the JSX, insert `<CompanySelector />` right after the `<Separator>`:

```tsx
<SidebarTrigger className={styles.triggerBtn} />
<Separator orientation="vertical" className={styles.separatorEl} />
<CompanySelector />

<Breadcrumb>
```

**Step 4: Commit**

```bash
git add apps/frontend/src/components/layout/company-selector.tsx apps/frontend/src/components/layout/company-selector.module.css apps/frontend/src/components/layout/header.tsx
git commit -m "feat: add CompanySelector dropdown to header bar"
```

---

## Task 6: Update `useProjects` to Filter by Company

**Files:**
- Modify: `apps/frontend/src/hooks/use-projects.ts`

The core API's `listProjects` accepts `ownerId` which maps to `ref.companyId` internally.

**Step 1: Update useProjects hook**

Change the `useProjects` function signature and variables to accept and pass `ownerId`:

```typescript
export function useProjects(input?: { status?: string; parentId?: string; ownerId?: string }) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_CORE_PROJECTS, {
    client: coreClient,
    variables: { input: { status: "active", ...input } },
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}
```

**Step 2: Update callers to pass selectedCompanyId**

Every page/component that calls `useProjects()` needs to pass `ownerId`. The key callers:

In `apps/frontend/src/components/layout/app-sidebar.tsx`:
```typescript
import { useCompanyStore } from "@/stores/company-store";

// inside the component:
const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
const { data: projects, isLoading } = useProjects(
  selectedCompanyId ? { ownerId: selectedCompanyId } : undefined
);
```

In `apps/frontend/src/pages/projects.tsx`:
```typescript
import { useCompanyStore } from "@/stores/company-store";

// inside the component:
const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
const { data: allProjects, isLoading } = useProjects(
  selectedCompanyId ? { ownerId: selectedCompanyId } : undefined
);
```

In `apps/frontend/src/pages/dashboard.tsx` (if it calls useProjects):
Check and update similarly.

**Step 3: Commit**

```bash
git add apps/frontend/src/hooks/use-projects.ts apps/frontend/src/components/layout/app-sidebar.tsx apps/frontend/src/pages/projects.tsx
git commit -m "feat: filter projects by selected company (ownerId)"
```

---

## Task 7: Update `useNewLeads` to Filter by Company

**Files:**
- Modify: `apps/frontend/src/hooks/use-leads.ts`

**Step 1: Make LIST_LEADS accept ownerId variable**

Change the query from hardcoded to parameterized:

```graphql
query ListLeadProjects($input: listProjectsInput!) {
  listProjects(input: $input) {
    id
    code
    status
    winStage
    commercial
    name {
      description
      name
    }
    ref {
      companyId
      leaderId
    }
  }
}
```

Update the hook:

```typescript
export function useNewLeads(ownerId?: string) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_LEADS, {
    client: coreClient,
    variables: { input: { winStage: "pending", ownerId } },
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}
```

**Step 2: Update callers to pass selectedCompanyId**

In `apps/frontend/src/components/layout/app-sidebar.tsx`:
```typescript
const { data: leads } = useNewLeads(selectedCompanyId ?? undefined);
```

In `apps/frontend/src/pages/projects.tsx`:
```typescript
const { data: leads, isLoading: isLeadsLoading } = useNewLeads(selectedCompanyId ?? undefined);
```

In `apps/frontend/src/pages/dashboard.tsx` (if it calls useNewLeads):
Check and update similarly.

**Step 3: Commit**

```bash
git add apps/frontend/src/hooks/use-leads.ts apps/frontend/src/components/layout/app-sidebar.tsx apps/frontend/src/pages/projects.tsx
git commit -m "feat: filter leads by selected company (ownerId)"
```

---

## Task 8: Simplify `useDealBrief` (Remove Per-Query companyId)

**Files:**
- Modify: `apps/frontend/src/hooks/use-leads.ts`
- Modify: `apps/frontend/src/components/dashboard/approve-lead-dialog.tsx`

Since `companyLink` now auto-injects `X-Company-Id`, `useDealBrief` no longer needs the `companyId` parameter.

**Step 1: Simplify useDealBrief**

```typescript
export function useDealBrief(projectId?: string) {
  const result = useQuery<{ getDealByProjectId: DealBriefRaw | null }>(
    GET_DEAL_BY_PROJECT_ID,
    {
      client: salesClient,
      variables: { input: { projectId } },
      skip: !projectId,
    }
  );
  return normalizeQueryResult(result, (d) => parseDealBrief(d.getDealByProjectId));
}
```

**Step 2: Update caller in approve-lead-dialog.tsx**

Change:
```typescript
const { data: dealBrief, isLoading: briefLoading } = useDealBrief(project?.id, project?.ref?.companyId);
```
To:
```typescript
const { data: dealBrief, isLoading: briefLoading } = useDealBrief(project?.id);
```

**Step 3: Commit**

```bash
git add apps/frontend/src/hooks/use-leads.ts apps/frontend/src/components/dashboard/approve-lead-dialog.tsx
git commit -m "refactor: simplify useDealBrief - X-Company-Id now injected globally"
```

---

## Task 9: Update Client/Division Callers

**Files:**
- Check and update callers of `useClients()` and `useDivisions()` to pass `selectedCompanyId`

**Step 1: Find and update callers**

Search for `useClients(` and `useDivisions(` across the frontend. These hooks already accept `companyId`, so callers just need to pass the selected company from the store.

Common pattern:
```typescript
import { useCompanyStore } from "@/stores/company-store";

const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
const { data: clients } = useClients({ companyId: selectedCompanyId ?? undefined });
const { data: divisions } = useDivisions(selectedCompanyId ?? undefined);
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: pass selectedCompanyId to useClients and useDivisions callers"
```

---

## Task 10: Type-Check and Verify

**Step 1: Run type check**

```bash
cd apps/frontend && bun run tsc --noEmit
```

Fix any type errors.

**Step 2: Run lint**

```bash
cd apps/frontend && bun run lint
```

Fix any lint issues.

**Step 3: Manual verification**

1. Start dev server: `cd apps/frontend && bun run dev`
2. Log in, verify company selector appears in the header
3. Verify projects/leads are filtered by selected company
4. Open ApproveLeadDialog, verify deal brief loads without `X-Company-Id` error
5. Switch company, verify all data refreshes

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve type and lint issues from company selector feature"
```
