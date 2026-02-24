import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import { normalizeQueryResult } from "@/lib/hook-factories";

const LIST_DIVISIONS = gql`
  query ListDivisions($input: listDivisionsInput!) {
    listDivisions(input: $input) {
      id
      name {
        name
        description
      }
      companyRef {
        value
      }
      status {
        value
      }
    }
  }
`;

interface DivisionRaw {
  id: string;
  name: { name: string; description: string };
  companyRef: { value: string };
  status: { value: string };
}

export interface Division {
  id: string;
  name: string;
  description: string;
  companyId: string;
  status: string;
}

function mapDivision(raw: DivisionRaw): Division {
  return {
    id: raw.id,
    name: raw.name.name,
    description: raw.name.description,
    companyId: raw.companyRef.value,
    status: raw.status.value,
  };
}

export function useDivisions(companyId?: string) {
  const result = useQuery<{ listDivisions: DivisionRaw[] }>(LIST_DIVISIONS, {
    variables: { input: { companyId, status: "active" } },
    skip: !companyId,
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listDivisions.map(mapDivision));
}
