import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import logoAsset from "@/assets/eci-logo.png.asset.json";
import { Panel, PortalShell } from "@/components/PortalShell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDivisions,
  useEmployees,
  useJobs,
  useOpenEntries,
  useRangeEntries,
  useWeekEntries,
} from "@/hooks/use-timekeeping";
import {
  buildRows,
  dayKeysBetween,
  formatHours,
  hoursByDay,
  hoursByJob,
  sumRows,
  type GroupBy,
  type ReportRow,
  type SortBy,
} from "@/lib/reporting";
import { exportEmployeeReportsPdf } from "@/lib/employee-report-pdf";
import {
  entryHours,
  formatTime,
  fullName,
  jobLabel,
  parseDateKey,
  toDateKey,
  weekEnd,
  weekStart,
} from "@/lib/timekeeping";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "TimeX" },
      {
        name: "description",
        content: "Hours reports by employee, division, job, or company with charts and exports.",
      },
      { property: "og:title", content: "Reports — TimeX" },
      {
        property: "og:description",
        content: "Hours reports by employee, division, job, or company with charts and exports.",
      },
    ],
  }),
  component: ReportsPage,
});

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "this-year" | "custom";

const COLUMN_KEYS = ["regular", "overtime", "pto", "holiday", "total"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  regular: "Regular",
  overtime: "Overtime",
  pto: "PTO",
  holiday: "Holiday",
  total: "Total",
};

const PIE_COLORS = ["#1c232b", "#f0b323", "#5b7186", "#9fb3c2"];

function presetRange(preset: Preset, today = new Date()): { from: string; to: string } | null {
  const start = new Date(today);
  switch (preset) {
    case "this-week":
      return { from: toDateKey(weekStart(start)), to: toDateKey(weekEnd(start)) };
    case "last-week": {
      const prev = new Date(weekStart(start));
      prev.setDate(prev.getDate() - 7);
      return { from: toDateKey(weekStart(prev)), to: toDateKey(weekEnd(prev)) };
    }
    case "this-month":
      return {
        from: toDateKey(new Date(start.getFullYear(), start.getMonth(), 1)),
        to: toDateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
      };
    case "last-month":
      return {
        from: toDateKey(new Date(start.getFullYear(), start.getMonth() - 1, 1)),
        to: toDateKey(new Date(start.getFullYear(), start.getMonth(), 0)),
      };
    case "this-year":
      return {
        from: toDateKey(new Date(start.getFullYear(), 0, 1)),
        to: toDateKey(new Date(start.getFullYear(), 11, 31)),
      };
    default:
      return null;
  }
}

