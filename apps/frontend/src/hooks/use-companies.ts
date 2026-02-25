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
