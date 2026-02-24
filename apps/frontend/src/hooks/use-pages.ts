import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { Page } from "@/types/page";

const PAGE_FIELDS = gql`
  fragment PageFields on Page {
    id
    pageInfo {
      projectId
      title
      icon
      content
      order
      createdById
      createdByName
      lastEditedById
      lastEditedByName
      createdAt
      updatedAt
    }
  }
`;

const LIST_PAGES = gql`
  ${PAGE_FIELDS}
  query ListPages($input: listPagesInput!) {
    listPages(input: $input) {
      ...PageFields
    }
  }
`;

const GET_PAGE = gql`
  ${PAGE_FIELDS}
  query GetPage($input: getPageInput!) {
    getPage(input: $input) {
      ...PageFields
    }
  }
`;

const CREATE_PAGE = gql`
  ${PAGE_FIELDS}
  mutation CreatePage($input: createPageInput!) {
    createPage(input: $input) {
      ...PageFields
    }
  }
`;

const UPDATE_PAGE = gql`
  ${PAGE_FIELDS}
  mutation UpdatePage($input: updatePageInput!) {
    updatePage(input: $input) {
      ...PageFields
    }
  }
`;

const DELETE_PAGE = gql`
  mutation DeletePage($input: deletePageInput!) {
    deletePage(input: $input)
  }
`;

const REORDER_PAGES = gql`
  mutation ReorderPages($input: reorderPagesInput!) {
    reorderPages(input: $input)
  }
`;

export function usePages(projectId: string) {
  const result = useQuery<{ listPages: Page[] }>(LIST_PAGES, {
    variables: { input: { projectId } },
    skip: !projectId,
  });
  return normalizeQueryResult(result, (d) => d.listPages);
}

export function usePage(id: string) {
  const result = useQuery<{ getPage: Page }>(GET_PAGE, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getPage);
}

export const useCreatePage = createMutationHook<
  { projectId: string; title: string; icon?: string; content?: string },
  Page
>({
  mutation: CREATE_PAGE,
  responseKey: "createPage",
  refetchQueries: [LIST_PAGES],
});

export const useUpdatePage = createMutationHook<
  {
    id: string;
    projectId: string;
    title?: string;
    icon?: string;
    content?: string;
    order?: number;
  },
  Page
>({
  mutation: UPDATE_PAGE,
  responseKey: "updatePage",
  mapVariables: ({ projectId: _projectId, ...rest }) => ({ input: rest }),
  refetchQueries: [LIST_PAGES, GET_PAGE],
});

export const useDeletePage = createVoidMutationHook<{
  id: string;
  projectId: string;
}>({
  mutation: DELETE_PAGE,
  mapVariables: (input) => ({ input: { id: input.id } }),
  refetchQueries: [LIST_PAGES],
});

export const useReorderPages = createVoidMutationHook<{
  projectId: string;
  pageIds: string[];
}>({
  mutation: REORDER_PAGES,
  refetchQueries: [LIST_PAGES],
});