async function svgToPngDataUrl(svg: SVGSVGElement, scale = 2): Promise<string | null> {
  try {
    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const source = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function ReportsPage() {
  const today = new Date();
  const defaults = presetRange("this-week", today)!;

  const [preset, setPreset] = useState<Preset>("this-week");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [groupBy, setGroupBy] = useState<GroupBy>("employee");
  const [sortBy, setSortBy] = useState<SortBy>("last");
  const [divisionId, setDivisionId] = useState("all");
  const [jobId, setJobId] = useState("all");
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>({
    regular: true,
    overtime: true,
    pto: true,
    holiday: true,
    total: true,
  });
  const [showJobBreakdown, setShowJobBreakdown] = useState(false);
  const [showCharts, setShowCharts] = useState(true);

  const chartsRef = useRef<HTMLDivElement>(null);

  const { data: entries = [] } = useRangeEntries(from, to);
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();
  const { data: open = [] } = useOpenEntries();

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  function applyPreset(next: Preset) {
    setPreset(next);
    const range = presetRange(next, new Date());
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
  }

  function shiftWeek(direction: -1 | 1) {
    const anchor = parseDateKey(from);
    anchor.setDate(anchor.getDate() + direction * 7);
    setPreset("custom");
    setFrom(toDateKey(weekStart(anchor)));
    setTo(toDateKey(weekEnd(anchor)));
  }

  /** Employees left after the division / job / name filters. */
  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (divisionId !== "all" && emp.division_id !== divisionId) return false;
      if (term && !fullName(emp).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [employees, divisionId, search]);

  const allowedEmployeeIds = useMemo(
    () => new Set(filteredEmployees.map((e) => e.id)),
    [filteredEmployees],
  );

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (!allowedEmployeeIds.has(entry.employee_id)) return false;
        if (jobId !== "all" && entry.job_id !== jobId) return false;
        return true;
      }),
    [entries, allowedEmployeeIds, jobId],
  );

  const rows = useMemo(
    () =>
      buildRows({
        entries: filteredEntries,
        employees: filteredEmployees,
        jobs,
        divisions,
        groupBy,
        sortBy,
        includeEmptyEmployees: true,
      }),
    [filteredEntries, filteredEmployees, jobs, divisions, groupBy, sortBy],
  );

  const totals = useMemo(() => sumRows(rows), [rows]);
  const jobChart = useMemo(() => hoursByJob(filteredEntries, jobs).slice(0, 12), [filteredEntries, jobs]);
  const dayChart = useMemo(() => hoursByDay(filteredEntries, from, to), [filteredEntries, from, to]);
  const mixChart = useMemo(
    () => [
      { name: "Regular", value: Math.round(totals.regular * 100) / 100 },
      { name: "Overtime", value: Math.round(totals.overtime * 100) / 100 },
      { name: "PTO", value: Math.round(totals.pto * 100) / 100 },
      { name: "Holiday", value: Math.round(totals.holiday * 100) / 100 },
    ],
    [totals],
  );

  const openFiltered = useMemo(
    () => open.filter((entry) => allowedEmployeeIds.has(entry.employee_id)),
    [open, allowedEmployeeIds],
  );

  // Always the live payroll week, independent of the selected report range.
  const { data: currentWeekEntries = [] } = useWeekEntries(today);
  const workedThisWeek = useMemo(() => {
    const ids = new Set(
      currentWeekEntries
        .filter((e) => e.entry_type === "work" && allowedEmployeeIds.has(e.employee_id))
        .map((e) => e.employee_id),
    );
    return ids.size;
  }, [currentWeekEntries, allowedEmployeeIds]);

  const activeColumns = COLUMN_KEYS.filter((key) => columns[key]);
  const dayKeys = dayKeysBetween(from, to);
  const groupLabel =
    groupBy === "employee"
      ? "Employee"
      : groupBy === "division"
        ? "Division"
        : groupBy === "job"
          ? "Job"
          : "Company";

  const filtersSummary = [
    divisionId === "all" ? null : `Division: ${divisions.find((d) => d.id === divisionId)?.name}`,
    jobId === "all" ? null : `Job: ${jobLabel(jobById.get(jobId))}`,
    search.trim() ? `Search: ${search.trim()}` : null,
  ]
    .filter(Boolean)
    .join("    ");

  const fileBase = `timex-report-${groupBy}-${from}-to-${to}`;

  function exportCsv() {
    const header = [groupLabel, "Detail", ...activeColumns.map((c) => COLUMN_LABELS[c])];
    const lines: string[][] = [];
    for (const row of rows) {
      lines.push([row.label, row.sublabel, ...activeColumns.map((c) => row[c].toFixed(2))]);
      if (showJobBreakdown) {
        for (const [job, hours] of Object.entries(row.perJob).sort((a, b) => b[1] - a[1])) {
          lines.push([
            "",
            job,
            ...activeColumns.map((c) => (c === "total" ? hours.toFixed(2) : "")),
          ]);
        }
      }
    }
    lines.push(["TOTAL", "", ...activeColumns.map((c) => totals[c].toFixed(2))]);
    const csv = [header, ...lines]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileBase}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();

    const logoBase64 = await imageToBase64(logoAsset.url);
    const logoWidth = 80;
    const logoHeight = logoWidth * (164 / 150);
    doc.addImage(logoBase64, "PNG", (pageWidth - logoWidth) / 2, 18, logoWidth, logoHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`TimeX Hours Report — by ${groupLabel}`, 36, 118);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Period: ${from} through ${to}`, 36, 134);
    doc.text(
      `Regular ${totals.regular.toFixed(2)}    Overtime ${totals.overtime.toFixed(2)}    PTO ${totals.pto.toFixed(2)}    Holiday ${totals.holiday.toFixed(2)}    Total ${totals.total.toFixed(2)}`,
      36,
      148,
    );
    if (filtersSummary) doc.text(filtersSummary, 36, 162);

    let cursorY = filtersSummary ? 176 : 162;

    if (showCharts && chartsRef.current) {
      // One chart per panel — skip the small legend swatch SVGs.
      const svgs = [...chartsRef.current.querySelectorAll("section")]
        .map((section) => section.querySelector<SVGSVGElement>("svg.recharts-surface"))
        .filter((svg): svg is SVGSVGElement => Boolean(svg));
      const images = (await Promise.all(svgs.slice(0, 3).map((svg) => svgToPngDataUrl(svg)))).filter(
        (src): src is string => Boolean(src),
      );
      if (images.length) {
        const gap = 12;
        const available = pageWidth - 72 - gap * (images.length - 1);
        const width = available / images.length;
        const height = 150;
        images.forEach((src, index) => {
          doc.addImage(src, "PNG", 36 + index * (width + gap), cursorY, width, height);
        });
        cursorY += height + 16;
      }
    }

    const body: string[][] = [];
    for (const row of rows) {
      body.push([
        row.label,
        row.sublabel,
        ...activeColumns.map((c) => (row[c] ? row[c].toFixed(2) : "-")),
      ]);
      if (showJobBreakdown) {
        for (const [job, hours] of Object.entries(row.perJob).sort((a, b) => b[1] - a[1])) {
          body.push([
            "",
            `   ${job}`,
            ...activeColumns.map((c) => (c === "total" ? hours.toFixed(2) : "-")),
          ]);
        }
      }
    }

    autoTable(doc, {
      startY: cursorY,
      head: [[groupLabel, "Detail", ...activeColumns.map((c) => COLUMN_LABELS[c])]],
      body,
      foot: [["TOTAL", "", ...activeColumns.map((c) => totals[c].toFixed(2))]],
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: [28, 35, 43] },
      headStyles: { fillColor: [28, 35, 43], textColor: [255, 255, 255], fontStyle: "bold" },
      footStyles: { fillColor: [235, 238, 240], textColor: [28, 35, 43], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: 160 } },
      margin: { left: 36, right: 36 },
      didDrawPage: ({ pageNumber }) => {
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.text(`TimeX · Page ${pageNumber}`, 36, doc.internal.pageSize.height - 18);
      },
    });

    doc.save(`${fileBase}.pdf`);
  }

  async function exportPerEmployeePdf() {
    const ordered = [...filteredEmployees].sort((a, b) =>
      sortBy === "last"
        ? `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
        : `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
    );
    const ok = await exportEmployeeReportsPdf({
      employees: ordered,
      entries: filteredEntries,
      jobs,
      divisions,
      from,
      to,
      fileName: `timex-report-by-employee-${from}-to-${to}.pdf`,
      title: "Hours report",
    });
    if (!ok) window.alert("No hours in this period for the selected filters.");
  }

  return (
    <PortalShell
      title="Reports"
      subtitle={`${from} through ${to} · grouped by ${groupLabel.toLowerCase()}`}
      actions={
        <>
          <Button
            variant="outline"
            className="print-hide"
            onClick={() => window.print()}
          >
            <Printer aria-hidden="true" /> Print
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-amber font-display text-[14px] text-ink hover:bg-amber-deep">
                Download <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={exportCsv}>
                <FileSpreadsheet aria-hidden="true" /> Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPdf()}>
                <FileText aria-hidden="true" /> Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPerEmployeePdf()}>
                <FileText aria-hidden="true" /> PDF — one per employee
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {/* Live tiles */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Clocked in now", value: String(openFiltered.length) },
          { label: "Worked this week", value: String(workedThisWeek) },
          { label: "Total hours", value: totals.total.toFixed(1) },
          { label: "Overtime hours", value: totals.overtime.toFixed(1) },
        ].map((stat) => (
          <Panel key={stat.label} className="animate-rise p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              {stat.label}
            </div>
            <div className="mt-1 font-mono text-3xl">{stat.value}</div>
          </Panel>
        ))}
      </div>

      {/* Controls */}
      <Panel className="print-hide mb-3 p-4">
        <div className="flex flex-wrap items-end gap-3 text-[12px]">
          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Report</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            >
              <option value="employee">Per employee</option>
              <option value="division">Per division</option>
              <option value="job">Per job</option>
              <option value="company">Company total</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Period</span>
            <select
              value={preset}
              onChange={(e) => applyPreset(e.target.value as Preset)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            >
              <option value="this-week">This week</option>
              <option value="last-week">Last week</option>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="this-year">This year</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <div className="flex items-end gap-1">
            <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>
              ‹ Week
            </Button>
            <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}>
              Week ›
            </Button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset("custom");
                setFrom(e.target.value);
              }}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset("custom");
                setTo(e.target.value);
              }}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Division</span>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            >
              <option value="all">All divisions</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Job</span>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            >
              <option value="all">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Employee</span>
            <input
              type="search"
              value={search}
              placeholder="Search name"
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg bg-card/70 px-3 py-2 ring-1 ring-ink/5"
            >
              <option value="last">Last name</option>
              <option value="first">First name</option>
            </select>
          </label>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDivisionId("all");
              setJobId("all");
              setSearch("");
              applyPreset("this-week");
              setGroupBy("employee");
            }}
          >
            Clear
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line/70 pt-3 text-[12px]">
          <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Columns</span>
          {COLUMN_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={columns[key]}
                onChange={(e) => setColumns((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {COLUMN_LABELS[key]}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showJobBreakdown}
              onChange={(e) => setShowJobBreakdown(e.target.checked)}
            />
            Break down by job
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showCharts}
              onChange={(e) => setShowCharts(e.target.checked)}
            />
            Include charts
          </label>
        </div>
      </Panel>

      {/* Charts */}
      {showCharts && (
        <div ref={chartsRef} className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Panel className="p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              Hours per job
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobChart} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8ee" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={54} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="hours" fill="#1c232b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              Regular vs overtime vs paid leave
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mixChart} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                    {mixChart.map((slice, index) => (
                      <Cell key={slice.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              Hours per day
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dayChart} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8ee" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="worked" stroke="#1c232b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="paidLeave" stroke="#f0b323" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}

      {/* Clocked in now */}
      {openFiltered.length > 0 && (
        <Panel className="mb-3 p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
            Clocked in right now · {openFiltered.length}
          </div>
          <ul className="grid grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
            {openFiltered.map((entry) => {
              const emp = employeeById.get(entry.employee_id);
              return (
                <li key={entry.id} className="flex items-center justify-between gap-2 rounded-md bg-ink/[0.03] px-3 py-2">
                  <span className="font-semibold">{emp ? fullName(emp) : "Unknown"}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {jobLabel(jobById.get(entry.job_id ?? ""))} · {formatTime(entry.clock_in)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* Report table */}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">{groupLabel}</th>
                {activeColumns.map((key) => (
                  <th key={key} className="px-3 py-2.5 text-right font-semibold">
                    {COLUMN_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: ReportRow) => (
                <RowBlock
                  key={row.key}
                  row={row}
                  activeColumns={activeColumns}
                  showJobBreakdown={showJobBreakdown}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={activeColumns.length + 1}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No hours in this period for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line/70 bg-ink/[0.03] font-semibold">
                <td className="px-4 py-2.5">Total · {rows.length} rows</td>
                {activeColumns.map((key) => (
                  <td key={key} className="px-3 py-2.5 text-right font-mono">
                    {totals[key].toFixed(2)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-line/70 px-4 py-2 text-[11px] text-muted-foreground">
          Overtime is worked hours above 40 in a Sunday–Saturday week. PTO and holiday are paid but
          never count toward the 40. Covers {dayKeys.length} days.
        </div>
      </Panel>
    </PortalShell>
  );
}

function RowBlock({
  row,
  activeColumns,
  showJobBreakdown,
}: {
  row: ReportRow;
  activeColumns: ColumnKey[];
  showJobBreakdown: boolean;
}) {
  const jobsInRow = Object.entries(row.perJob).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <tr className="border-b border-line/60 hover:bg-ink/[0.02]">
        <td className="px-4 py-2.5">
          <div className="font-semibold">{row.label}</div>
          <div className="text-[11px] text-muted-foreground">{row.sublabel}</div>
        </td>
        {activeColumns.map((key) => (
          <td key={key} className="px-3 py-2.5 text-right font-mono text-steel">
            {key === "overtime" && row.overtime > 0 ? (
              <span className="rounded bg-amber/20 px-2 py-1 font-bold text-amber-deep">
                {row.overtime.toFixed(2)}
              </span>
            ) : (
              formatHours(row[key])
            )}
          </td>
        ))}
      </tr>
      {showJobBreakdown &&
        jobsInRow.map(([job, hours]) => (
          <tr key={`${row.key}-${job}`} className="border-b border-line/40 text-[12px]">
            <td className="px-8 py-1.5 text-muted-foreground">{job}</td>
            {activeColumns.map((key) => (
              <td key={key} className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                {key === "total" ? hours.toFixed(2) : "—"}
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}

/** Kept for future per-day expansion in exports. */
export const _entryHours = entryHours;
