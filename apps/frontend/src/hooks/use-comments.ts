import { useQuery, useMutation, gql } from "@/lib/graphql-client";
import type { Comment } from "@/types/comment";

const COMMENT_FIELDS = gql`
  fragment CommentFields on Comment {
    id
    commentInfo {
      taskId
      authorId
      authorName
      content
      createdAt
      updatedAt
      mentionedUserIds
    }
  }
`;

const LIST_COMMENTS = gql`
  ${COMMENT_FIELDS}
  query ListComments($input: listCommentsInput!) {
    listComments(input: $input) {
      ...CommentFields
    }
  }
`;

const CREATE_COMMENT = gql`
  ${COMMENT_FIELDS}
  mutation CreateComment($input: createCommentInput!) {
    createComment(input: $input) {
      ...CommentFields
    }
  }
`;

const UPDATE_COMMENT = gql`
  ${COMMENT_FIELDS}
  mutation UpdateComment($input: updateCommentInput!) {
    updateComment(input: $input) {
      ...CommentFields
    }
  }
`;

const DELETE_COMMENT = gql`
  mutation DeleteComment($input: deleteCommentInput!) {
    deleteComment(input: $input)
  }
`;

export function useComments(taskId: string) {
  const { data, loading, error } = useQuery<{
    listComments: Comment[];
  }>(LIST_COMMENTS, {
    variables: { input: { taskId } },
    skip: !taskId,
  });

  return {
    data: data?.listComments,
    isLoading: loading,
    isPending: loading,
    error: error ?? null,
  };
}

export function useCreateComment() {
  const [exec, { loading }] = useMutation<{ createComment: Comment }>(
    CREATE_COMMENT,
  );

  return {
    mutate: (
      input: { taskId: string; content: string; mentionedUserIds?: string[] },
      opts?: { onSuccess?: (data: Comment) => void },
    ) => {
      exec({ variables: { input } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.createComment);
      });
    },
    mutateAsync: async (input: {
      taskId: string;
      content: string;
      mentionedUserIds?: string[];
    }): Promise<Comment> => {
      const res = await exec({ variables: { input } });
      return res.data!.createComment;
    },
    isPending: loading,
  };
}

export function useUpdateComment() {
  const [exec, { loading }] = useMutation<{ updateComment: Comment }>(
    UPDATE_COMMENT,
  );

  return {
    mutate: (
      input: {
        id: string;
        content: string;
        taskId: string;
        mentionedUserIds?: string[];
      },
      opts?: { onSuccess?: (data: Comment) => void },
    ) => {
      const { taskId: _taskId, ...mutationInput } = input;
      exec({ variables: { input: mutationInput } }).then((res) => {
        if (res.data) opts?.onSuccess?.(res.data.updateComment);
      });
    },
    mutateAsync: async (input: {
      id: string;
      content: string;
      taskId: string;
      mentionedUserIds?: string[];
    }): Promise<Comment> => {
      const { taskId: _taskId, ...mutationInput } = input;
      const res = await exec({ variables: { input: mutationInput } });
      return res.data!.updateComment;
    },
    isPending: loading,
  };
}

export function useDeleteComment() {
  const [exec, { loading }] = useMutation<{ deleteComment: boolean }>(
    DELETE_COMMENT,
  );

  return {
    mutate: (
      input: { id: string; taskId: string },
      opts?: { onSuccess?: () => void },
    ) => {
      exec({ variables: { input: { id: input.id } } }).then(() => {
        opts?.onSuccess?.();
      });
    },
    mutateAsync: async (input: {
      id: string;
      taskId: string;
    }): Promise<boolean> => {
      const res = await exec({ variables: { input: { id: input.id } } });
      return res.data!.deleteComment;
    },
    isPending: loading,
  };
}
