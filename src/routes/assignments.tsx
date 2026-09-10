import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import { useDivisions, useEmployees, useJobs } from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import { fullName, jobLabel } from "@/lib/timekeeping";

export const Route = createFileRoute("/assignments")({
  head: () => ({
    meta: [
      { title: "Job Assignments — TimeX" },
      { name: "description", content: "Assign employees to jobs individually or in bulk by division." },
      { property: "og:title", content: "Job Assignments — TimeX" },
      { property: "og:description", content: "Assign employees to jobs individually or in bulk by division." },
    ],
  }),
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();

  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkJob, setBulkJob] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);

  const visible = employees.filter((e) => {
    if (divisionFilter && e.division_id !== divisionFilter) return false;
    if (search && !fullName(e).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function assignOne(employeeId: string, jobId: string) {
    await supabase
      .from("employees")
      .update({ assigned_job_id: jobId || null })
      .eq("id", employeeId);
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  async function assignSelected() {
    if (!bulkJob || selected.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("employees")
      .update({ assigned_job_id: bulkJob })
      .in("id", selected);
    setSaving(false);
    if (error) return setNote(error.message);
    setNote(`${selected.length} employees moved to ${jobLabel(jobById.get(bulkJob))}`);
    setSelected([]);
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.includes(e.id));

  return (
    <PortalShell
      title="Assignments"
      subtitle="Each employee has one assigned job — foremen can override it at the kiosk"
      actions={
        <span className="rounded-lg bg-card/70 px-3 py-2 text-steel ring-1 ring-ink/5">
          {employees.length} employees · {jobs.length} jobs
        </span>
      }
    >
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees"
              className="rounded-md bg-card/80 px-3 py-1.5 text-[12px] ring-1 ring-ink/5"
            />
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setSelected(allVisibleSelected ? [] : visible.map((e) => e.id))
              }
              className="ml-auto rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
            >
              {allVisibleSelected ? "Clear selection" : `Select all ${visible.length}`}
            </button>
          </div>

          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card/90 backdrop-blur">
                <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 font-semibold">Division</th>
                  <th className="px-3 py-2.5 font-semibold">Assigned job</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const checked = selected.includes(e.id);
                  return (
                    <tr key={e.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() =>
                            setSelected((prev) =>
                              checked ? prev.filter((id) => id !== e.id) : [...prev, e.id],
                            )
                          }
                          className="flex items-center gap-2.5 text-left font-semibold"
                        >
                          <span
                            className={`grid h-4 w-4 place-items-center rounded-[5px] text-[10px] font-bold ${
                              checked ? "bg-amber text-ink" : "ring-1 ring-line"
                            }`}
                          >
                            {checked ? "✓" : ""}
                          </span>
                          {fullName(e)}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-steel">
                        {divisionById.get(e.division_id ?? "")?.name ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={e.assigned_job_id ?? ""}
                          onChange={(ev) => assignOne(e.id, ev.target.value)}
                          className="w-full rounded-md bg-card/80 px-2 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
                        >
                          <option value="">Unassigned</option>
                          {jobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {jobLabel(j)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="col-span-12 flex flex-col p-4 xl:col-span-4">
          <span className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
            Bulk Assign
          </span>
          <p className="mb-4 text-[13px] text-muted-foreground">
            Tick employees on the left, or filter to a division and select them all, then choose the
            job they should be on.
          </p>
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
            {note || `${selected.length} employees selected`}
          </div>
          <button
            onClick={assignSelected}
            disabled={saving || !bulkJob || selected.length === 0}
            className="skew-btn mt-auto w-full rounded-xl bg-amber py-3.5 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:opacity-40"
          >
            <span>{saving ? "Assigning…" : `Assign ${selected.length} to Job`}</span>
          </button>
        </Panel>
      </div>
    </PortalShell>
  );
}
