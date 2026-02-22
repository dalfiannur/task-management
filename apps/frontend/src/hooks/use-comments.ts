import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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
  return useQuery({
    queryKey: ["comments", taskId],
    queryFn: async (): Promise<Comment[]> => {
      const data = await graphqlClient.request<{
        listComments: Comment[];
      }>(LIST_COMMENTS, { input: { taskId } });
      return data.listComments;
    },
    enabled: !!taskId,
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      content: string;
      mentionedUserIds?: string[];
    }): Promise<Comment> => {
      const data = await graphqlClient.request<{
        createComment: Comment;
      }>(CREATE_COMMENT, { input });
      return data.createComment;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.taskId],
      });
    },
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      content: string;
      taskId: string;
      mentionedUserIds?: string[];
    }): Promise<Comment> => {
      const { taskId: _taskId, ...mutationInput } = input;
      const data = await graphqlClient.request<{
        updateComment: Comment;
      }>(UPDATE_COMMENT, { input: mutationInput });
      return data.updateComment;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.taskId],
      });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      taskId: string;
    }): Promise<boolean> => {
      const data = await graphqlClient.request<{
        deleteComment: boolean;
      }>(DELETE_COMMENT, { input: { id: input.id } });
      return data.deleteComment;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.taskId],
      });
    },
  });
}
