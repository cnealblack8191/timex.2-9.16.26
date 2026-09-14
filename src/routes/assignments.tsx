import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/assignments")({
  head: () => ({
    meta: [
      { title: "TimeX" },
      { name: "description", content: "Job assignments have moved to the Admin section." },
    ],
  }),
  component: () => <Navigate to="/admin" search={{ tab: "bulk-assign" }} />,
});
