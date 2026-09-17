import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, PortalShell } from "@/components/PortalShell";
import {
  useDivisions,
  useEmployees,
  useJobs,
  useOpenEntries,
  useWeekEntries,
} from "@/hooks/use-timekeeping";
import { STALE_PUNCH_HOURS, isStalePunch } from "@/lib/time-rules";
import {
  entryHours,
  formatDay,
  formatTime,
  fullName,
  jobLabel,
  toDateKey,
  weekNumber,
  weekStart,
} from "@/lib/timekeeping";

export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({
    meta: [
      { title: "TimeX" },
      {
        name: "description",
        content:
          "Live crew status, time entries and job assignments for Electrical Contractor Inc.",
      },
      { property: "og:title", content: "Operations — TimeX" },
      {
        property: "og:description",
        content:
          "Live crew status, time entries and job assignments for Electrical Contractor Inc.",
      },
    ],
  }),
  component: Operations,
});

function Operations() {
  const today = new Date();
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();
  const { data: open = [] } = useOpenEntries();
  const { data: weekEntries = [] } = useWeekEntries(today);

  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);

  const recent = weekEntries.slice(0, 8);
  const totalHours = weekEntries
    .filter((e) => e.entry_type === "work")
    .reduce((sum, e) => sum + entryHours(e), 0);

  // Forgotten clock-outs first, then everyone else in punch order.
  const stale = useMemo(() => open.filter((e) => isStalePunch(e)), [open]);
  const openSorted = useMemo(
    () => [...open.filter((e) => isStalePunch(e)), ...open.filter((e) => !isStalePunch(e))],
    [open],
  );
  const afterCloseCount = weekEntries.filter((e) => e.after_close).length;

  /* ---------- charts ---------- */

  const dayChart = useMemo(() => {
    const start = weekStart(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = toDateKey(d);
      let worked = 0;
      let paidLeave = 0;
      for (const e of weekEntries) {
        if (e.work_date !== key) continue;
        if (e.entry_type === "work") worked += entryHours(e);
        else paidLeave += entryHours(e);
      }
      return {
        day: d.toLocaleDateString([], { weekday: "short" }),
        worked: Math.round(worked * 100) / 100,
        paidLeave: Math.round(paidLeave * 100) / 100,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekEntries]);

  const jobChart = useMemo(() => {
    const hours = new Map<string, number>();
    for (const e of weekEntries) {
      if (e.entry_type !== "work" || !e.job_id) continue;
      hours.set(e.job_id, (hours.get(e.job_id) ?? 0) + entryHours(e));
    }
    return [...hours.entries()]
      .map(([jobId, h]) => ({
        job: jobLabel(jobById.get(jobId)).split("·")[0]?.trim() ?? "—",
        hours: Math.round(h * 100) / 100,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);
  }, [weekEntries, jobById]);

  const onSiteByDivision = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of open) {
      const divId = employeeById.get(e.employee_id)?.division_id ?? "";
      counts.set(divId, (counts.get(divId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([divId, count]) => ({
        division: divisionById.get(divId)?.code ?? "—",
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [open, employeeById, divisionById]);

  return (
    <PortalShell
      title="Operations"
      subtitle="Live crew status · time entries · job assignments"
      actions={
        <>
          <span className="rounded-lg bg-emerald/10 px-3 py-2 text-emerald ring-1 ring-emerald/20">
            ● {open.length - stale.length} on site
          </span>
          {stale.length > 0 && (
            <Link
              to="/time-entries"
              className="rounded-lg bg-amber/15 px-3 py-2 font-semibold text-amber-deep ring-1 ring-amber/30"
            >
              {stale.length} need clock-out
            </Link>
          )}
          {afterCloseCount > 0 && (
            <Link
              to="/payroll"
              className="rounded-lg bg-rose/10 px-3 py-2 font-semibold text-rose ring-1 ring-rose/30"
            >
              {afterCloseCount} after close
            </Link>
          )}
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
              {openSorted.slice(0, 8).map((entry) => {
                const emp = employeeById.get(entry.employee_id);
                const needsClockOut = isStalePunch(entry);
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${
                      needsClockOut ? "bg-amber/10 ring-1 ring-amber/30" : "bg-card/70"
                    }`}
                    title={
                      needsClockOut
                        ? `Open for more than ${STALE_PUNCH_HOURS} hours — set the clock-out in Time Entries`
                        : undefined
                    }
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        needsClockOut ? "bg-amber" : "animate-blip bg-emerald"
                      }`}
                    />
                    <div className="flex-1 leading-tight">
                      <div className="text-[13px] font-semibold">
                        {emp ? fullName(emp) : "Unknown"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {needsClockOut
                          ? `Needs clock-out · since ${formatDay(entry.work_date)}`
                          : jobLabel(jobById.get(entry.job_id ?? ""))}
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
              hours worked Sunday–Saturday
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

        <div className="col-span-12 flex animate-rise flex-col gap-5 lg:col-span-3">
          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
                Hours by Day
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">This week</span>
            </div>
            <div className="h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dayChart} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c232b14" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="worked" name="Worked" stroke="#1c232b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="paidLeave" name="PTO / Holiday" stroke="#f0b323" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
                Hours by Job
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">Top 6</span>
            </div>
            <div className="h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobChart} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c232b14" vertical={false} />
                  <XAxis dataKey="job" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="hours" name="Hours" fill="#1c232b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
                On Site by Group
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {open.length} active
              </span>
            </div>
            <div className="h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={onSiteByDivision} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c232b14" vertical={false} />
                  <XAxis dataKey="division" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="On site" fill="#f0b323" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

      </div>
    </PortalShell>
  );
}
