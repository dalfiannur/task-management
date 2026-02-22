import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["pages", projectId],
    queryFn: async (): Promise<Page[]> => {
      const data = await graphqlClient.request<{
        listPages: Page[];
      }>(LIST_PAGES, { input: { projectId } });
      return data.listPages;
    },
    enabled: !!projectId,
  });
}

export function usePage(id: string) {
  return useQuery({
    queryKey: ["page", id],
    queryFn: async (): Promise<Page> => {
      const data = await graphqlClient.request<{
        getPage: Page;
      }>(GET_PAGE, { input: { id } });
      return data.getPage;
    },
    enabled: !!id,
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      title: string;
      icon?: string;
      content?: string;
    }): Promise<Page> => {
      const data = await graphqlClient.request<{
        createPage: Page;
      }>(CREATE_PAGE, { input });
      return data.createPage;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["pages", variables.projectId],
      });
    },
  });
}

export function useUpdatePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
      title?: string;
      icon?: string;
      content?: string;
      order?: number;
    }): Promise<Page> => {
      const { projectId: _projectId, ...mutationInput } = input;
      const data = await graphqlClient.request<{
        updatePage: Page;
      }>(UPDATE_PAGE, { input: mutationInput });
      return data.updatePage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["pages", data.pageInfo.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["page", data.id],
      });
    },
  });
}

export function useDeletePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
    }): Promise<boolean> => {
      const data = await graphqlClient.request<{
        deletePage: boolean;
      }>(DELETE_PAGE, { input: { id: input.id } });
      return data.deletePage;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["pages", variables.projectId],
      });
    },
  });
}

export function useReorderPages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      pageIds: string[];
    }): Promise<boolean> => {
      const data = await graphqlClient.request<{
        reorderPages: boolean;
      }>(REORDER_PAGES, { input });
      return data.reorderPages;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["pages", variables.projectId],
      });
    },
  });
}
