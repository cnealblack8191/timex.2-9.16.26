import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import {
  useDivisions,
  useEmployees,
  useJobs,
  useOpenEntries,
  useWeekEntries,
} from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import {
  entryHours,
  formatTime,
  fullName,
  jobLabel,
  weekNumber,
} from "@/lib/timekeeping";

export const Route = createFileRoute("/")({
  head: () => ({
      meta: [
      { title: "Operations — TimeX" },
      {
        name: "description",
        content: "Live crew status, time entries and job assignments for Electrical Contractor Inc.",
      },
      { property: "og:title", content: "Operations — TimeX" },
      {
        property: "og:description",
        content: "Live crew status, time entries and job assignments for Electrical Contractor Inc.",
      },
    ],
  }),
  component: Operations,
});

function Operations() {
  const today = new Date();
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();
  const { data: open = [] } = useOpenEntries();
  const { data: weekEntries = [] } = useWeekEntries(today);

  const [selectedDivisions, setSelectedDivisions] = useState<string[]>([]);
  const [bulkJob, setBulkJob] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignNote, setAssignNote] = useState("");

  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const divisionById = useMemo(
    () => new Map(divisions.map((d) => [d.id, d])),
    [divisions],
  );

  const divisionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    employees.forEach((e) => {
      if (e.division_id) counts.set(e.division_id, (counts.get(e.division_id) ?? 0) + 1);
    });
    return counts;
  }, [employees]);

  const selectedCount = selectedDivisions.reduce(
    (sum, id) => sum + (divisionCounts.get(id) ?? 0),
    0,
  );

  const recent = weekEntries.slice(0, 8);
  const totalHours = weekEntries.reduce((sum, e) => sum + entryHours(e), 0);

  async function bulkAssign() {
    if (!bulkJob || selectedDivisions.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("employees")
      .update({ assigned_job_id: bulkJob })
      .in("division_id", selectedDivisions);
    setSaving(false);
    if (error) {
      setAssignNote(error.message);
      return;
    }
    setAssignNote(`${selectedCount} assigned to ${jobLabel(jobById.get(bulkJob))}`);
    setSelectedDivisions([]);
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  return (
    <PortalShell
      title="Operations"
      subtitle="Live crew status · time entries · job assignments"
      actions={
        <>
          <span className="rounded-lg bg-emerald/10 px-3 py-2 text-emerald ring-1 ring-emerald/20">
            ● {open.length} on site
          </span>
          <span className="rounded-lg bg-ink px-3 py-2 font-mono text-primary-foreground">
            Week {weekNumber(today)}
          </span>
        </>
      }
    >
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 flex animate-rise flex-col gap-3 lg:col-span-3">
          <Panel className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
                Clocked In
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {open.length} active
              </span>
            </div>
            <ul className="space-y-2">
              {open.slice(0, 8).map((entry) => {
                const emp = employeeById.get(entry.employee_id);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center gap-2.5 rounded-lg bg-card/70 px-3 py-2.5"
                  >
                    <span className="h-2 w-2 animate-blip rounded-full bg-emerald" />
                    <div className="flex-1 leading-tight">
                      <div className="text-[13px] font-semibold">
                        {emp ? fullName(emp) : "Unknown"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {jobLabel(jobById.get(entry.job_id ?? ""))}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-steel">
                      {formatTime(entry.clock_in)}
                    </span>
                  </li>
                );
              })}
              {open.length === 0 && (
                <li className="rounded-lg bg-card/70 px-3 py-4 text-center text-[12px] text-muted-foreground">
                  Nobody is clocked in right now.
                </li>
              )}
            </ul>
            {open.length > 8 && (
              <div className="mt-3 border-t border-line/70 pt-3 text-[11px] font-medium text-muted-foreground">
                +{open.length - 8} more on site
              </div>
            )}
          </Panel>

          <div className="animate-rise rounded-2xl bg-ink p-4 text-primary-foreground">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary-foreground/50">
              This Week
            </div>
            <div className="mt-2 font-mono text-3xl">{totalHours.toFixed(1)}</div>
            <div className="mt-1 text-[12px] text-primary-foreground/60">
              hours logged Monday–Saturday
            </div>
          </div>
        </div>

        <Panel className="col-span-12 flex flex-col overflow-hidden lg:col-span-6">
          <div className="flex items-center gap-2 border-b border-line/70 px-4 py-3">
            <span className="text-[13px] font-bold">Time Entries</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              Week {weekNumber(today)}
            </span>
            <Link
              to="/time-entries"
              className="ml-auto rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5 hover:bg-card"
            >
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 font-semibold">Job</th>
                  <th className="px-3 py-2.5 font-semibold">In</th>
                  <th className="px-3 py-2.5 font-semibold">Out</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Hrs</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => {
                  const emp = employeeById.get(entry.employee_id);
                  return (
                    <tr key={entry.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{emp ? fullName(emp) : "Unknown"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {divisionById.get(emp?.division_id ?? "")?.name ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-steel">
                        {jobLabel(jobById.get(entry.job_id ?? ""))}
                      </td>
                      <td className="px-3 py-3 font-mono text-steel">
                        {formatTime(entry.clock_in)}
                      </td>
                      <td className="px-3 py-3 font-mono text-steel">
                        {formatTime(entry.clock_out)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">
                        {entryHours(entry).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span className="font-medium">
              {weekEntries.length} entries · {employees.length} employees
            </span>
            <span className="font-mono">Updates live</span>
          </div>
        </Panel>

        <Panel className="col-span-12 flex flex-col p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              Bulk Assign
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">By division</span>
          </div>
          <div className="mb-4 space-y-2">
            {divisions.map((d) => {
              const checked = selectedDivisions.includes(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() =>
                    setSelectedDivisions((prev) =>
                      checked ? prev.filter((id) => id !== d.id) : [...prev, d.id],
                    )
                  }
                  className="flex w-full items-center gap-2.5 rounded-lg bg-card/80 px-3 py-2 text-[13px]"
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-[5px] text-[10px] font-bold ${
                      checked ? "bg-amber text-ink" : "ring-1 ring-line"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  {d.name}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {divisionCounts.get(d.id) ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="mb-3 block rounded-lg bg-ink/5 px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">
              Assign to job
            </span>
            <select
              value={bulkJob}
              onChange={(e) => setBulkJob(e.target.value)}
              className="mt-1 w-full bg-transparent text-[13px] font-semibold"
            >
              <option value="">Choose a job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          </label>
          <div className="mb-4 text-[12px] text-muted-foreground">
            {assignNote ||
              `${selectedCount} employees selected across ${selectedDivisions.length} divisions`}
          </div>
          <button
            onClick={bulkAssign}
            disabled={saving || !bulkJob || selectedCount === 0}
            className="skew-btn mt-auto w-full rounded-xl bg-amber py-3.5 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:opacity-40"
          >
            <span>{saving ? "Assigning…" : `Assign ${selectedCount} to Job`}</span>
          </button>
        </Panel>

      </div>
    </PortalShell>
  );
}

