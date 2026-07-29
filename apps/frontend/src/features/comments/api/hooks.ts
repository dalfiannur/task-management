// Comments RPC hooks (connect-query over CommentService). Task-scoped thread,
// chronological. Writes invalidate the CommentService key.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { CommentService } from "@/lib/gen/comments_pb";
import { queryClient } from "@/lib/query";
import type { Comment } from "../types";
import { mapComment } from "./mappers";

function invalidateComments() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: CommentService,
      cardinality: "finite",
    }),
  });
}

export function useComments(taskId: string) {
  const result = useQuery(
    CommentService.method.listComments,
    { taskId, page: 1, pageSize: 100 },
    { enabled: !!taskId },
  );
  const comments: Comment[] = (result.data?.comments ?? []).map(mapComment);
  return { ...result, comments, total: result.data?.total ?? 0 };
}

export function useCreateComment() {
  return useMutation(CommentService.method.createComment, {
    onSuccess: invalidateComments,
  });
}
export function useUpdateComment() {
  return useMutation(CommentService.method.updateComment, {
    onSuccess: invalidateComments,
  });
}
export function useDeleteComment() {
  return useMutation(CommentService.method.deleteComment, {
    onSuccess: invalidateComments,
  });
}
