import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAllEmployees,
  fetchDivisions,
  fetchEmployees,
  fetchEntriesBetween,
  fetchJobs,
  fetchOpenEntries,
  fetchPayPeriods,
  fetchRevisions,
  toDateKey,
  weekEnd,
  weekStart,
  type PayPeriod,
} from "@/lib/timekeeping";
import { weekStartKey } from "@/lib/time-rules";

/** Keeps every timekeeping query fresh as punches land, from any device. */
export function useLiveTimekeeping() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("timekeeping-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, () => {
        queryClient.invalidateQueries({ queryKey: ["entries"] });
        queryClient.invalidateQueries({ queryKey: ["open-entries"] });
        queryClient.invalidateQueries({ queryKey: ["revisions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, () => {
        queryClient.invalidateQueries({ queryKey: ["employees"] });
        queryClient.invalidateQueries({ queryKey: ["all-employees"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "divisions" }, () => {
        queryClient.invalidateQueries({ queryKey: ["divisions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pay_periods" }, () => {
        queryClient.invalidateQueries({ queryKey: ["pay-periods"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export const useDivisions = () => useQuery({ queryKey: ["divisions"], queryFn: fetchDivisions });

export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: fetchJobs });

export const useEmployees = () => useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

export const useAllEmployees = () =>
  useQuery({ queryKey: ["all-employees"], queryFn: fetchAllEmployees });

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

export function useRangeEntries(
  from: string,
  to: string,
  options: { includeVoided?: boolean } = {},
) {
  const includeVoided = options.includeVoided === true;
  return useQuery({
    queryKey: includeVoided ? ["entries", from, to, "with-voided"] : ["entries", from, to],
    queryFn: () => fetchEntriesBetween(from, to, { includeVoided }),
  });
}

/** Every closed or reopened payroll week, plus a lookup for a given date. */
export function usePayPeriods() {
  const query = useQuery({ queryKey: ["pay-periods"], queryFn: fetchPayPeriods });
  const periods = useMemo(() => query.data ?? [], [query.data]);
  const byWeek = useMemo(() => new Map(periods.map((p) => [p.week_start, p])), [periods]);
  return {
    ...query,
    periods,
    /** The closed period covering a YYYY-MM-DD key, or undefined when the week is open. */
    closedFor: (dateKey: string): PayPeriod | undefined => {
      const period = byWeek.get(weekStartKey(dateKey));
      return period?.status === "closed" ? period : undefined;
    },
    periodFor: (dateKey: string): PayPeriod | undefined => byWeek.get(weekStartKey(dateKey)),
  };
}

export const useRevisions = (entryId: string | null) =>
  useQuery({
    queryKey: ["revisions", entryId],
    queryFn: () => fetchRevisions(entryId ?? ""),
    enabled: entryId !== null,
  });
