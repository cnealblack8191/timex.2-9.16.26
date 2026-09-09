import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import {
  useDivisions,
  useEmployees,
  useJobs,
  useRangeEntries,
} from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import {
  entryHours,
  formatDay,
  formatTime,
  fromLocalInput,
  fullName,
  jobLabel,
  toDateKey,
  toLocalInput,
  weekEnd,
  weekStart,
  type TimeEntry,
} from "@/lib/timekeeping";

export const Route = createFileRoute("/time-entries")({
  head: () => ({
    meta: [
      { title: "Time Entries — ECI Timekeeping" },
      { name: "description", content: "Review and correct employee time by day, week, employee and job." },
      { property: "og:title", content: "Time Entries — ECI Timekeeping" },
      { property: "og:description", content: "Review and correct employee time by day, week, employee and job." },
    ],
  }),
  component: TimeEntriesPage,
});

function TimeEntriesPage() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(toDateKey(new Date()));
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [draft, setDraft] = useState({ clock_in: "", clock_out: "", job_id: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const anchorDate = useMemo(() => {
    const [y, m, d] = anchor.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [anchor]);

  const from = scope === "day" ? anchor : toDateKey(weekStart(anchorDate));
  const to = scope === "day" ? anchor : toDateKey(weekEnd(anchorDate));

  const { data: entries = [] } = useRangeEntries(from, to);
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const filtered = entries.filter((entry) => {
    const emp = employeeById.get(entry.employee_id);
    if (employeeFilter && entry.employee_id !== employeeFilter) return false;
    if (jobFilter && entry.job_id !== jobFilter) return false;
    if (divisionFilter && emp?.division_id !== divisionFilter) return false;
    return true;
  });

  const totalHours = filtered.reduce((sum, e) => sum + entryHours(e), 0);

  function startEdit(entry: TimeEntry) {
    setEditing(entry);
    setDraft({
      clock_in: toLocalInput(entry.clock_in),
      clock_out: toLocalInput(entry.clock_out),
      job_id: entry.job_id ?? "",
      notes: entry.notes ?? "",
    });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase
      .from("time_entries")
      .update({
        clock_in: fromLocalInput(draft.clock_in),
        clock_out: fromLocalInput(draft.clock_out),
        job_id: draft.job_id || null,
        notes: draft.notes || null,
        edited: true,
      })
      .eq("id", editing.id);
    setSaving(false);
    if (!error) {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      queryClient.invalidateQueries({ queryKey: ["open-entries"] });
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    await supabase.from("time_entries").delete().eq("id", editing.id);
    setSaving(false);
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ["entries"] });
  }

  const selectClass =
    "rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5";

  return (
    <PortalShell
      title="Time Entries"
      subtitle="Review by day, week, employee or job — and correct anything that's off"
      actions={
        <span className="rounded-lg bg-ink px-3 py-2 font-mono text-primary-foreground">
          {totalHours.toFixed(1)} hrs
        </span>
      }
    >
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-4 py-3">
            <button
              onClick={() => setScope("day")}
              className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
                scope === "day" ? "bg-ink text-primary-foreground" : "bg-card/80 text-steel ring-1 ring-ink/5"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setScope("week")}
              className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
                scope === "week" ? "bg-ink text-primary-foreground" : "bg-card/80 text-steel ring-1 ring-ink/5"
              }`}
            >
              Week
            </button>
            <input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className={selectClass}
            />
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {fullName(e)}
                </option>
              ))}
            </select>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className={selectClass}>
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-card/90 backdrop-blur">
                <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-3 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 font-semibold">Job</th>
                  <th className="px-3 py-2.5 font-semibold">In</th>
                  <th className="px-3 py-2.5 font-semibold">Out</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Hrs</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const emp = employeeById.get(entry.employee_id);
                  return (
                    <tr key={entry.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                      <td className="whitespace-nowrap px-4 py-3 text-steel">
                        {formatDay(entry.work_date)}
                      </td>
                      <td className="px-3 py-3 font-semibold">{emp ? fullName(emp) : "Unknown"}</td>
                      <td className="px-3 py-3 text-steel">
                        {entry.entry_type === "work"
                          ? jobLabel(jobById.get(entry.job_id ?? ""))
                          : entry.entry_type === "pto"
                            ? "PTO"
                            : "Vacation"}
                        {entry.job_overridden && (
                          <span className="ml-2 rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-deep">
                            Override
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-steel">{formatTime(entry.clock_in)}</td>
                      <td className="px-3 py-3 font-mono text-steel">
                        {entry.clock_in && !entry.clock_out ? (
                          <span className="text-emerald">on site</span>
                        ) : (
                          formatTime(entry.clock_out)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">
                        {entryHours(entry).toFixed(2)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => startEdit(entry)}
                          className="text-[12px] font-semibold text-amber-deep"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      No time entries for this selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span className="font-medium">{filtered.length} entries</span>
            <span className="font-mono">{totalHours.toFixed(2)} hrs total</span>
          </div>
        </Panel>

        <div className="col-span-12 xl:col-span-4">
          {editing ? (
            <Panel className="animate-slidein p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-deep">
                    Edit Entry
                  </div>
                  <div className="mt-0.5 text-[15px] font-bold">
                    {fullName(employeeById.get(editing.employee_id)!)} ·{" "}
                    {formatDay(editing.work_date)}
                  </div>
                </div>
                <button onClick={() => setEditing(null)} className="text-[12px] text-muted-foreground">
                  ✕
                </button>
              </div>

              <label className="mb-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Job</span>
                <select
                  value={draft.job_id}
                  onChange={(e) => setDraft({ ...draft, job_id: e.target.value })}
                  className="w-full bg-transparent text-[13px] font-semibold"
                >
                  <option value="">No job</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {jobLabel(j)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Clock In
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.clock_in}
                    onChange={(e) => setDraft({ ...draft, clock_in: e.target.value })}
                    className="w-full bg-transparent font-mono text-[13px] font-semibold"
                  />
                </label>
                <label className="rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Clock Out
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.clock_out}
                    onChange={(e) => setDraft({ ...draft, clock_out: e.target.value })}
                    className="w-full bg-transparent font-mono text-[13px] font-semibold"
                  />
                </label>
              </div>

              <label className="mt-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</span>
                <input
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Why the time was corrected"
                  className="w-full bg-transparent text-[13px]"
                />
              </label>

              <div className="mt-4 flex items-center justify-between">
                <button onClick={remove} className="text-[12px] font-semibold text-rose">
                  Delete entry
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </Panel>
          ) : (
            <Panel className="p-5 text-[13px] text-muted-foreground">
              Pick <span className="font-semibold text-steel">Edit</span> on any row to correct the
              times, change the job, or add a note. Corrections are marked so you can see what was
              adjusted.
            </Panel>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
