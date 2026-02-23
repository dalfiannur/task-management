import { useQuery, useMutation, gql } from "@/lib/graphql-client";
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
  const { data, loading, error } = useQuery<{ listPages: Page[] }>(
    LIST_PAGES,
    {
      variables: { input: { projectId } },
      skip: !projectId,
    },
  );

  return {
    data: data?.listPages,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function usePage(id: string) {
  const { data, loading, error } = useQuery<{ getPage: Page }>(GET_PAGE, {
    variables: { input: { id } },
    skip: !id,
  });

  return {
    data: data?.getPage,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreatePage() {
  const [exec, { loading }] = useMutation<{ createPage: Page }>(CREATE_PAGE);

  return {
    mutate: (
      input: {
        projectId: string;
        title: string;
        icon?: string;
        content?: string;
      },
      opts?: { onSuccess?: (data: Page) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.createPage);
      });
    },
    mutateAsync: async (input: {
      projectId: string;
      title: string;
      icon?: string;
      content?: string;
    }): Promise<Page> => {
      const res = await exec({ variables: { input } });
      return res.data!.createPage;
    },
    isPending: loading,
  };
}

export function useUpdatePage() {
  const [exec, { loading }] = useMutation<{ updatePage: Page }>(UPDATE_PAGE);

  return {
    mutate: (
      input: {
        id: string;
        projectId: string;
        title?: string;
        icon?: string;
        content?: string;
        order?: number;
      },
      opts?: { onSuccess?: (data: Page) => void },
    ) => {
      const { projectId: _projectId, ...mutationInput } = input;
      exec({ variables: { input: mutationInput } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.updatePage);
      });
    },
    mutateAsync: async (input: {
      id: string;
      projectId: string;
      title?: string;
      icon?: string;
      content?: string;
      order?: number;
    }): Promise<Page> => {
      const { projectId: _projectId, ...mutationInput } = input;
      const res = await exec({ variables: { input: mutationInput } });
      return res.data!.updatePage;
    },
    isPending: loading,
  };
}

export function useDeletePage() {
  const [exec, { loading }] = useMutation<{ deletePage: boolean }>(
    DELETE_PAGE,
  );

  return {
    mutate: (
      input: { id: string; projectId: string },
      opts?: { onSuccess?: () => void },
    ) => {
      exec({ variables: { input: { id: input.id } } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (input: {
      id: string;
      projectId: string;
    }): Promise<boolean> => {
      const res = await exec({ variables: { input: { id: input.id } } });
      return res.data!.deletePage;
    },
    isPending: loading,
  };
}

export function useReorderPages() {
  const [exec, { loading }] = useMutation<{ reorderPages: boolean }>(
    REORDER_PAGES,
  );

  return {
    mutate: (
      input: { projectId: string; pageIds: string[] },
      opts?: { onSuccess?: () => void },
    ) => {
      exec({ variables: { input } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (input: {
      projectId: string;
      pageIds: string[];
    }): Promise<boolean> => {
      const res = await exec({ variables: { input } });
      return res.data!.reorderPages;
    },
    isPending: loading,
  };
}
