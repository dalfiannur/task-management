import { useUserMap } from "@/features/users";
import { useRecentActivity, useProjectActivity } from "../api/hooks";
import { ActivityFeed } from "./activity-feed";

/** Recent activity across the caller's projects (dashboard panel). */
export function RecentActivity({ pageSize = 20 }: { pageSize?: number }) {
  const { activities, isLoading } = useRecentActivity(pageSize);
  const userMap = useUserMap();
  return (
    <ActivityFeed
      activities={activities}
      userMap={userMap}
      isLoading={isLoading}
    />
  );
}

/** Per-project activity (usable as a project panel). */
export function ProjectActivity({
  projectId,
  pageSize = 30,
}: {
  projectId: string;
  pageSize?: number;
}) {
  const { activities, isLoading } = useProjectActivity(projectId, pageSize);
  const userMap = useUserMap();
  return (
    <ActivityFeed
      activities={activities}
      userMap={userMap}
      isLoading={isLoading}
    />
  );
}
