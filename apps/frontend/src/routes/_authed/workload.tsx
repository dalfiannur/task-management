import { createFileRoute } from "@tanstack/react-router";
import { WorkloadPage } from "@/features/workload";

export const Route = createFileRoute("/_authed/workload")({
  component: WorkloadPage,
});
