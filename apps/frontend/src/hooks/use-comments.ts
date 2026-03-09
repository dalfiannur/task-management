import { useQuery, gql } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
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

const COMMENT_COUNTS = gql`
  query CommentCounts($input: commentCountsInput!) {
    commentCounts(input: $input)
  }
`;

export function useComments(taskId: string) {
  const result = useQuery<{ listComments: Comment[] }>(LIST_COMMENTS, {
    variables: { input: { taskId } },
    skip: !taskId,
  });
  return normalizeQueryResult(result, (d) => d.listComments);
}

export const useCreateComment = createMutationHook<
  { taskId: string; content: string; mentionedUserIds?: string[] },
  Comment
>({
  mutation: CREATE_COMMENT,
  responseKey: "createComment",
  refetchQueries: [LIST_COMMENTS, COMMENT_COUNTS],
});

export const useUpdateComment = createMutationHook<
  { id: string; content: string; taskId: string; mentionedUserIds?: string[] },
  Comment
>({
  mutation: UPDATE_COMMENT,
  responseKey: "updateComment",
  mapVariables: ({ taskId: _taskId, ...rest }) => ({ input: rest }),
});

export const useDeleteComment = createVoidMutationHook<{
  id: string;
  taskId: string;
}>({
  mutation: DELETE_COMMENT,
  mapVariables: (input) => ({ input: { id: input.id } }),
  refetchQueries: [LIST_COMMENTS, COMMENT_COUNTS],
});

export function useCommentCounts(taskIds: string[]) {
  const result = useQuery<{ commentCounts: Record<string, number> }>(
    COMMENT_COUNTS,
    {
      variables: { input: { taskIds } },
      skip: taskIds.length === 0,
    },
  );
  return normalizeQueryResult(result, (d) => d.commentCounts);
}
