# Company Selector & Global Company Filtering

**Date:** 2026-03-05
**Status:** Design

## Problem

The `getDealByProjectId` query to the sales-pipeline API requires an `X-Company-Id` HTTP header. Currently `useDealBrief` passes `project.ref.companyId` per-query via Apollo context, but there is no global company selection mechanism. Additionally, data across the app (projects, leads, clients, divisions) should be scoped to the user's selected company.

## Architecture

### State Management: Zustand Store

New store `useCompanyStore` in `src/stores/company-store.ts`:

```typescript
interface CompanyState {
  companies: Company[];
  selectedCompanyId: string | null;
  isLoading: boolean;
  setCompanies: (companies: Company[]) => void;
  selectCompany: (companyId: string) => void;
}
```

- Persists `selectedCompanyId` to localStorage (key: `selectedCompanyId`)
- On init, reads from localStorage; falls back to first company from API
- `selectCompany()` updates store + triggers Apollo cache reset + refetch

### Data Fetching: `useUserCompanies` Hook

New hook in `src/hooks/use-companies.ts`:

```graphql
query ListUserCompanies($input: listUserCompaniesInput!) {
  listUserCompanies(input: $input) {
    companyRef    # company ID
    companyDetail {
      name { name }
      status { value }
    }
  }
}
```

- Uses `coreClient`
- Input: `{ userRefId: <current user sub from OIDC> }`
- Returns `CompanyMembership[]` with nested company details
- Called once on auth, populates the Zustand store

### Company Initialization: `CompanyInitializer` Component

New component rendered inside `AuthenticatedLayout` (after auth is confirmed):

- Calls `useUserCompanies(userId)` on mount
- Populates `useCompanyStore` with fetched companies
- Auto-selects first company if none persisted in localStorage
- Renders nothing (logic-only component)

### UI: `CompanySelector` in Header

New component in `src/components/layout/company-selector.tsx`:

- Reads from `useCompanyStore`
- Dropdown (shadcn `Select` or `DropdownMenu`) showing company names
- Only visible when user has 2+ companies
- Shows current company name when 1 company (no dropdown interaction)
- Placed in `header.tsx` between sidebar trigger and breadcrumb

### Sales API Header Injection

Modify `graphql-client.ts` — add a `companyLink` before `httpLink` for `salesClient`:

```typescript
const companyLink = setContext((_, { headers }) => {
  const companyId = useCompanyStore.getState().selectedCompanyId;
  return {
    headers: {
      ...headers,
      ...(companyId ? { 'X-Company-Id': companyId } : {}),
    },
  };
});

// salesClient uses: authLink -> companyLink -> errorLink -> httpLink
```

This removes the need to pass `companyId` per-query for sales API calls.

### Hook Updates

| Hook | Change | Filter Parameter |
|------|--------|-----------------|
| `useProjects` | Add `ownerId` to `listProjects` input | `ownerId = selectedCompanyId` |
| `useNewLeads` | Add `ownerId` to `listProjects` input | `ownerId = selectedCompanyId` |
| `useClients` | Already supports `companyId` | Pass `selectedCompanyId` from callers |
| `useDivisions` | Already requires `companyId` | Pass `selectedCompanyId` from callers |
| `useDealBrief` | Remove per-query `companyId` param | Header injected globally via `companyLink` |

Tasks, modules, labels, and media are already project-scoped — no direct changes needed.

### Soft Refresh on Company Change

When `selectCompany()` is called:

1. Update Zustand store + localStorage
2. Reset Apollo cache: `client.resetStore()` for all clients (tasks, core, sales, media)
3. Active queries auto-refetch after cache reset

## Components Affected

**New files:**
- `src/stores/company-store.ts`
- `src/components/layout/company-selector.tsx`
- `src/components/layout/company-selector.module.css`
- `src/components/layout/company-initializer.tsx`

**Modified files:**
- `src/lib/graphql-client.ts` — add `companyLink` for salesClient
- `src/components/layout/header.tsx` — add `CompanySelector`
- `src/components/layout/app-layout.tsx` — add `CompanyInitializer`
- `src/hooks/use-companies.ts` — add `useUserCompanies` hook
- `src/hooks/use-projects.ts` — add `ownerId` filter to `useProjects`
- `src/hooks/use-leads.ts` — add `ownerId` filter to `useNewLeads`, simplify `useDealBrief`
- Callers of `useClients`/`useDivisions` — pass `selectedCompanyId` where needed

## Data Flow

```
Auth (OIDC) → CompanyInitializer → listUserCompanies(userId)
                                        ↓
                                   CompanyStore (Zustand + localStorage)
                                        ↓
              ┌─────────────────────────┼─────────────────────────┐
              ↓                         ↓                         ↓
     CompanySelector (UI)      Hook filters (ownerId)     companyLink (X-Company-Id)
              ↓                         ↓                         ↓
        User switches          Projects/Leads/Clients       Sales API requests
              ↓                 refetch with filter          get header auto
        resetStore() →
        all queries refetch
```
