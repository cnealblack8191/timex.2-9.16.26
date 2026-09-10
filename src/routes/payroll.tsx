import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel, PortalShell } from "@/components/PortalShell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDivisions, useEmployees, useJobs, useRangeEntries } from "@/hooks/use-timekeeping";
import {
  OVERTIME_THRESHOLD,
  entryHours,
  fullName,
  jobLabel,
  parseDateKey,
  toDateKey,
  weekDays,
  weekEnd,
  weekStart,
  weekNumber,
} from "@/lib/timekeeping";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — TimeX" },
      { name: "description", content: "Weekly hours review with overtime flags and payroll export." },
      { property: "og:title", content: "Payroll — TimeX" },
      { property: "og:description", content: "Weekly hours review with overtime flags and payroll export." },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  const [anchorKey, setAnchorKey] = useState(toDateKey(new Date()));
  const anchor = useMemo(() => parseDateKey(anchorKey), [anchorKey]);

  const from = toDateKey(weekStart(anchor));
  const to = toDateKey(weekEnd(anchor));
  const days = weekDays(anchor);

  const { data: entries = [] } = useRangeEntries(from, to);
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);

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
        const vacationHours = mine
          .filter((e) => e.entry_type === "vacation")
          .reduce((sum, e) => sum + entryHours(e), 0);
        const total = workTotal + ptoHours + vacationHours;
        return { emp, perDay, total, ptoHours, vacationHours };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [employees, entries, days]);

  const grand = rows.reduce((sum, r) => sum + r.total, 0);
  const otPeople = rows.filter((r) => r.total > OVERTIME_THRESHOLD);

  function exportCsv() {
    const header = [
      "Employee",
      "Division",
      "Assigned Job",
      ...days.map((d) => d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })),
      "PTO Hours",
      "Vacation Hours",
      "Total Hours",
      "Regular Hours",
      "Overtime Hours",
    ];
    const lines = rows.map((r) => {
      const ot = Math.max(0, r.total - OVERTIME_THRESHOLD);
      return [
        fullName(r.emp),
        divisionById.get(r.emp.division_id ?? "")?.name ?? "",
        jobLabel(jobById.get(r.emp.assigned_job_id ?? "")),
        ...r.perDay.map((h) => h.toFixed(2)),
        r.ptoHours.toFixed(2),
        r.vacationHours.toFixed(2),
        r.total.toFixed(2),
        (r.total - ot).toFixed(2),
        ot.toFixed(2),
      ];
    });
    const csv = [header, ...lines]
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
    const overtimeHours = otPeople.reduce(
      (sum, row) => sum + (row.total - OVERTIME_THRESHOLD),
      0,
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("TimeX Payroll Breakdown", 36, 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Payroll week: ${from} through ${to} (Monday-Saturday)`, 36, 55);
    doc.text(
      `Employees: ${rows.length}    Total hours: ${grand.toFixed(2)}    Overtime hours: ${overtimeHours.toFixed(2)}`,
      36,
      69,
    );

    autoTable(doc, {
      startY: 83,
      head: [[
        "Employee",
        "Division",
        "Assigned Job",
        ...days.map((day) => day.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })),
        "PTO/Vac",
        "Regular",
        "OT",
        "Total",
      ]],
      body: rows.map((row) => {
        const overtime = Math.max(0, row.total - OVERTIME_THRESHOLD);
        return [
          fullName(row.emp),
          divisionById.get(row.emp.division_id ?? "")?.name ?? "",
          jobLabel(jobById.get(row.emp.assigned_job_id ?? "")),
          ...row.perDay.map((hours) => (hours ? hours.toFixed(2) : "-")),
          row.ptoHours ? row.ptoHours.toFixed(2) : "-",
          (row.total - overtime).toFixed(2),
          overtime ? overtime.toFixed(2) : "-",
          row.total.toFixed(2),
        ];
      }),
      foot: [[
        "TOTAL",
        "",
        "",
        ...days.map((_, index) =>
          rows.reduce((sum, row) => sum + (row.perDay[index] ?? 0), 0).toFixed(2),
        ),
        rows.reduce((sum, row) => sum + row.ptoHours, 0).toFixed(2),
        rows.reduce((sum, row) => sum + Math.min(row.total, OVERTIME_THRESHOLD), 0).toFixed(2),
        overtimeHours.toFixed(2),
        grand.toFixed(2),
      ]],
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

  return (
    <PortalShell
      title="Payroll"
      subtitle={`Week of ${from} through ${to} · Monday–Saturday`}
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
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total hours", value: grand.toFixed(1) },
          { label: "Employees paid", value: String(rows.length) },
          { label: "Over 40 hrs", value: String(otPeople.length) },
          {
            label: "Overtime hours",
            value: otPeople
              .reduce((sum, r) => sum + (r.total - OVERTIME_THRESHOLD), 0)
              .toFixed(1),
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
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ot = r.total > OVERTIME_THRESHOLD;
                return (
                  <tr key={r.emp.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold">{fullName(r.emp)}</div>
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
                  <td colSpan={days.length + 3} className="px-4 py-10 text-center text-muted-foreground">
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
