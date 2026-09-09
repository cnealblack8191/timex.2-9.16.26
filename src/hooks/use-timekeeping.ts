import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDivisions,
  fetchEmployees,
  fetchEntriesBetween,
  fetchJobs,
  fetchOpenEntries,
  toDateKey,
  weekEnd,
  weekStart,
} from "@/lib/timekeeping";

/** Keeps every timekeeping query fresh as punches land, from any device. */
export function useLiveTimekeeping() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("timekeeping-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, () => {
        queryClient.invalidateQueries({ queryKey: ["entries"] });
        queryClient.invalidateQueries({ queryKey: ["open-entries"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, () => {
        queryClient.invalidateQueries({ queryKey: ["employees"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export const useDivisions = () =>
  useQuery({ queryKey: ["divisions"], queryFn: fetchDivisions });

export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: fetchJobs });

export const useEmployees = () =>
  useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

export const useOpenEntries = () =>
  useQuery({ queryKey: ["open-entries"], queryFn: fetchOpenEntries, refetchInterval: 30000 });

export function useWeekEntries(reference: Date) {
  const from = toDateKey(weekStart(reference));
  const to = toDateKey(weekEnd(reference));
  return useQuery({
    queryKey: ["entries", from, to],
    queryFn: () => fetchEntriesBetween(from, to),
  });
}

export function useRangeEntries(from: string, to: string) {
  return useQuery({
    queryKey: ["entries", from, to],
    queryFn: () => fetchEntriesBetween(from, to),
  });
}
