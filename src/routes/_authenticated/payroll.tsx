import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import logoAsset from "@/assets/eci-logo";
import { Panel, PortalShell } from "@/components/PortalShell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccess } from "@/hooks/use-access";
import {
  useDivisions,
  useEmployees,
  useJobs,
  usePayPeriods,
  useRangeEntries,
} from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import { exportEmployeeReportsPdf } from "@/lib/employee-report-pdf";
import { isStalePunch } from "@/lib/time-rules";
import {
  OVERTIME_THRESHOLD,
  entryHours,
  formatDay,
  fullName,
  jobLabel,
  parseDateKey,
  toDateKey,
  weekDays,
  weekEnd,
  weekStart,
  weekNumber,
} from "@/lib/timekeeping";

async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load logo: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — TimeX" },
      {
        name: "description",
        content: "Weekly hours review with overtime flags and payroll export.",
      },
      { property: "og:title", content: "Payroll — TimeX" },
      {
        property: "og:description",
        content: "Weekly hours review with overtime flags and payroll export.",
      },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  const { access } = useAccess();
  const queryClient = useQueryClient();
  const [anchorKey, setAnchorKey] = useState(toDateKey(new Date()));
  const anchor = useMemo(() => parseDateKey(anchorKey), [anchorKey]);
  const [periodBusy, setPeriodBusy] = useState(false);
  const [periodMessage, setPeriodMessage] = useState<string | null>(null);

  const from = toDateKey(weekStart(anchor));
  const to = toDateKey(weekEnd(anchor));
  const days = weekDays(anchor);

  const { data: entries = [] } = useRangeEntries(from, to);
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();
  const payPeriods = usePayPeriods();
  const period = payPeriods.periodFor(from);
  const closed = period?.status === "closed";
  const canClose = access.isAdmin || access.isPayroll;

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    return employees
      .map((emp) => {
        const mine = entries.filter((e) => e.employee_id === emp.id);
        const perDay = days.map((day) => {
          const key = toDateKey(day);
          return mine
            .filter((e) => e.work_date === key && e.entry_type === "work")
            .reduce((sum, e) => sum + entryHours(e), 0);
        });
        const workTotal = perDay.reduce((a, b) => a + b, 0);
        const ptoHours = mine
          .filter((e) => e.entry_type === "pto")
          .reduce((sum, e) => sum + entryHours(e), 0);
        const holidayHours = mine
          .filter((e) => e.entry_type === "holiday")
          .reduce((sum, e) => sum + entryHours(e), 0);
        const total = workTotal + ptoHours + holidayHours;
        return { emp, perDay, workTotal, total, ptoHours, holidayHours };
      })
      .sort((a, b) => {
        const hasA = a.total > 0 ? 1 : 0;
        const hasB = b.total > 0 ? 1 : 0;
        if (hasA !== hasB) return hasB - hasA;
        const divA = divisionById.get(a.emp.division_id ?? "")?.name ?? "";
        const divB = divisionById.get(b.emp.division_id ?? "")?.name ?? "";
        if (divA !== divB) return divA.localeCompare(divB);
        return fullName(a.emp).localeCompare(fullName(b.emp));
      });
  }, [employees, entries, days, divisionById]);

  const grand = rows.reduce((sum, r) => sum + r.total, 0);
  const otPeople = rows.filter((r) => r.workTotal > OVERTIME_THRESHOLD);
  // Overtime comes from worked hours only — PTO and holiday never count toward 40.
  const overtimeTotal = rows.reduce(
    (sum, r) => sum + Math.max(0, r.workTotal - OVERTIME_THRESHOLD),
    0,
  );

  // Punches that will be paid wrong unless someone acts: still open, or landed after close.
  const stale = useMemo(() => entries.filter((e) => isStalePunch(e)), [entries]);
  const afterClose = useMemo(() => entries.filter((e) => e.after_close), [entries]);
  const nameOf = (employeeId: string) => {
    const emp = employeeById.get(employeeId);
    return emp ? fullName(emp) : "Unknown";
  };

  const statusLine = closed
    ? `Week closed ${new Date(period!.closed_at).toLocaleString()}${
        period!.closed_by_name ? ` by ${period!.closed_by_name}` : ""
      }`
    : "Week open";

  async function closeWeek() {
    if (!canClose) return;
    const warnings = [
      stale.length
        ? `${stale.length} punch${stale.length === 1 ? "" : "es"} still need a clock-out`
        : null,
    ].filter(Boolean);
    const confirmed = window.confirm(
      `Close the payroll week of ${formatDay(from)} through ${formatDay(to)}?\n\n` +
        `Time in this week can then only be changed by an administrator. Late kiosk punches are still recorded and flagged.` +
        (warnings.length ? `\n\nHeads up: ${warnings.join("; ")}.` : ""),
    );
    if (!confirmed) return;
    setPeriodBusy(true);
    setPeriodMessage(null);
    const { error } = period
      ? await supabase.from("pay_periods").update({ status: "closed" }).eq("week_start", from)
      : await supabase.from("pay_periods").insert({ week_start: from });
    setPeriodBusy(false);
    if (error) {
      setPeriodMessage(error.message);
      return;
    }
    setPeriodMessage("Week closed.");
    queryClient.invalidateQueries({ queryKey: ["pay-periods"] });
  }

  async function reopenWeek() {
    if (!access.isAdmin) return;
    if (
      !window.confirm(
        `Reopen the week of ${formatDay(from)}? Payroll users will be able to edit it again.`,
      )
    ) {
      return;
    }
    setPeriodBusy(true);
    setPeriodMessage(null);
    const { error } = await supabase
      .from("pay_periods")
      .update({ status: "open" })
      .eq("week_start", from);
    setPeriodBusy(false);
    if (error) {
      setPeriodMessage(error.message);
      return;
    }
    setPeriodMessage("Week reopened.");
    queryClient.invalidateQueries({ queryKey: ["pay-periods"] });
  }

  function exportCsv() {
    const header = [
      "Employee",
      "Group",
      "Assigned Job",
      ...days.map((d) =>
        d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }),
      ),
      "PTO Hours",
      "Holiday Hours",
      "Total Hours",
      "Regular Hours",
      "Overtime Hours",
    ];
    const lines = rows.map((r) => {
      const ot = Math.max(0, r.workTotal - OVERTIME_THRESHOLD);
      return [
        fullName(r.emp),
        divisionById.get(r.emp.division_id ?? "")?.name ?? "",
        jobLabel(jobById.get(r.emp.assigned_job_id ?? "")),
        ...r.perDay.map((h) => h.toFixed(2)),
        r.ptoHours.toFixed(2),
        r.holidayHours.toFixed(2),
        r.total.toFixed(2),
        (r.workTotal - ot).toFixed(2),
        ot.toFixed(2),
      ];
    });
    const csv = [
      [`Payroll week ${from} to ${to}`, statusLine, `Exported ${new Date().toLocaleString()}`],
      header,
      ...lines,
    ]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `timex-payroll-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const overtimeHours = overtimeTotal;

    const logoBase64 = await imageToBase64(logoAsset.url);
    const pageWidth = doc.internal.pageSize.getWidth();
    const logoWidth = 80;
    const logoHeight = logoWidth * (164 / 150);
    doc.addImage(logoBase64, "PNG", (pageWidth - logoWidth) / 2, 18, logoWidth, logoHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TimeX Payroll Breakdown", 36, 118);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Payroll week: ${from} through ${to} (Sunday-Saturday)    ${statusLine}`, 36, 135);
    doc.text(
      `Employees: ${rows.length}    Total hours: ${grand.toFixed(2)}    Overtime hours: ${overtimeHours.toFixed(2)}    Exported ${new Date().toLocaleString()}`,
      36,
      149,
    );

    autoTable(doc, {
      startY: 163,
      head: [
        [
          "Employee",
          "Group",
          "Assigned Job",
          ...days.map((day) =>
            day.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }),
          ),
          "PTO",
          "Holiday",
          "Regular",
          "OT",
          "Total",
        ],
      ],
      body: rows.map((row) => {
        const overtime = Math.max(0, row.workTotal - OVERTIME_THRESHOLD);
        return [
          fullName(row.emp),
          divisionById.get(row.emp.division_id ?? "")?.name ?? "",
          jobLabel(jobById.get(row.emp.assigned_job_id ?? "")),
          ...row.perDay.map((hours) => (hours ? hours.toFixed(2) : "-")),
          row.ptoHours ? row.ptoHours.toFixed(2) : "-",
          row.holidayHours ? row.holidayHours.toFixed(2) : "-",
          (row.workTotal - overtime).toFixed(2),
          overtime ? overtime.toFixed(2) : "-",
          row.total.toFixed(2),
        ];
      }),
      foot: [
        [
          "TOTAL",
          "",
          "",
          ...days.map((_, index) =>
            rows.reduce((sum, row) => sum + (row.perDay[index] ?? 0), 0).toFixed(2),
          ),
          rows.reduce((sum, row) => sum + row.ptoHours, 0).toFixed(2),
          rows.reduce((sum, row) => sum + row.holidayHours, 0).toFixed(2),
          rows
            .reduce((sum, row) => sum + Math.min(row.workTotal, OVERTIME_THRESHOLD), 0)
            .toFixed(2),
          overtimeHours.toFixed(2),
          grand.toFixed(2),
        ],
      ],
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 3, textColor: [28, 35, 43] },
      headStyles: { fillColor: [28, 35, 43], textColor: [255, 255, 255], fontStyle: "bold" },
      footStyles: { fillColor: [235, 238, 240], textColor: [28, 35, 43], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 60 },
        2: { cellWidth: 80 },
      },
      margin: { left: 36, right: 36 },
      didDrawPage: ({ pageNumber }) => {
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.text(`TimeX · Page ${pageNumber}`, 36, doc.internal.pageSize.height - 18);
      },
    });

    doc.save(`timex-payroll-${from}-to-${to}.pdf`);
  }

  async function exportPerEmployeePdf() {
    const ok = await exportEmployeeReportsPdf({
      employees: rows.map((r) => r.emp),
      entries,
      jobs,
      divisions,
      from,
      to,
      fileName: `timex-payroll-by-employee-${from}-to-${to}.pdf`,
      title: "Payroll week",
    });
    if (!ok) window.alert("No hours recorded for this week.");
  }

  return (
    <PortalShell
      title="Payroll"
      subtitle={`Week of ${from} through ${to} · Sunday–Saturday`}
      actions={
        <>
          <input
            type="date"
            value={anchorKey}
            onChange={(e) => setAnchorKey(e.target.value)}
            className="rounded-lg bg-card/70 px-3 py-2 text-steel ring-1 ring-ink/5"
          />
          <span className="rounded-lg bg-ink px-3 py-2 font-mono text-primary-foreground">
            Week {weekNumber(anchor)}
          </span>
          {closed ? (
            <span className="rounded-lg bg-emerald/10 px-3 py-2 font-semibold text-emerald ring-1 ring-emerald/30">
              Closed
            </span>
          ) : canClose ? (
            <Button
              variant="outline"
              disabled={periodBusy}
              onClick={() => void closeWeek()}
              className="text-[13px]"
            >
              Close week
            </Button>
          ) : null}
          {closed && access.isAdmin && (
            <Button
              variant="outline"
              disabled={periodBusy}
              onClick={() => void reopenWeek()}
              className="text-[13px]"
            >
              Reopen
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-amber font-display text-[14px] text-ink hover:bg-amber-deep">
                Download <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={exportCsv}>
                <FileSpreadsheet aria-hidden="true" />
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPdf()}>
                <FileText aria-hidden="true" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPerEmployeePdf()}>
                <FileText aria-hidden="true" />
                PDF — one per employee
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="mb-2 flex flex-col items-center justify-center">
        <img
          src={logoAsset.url}
          alt="Electrical Contractor Inc. logo"
          className="h-20 w-auto object-contain"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span
          className={`rounded-lg px-3 py-1.5 font-semibold ring-1 ${
            closed
              ? "bg-emerald/10 text-emerald ring-emerald/30"
              : "bg-card/70 text-steel ring-ink/5"
          }`}
        >
          {statusLine}
        </span>
        {period?.status === "open" && period.reopened_at && (
          <span className="text-muted-foreground">
            reopened {new Date(period.reopened_at).toLocaleString()}
            {period.reopened_by_name ? ` by ${period.reopened_by_name}` : ""}
          </span>
        )}
        {periodMessage && <span className="text-steel">{periodMessage}</span>}
      </div>

      {(stale.length > 0 || afterClose.length > 0) && (
        <div className="mb-3 grid gap-3 lg:grid-cols-2">
          {stale.length > 0 && (
            <div className="rounded-xl bg-amber/10 px-4 py-3 text-[13px] ring-1 ring-amber/30">
              <div className="font-semibold text-amber-deep">
                {stale.length} punch{stale.length === 1 ? "" : "es"} still need a clock-out
              </div>
              <p className="mt-1 text-steel">
                These count as zero hours until the time is set:{" "}
                {stale
                  .slice(0, 6)
                  .map((e) => `${nameOf(e.employee_id)} (${formatDay(e.work_date)})`)
                  .join(", ")}
                {stale.length > 6 ? ` and ${stale.length - 6} more` : ""}.{" "}
                <Link to="/time-entries" className="font-semibold underline decoration-dotted">
                  Fix in Time Entries
                </Link>
              </p>
            </div>
          )}
          {afterClose.length > 0 && (
            <div className="rounded-xl bg-rose/10 px-4 py-3 text-[13px] ring-1 ring-rose/30">
              <div className="font-semibold text-rose">
                {afterClose.length} punch{afterClose.length === 1 ? "" : "es"} arrived after this
                week was closed
              </div>
              <p className="mt-1 text-steel">
                Recorded from a kiosk after close, so they are not in the export you already ran:{" "}
                {afterClose
                  .slice(0, 6)
                  .map((e) => `${nameOf(e.employee_id)} (${formatDay(e.work_date)})`)
                  .join(", ")}
                {afterClose.length > 6 ? ` and ${afterClose.length - 6} more` : ""}. Decide on a
                correction run or an adjustment on the next week.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: "Total hours", value: grand.toFixed(1) },
          { label: "Employees paid", value: String(rows.length) },
          { label: "Over 40 hrs worked", value: String(otPeople.length) },
          {
            label: "Overtime hours",
            value: overtimeTotal.toFixed(1),
          },
          {
            label: "PTO hours",
            value: rows.reduce((sum, r) => sum + r.ptoHours, 0).toFixed(1),
          },
          {
            label: "Holiday hours",
            value: rows.reduce((sum, r) => sum + r.holidayHours, 0).toFixed(1),
          },
        ].map((stat) => (
          <Panel key={stat.label} className="animate-rise p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              {stat.label}
            </div>
            <div className="mt-1 font-mono text-3xl">{stat.value}</div>
          </Panel>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="px-3 py-2.5 text-right font-semibold">
                    {d.toLocaleDateString([], { weekday: "short" })}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold">PTO</th>
                <th className="px-3 py-2.5 text-right font-semibold">Holiday</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ot = r.workTotal > OVERTIME_THRESHOLD;
                const needsClockOut = stale.some((e) => e.employee_id === r.emp.id);
                return (
                  <tr key={r.emp.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">
                        {fullName(r.emp)}
                        {needsClockOut && (
                          <span className="ml-2 rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-deep">
                            Needs clock-out
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {divisionById.get(r.emp.division_id ?? "")?.name ?? "—"}
                      </div>
                    </td>
                    {r.perDay.map((h, i) => (
                      <td key={i} className="px-3 py-2.5 text-right font-mono text-steel">
                        {h ? h.toFixed(2) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-mono text-steel">
                      {r.ptoHours ? r.ptoHours.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-steel">
                      {r.holidayHours ? r.holidayHours.toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`rounded px-2 py-1 font-mono font-bold ${
                          ot ? "bg-amber/20 text-amber-deep" : ""
                        }`}
                      >
                        {r.total.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={days.length + 4}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No hours recorded for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </PortalShell>
  );
}
