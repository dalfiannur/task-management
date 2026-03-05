import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import { normalizeQueryResult } from "@/lib/hook-factories";

const SEARCH_COMPANIES = gql`
  query SearchCompanies($input: searchCompaniesInput!) {
    searchCompanies(input: $input) {
      id
      name {
        name
        legalName
      }
      status {
        value
      }
    }
  }
`;

interface CompanyRaw {
  id: string;
  name: { name: string; legalName: string };
  status: { value: string };
}

export interface Company {
  id: string;
  name: string;
  legalName: string;
  status: string;
}

function mapCompany(raw: CompanyRaw): Company {
  return {
    id: raw.id,
    name: raw.name.name,
    legalName: raw.name.legalName,
    status: raw.status.value,
  };
}

export function useCompanies(search?: string) {
  const result = useQuery<{ searchCompanies: CompanyRaw[] }>(SEARCH_COMPANIES, {
    variables: { input: { q: search || "" } },
    skip: !search,
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) =>
    d.searchCompanies.map(mapCompany),
  );
}

// --- User's companies (membership-based) ---

const LIST_USER_COMPANIES = gql`
  query ListUserCompanies($input: listUserCompaniesInput!) {
    listUserCompanies(input: $input) {
      companyRef
      companyDetail {
        name {
          name
        }
        status
      }
    }
  }
`;

interface CompanyMembershipRaw {
  companyRef: string;
  companyDetail: {
    name: { name: string };
    status: string;
  } | null;
}

export function useUserCompanies(userId?: string) {
  const result = useQuery<{ listUserCompanies: CompanyMembershipRaw[] }>(
    LIST_USER_COMPANIES,
    {
      variables: { input: { userRefId: userId } },
      skip: !userId,
      client: coreClient,
    },
  );
  return normalizeQueryResult(result, (d) =>
    d.listUserCompanies
      .filter((m) => m.companyDetail?.status === "active")
      .map((m) => ({
        id: m.companyRef,
        name: m.companyDetail?.name?.name ?? "Unknown",
      })),
  );
}
