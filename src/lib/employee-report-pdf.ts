import logoAsset from "@/assets/eci-logo.png.asset.json";
import { overtimeForEmployee } from "@/lib/reporting";
import {
  entryHours,
  fullName,
  parseDateKey,
  type Division,
  type Employee,
  type Job,
  type TimeEntry,
} from "@/lib/timekeeping";

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

const dayLabel = (key: string) =>
  parseDateKey(key).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const typeLabel = (type: string) =>
  type === "pto" ? "PTO" : type === "holiday" ? "Holiday" : "Work";

export type EmployeeReportOptions = {
  employees: Employee[];
  entries: TimeEntry[];
  jobs: Job[];
  divisions: Division[];
  from: string;
  to: string;
  fileName: string;
  title?: string;
};

/**
 * One page per employee: totals at the top (regular / overtime / PTO / holiday /
 * total) followed by a day-by-day breakdown of jobs, hours and notes.
 */
export async function exportEmployeeReportsPdf({
  employees,
  entries,
  jobs,
  divisions,
  from,
  to,
  fileName,
  title = "TimeX Employee Time Report",
}: EmployeeReportOptions) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoBase64 = await imageToBase64(logoAsset.url);
  const logoWidth = 64;
  const logoHeight = logoWidth * (164 / 150);

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const jobText = (id: string | null | undefined) => {
    const job = id ? jobById.get(id) : undefined;
    return job ? `#${job.number} ${job.name}` : "—";
  };

  const byEmployee = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = byEmployee.get(entry.employee_id) ?? [];
    list.push(entry);
    byEmployee.set(entry.employee_id, list);
  }

  const people = employees.filter((emp) => (byEmployee.get(emp.id) ?? []).length > 0);
  if (people.length === 0) return false;

  people.forEach((emp, index) => {
    if (index > 0) doc.addPage();
    const mine = [...(byEmployee.get(emp.id) ?? [])].sort((a, b) =>
      a.work_date === b.work_date
        ? (a.clock_in ?? "").localeCompare(b.clock_in ?? "")
        : a.work_date.localeCompare(b.work_date),
    );

    const worked = mine
      .filter((e) => e.entry_type === "work")
      .reduce((sum, e) => sum + entryHours(e), 0);
    const pto = mine.filter((e) => e.entry_type === "pto").reduce((sum, e) => sum + entryHours(e), 0);
    const holiday = mine
      .filter((e) => e.entry_type === "holiday")
      .reduce((sum, e) => sum + entryHours(e), 0);
    const overtime = overtimeForEmployee(mine);
    const regular = Math.max(0, worked - overtime);
    const total = worked + pto + holiday;

    doc.addImage(logoBase64, "PNG", (pageWidth - logoWidth) / 2, 22, logoWidth, logoHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(fullName(emp), 36, 110);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `${divisionById.get(emp.division_id ?? "")?.name ?? "No division"}    ${title}    ${from} through ${to}`,
      36,
      124,
    );
    doc.setTextColor(28, 35, 43);

    autoTable(doc, {
      startY: 134,
      head: [["Regular", "Overtime", "PTO", "Holiday", "Total"]],
      body: [[
        regular.toFixed(2),
        overtime.toFixed(2),
        pto.toFixed(2),
        holiday.toFixed(2),
        total.toFixed(2),
      ]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 10, cellPadding: 5, halign: "center" },
      headStyles: { fillColor: [28, 35, 43], textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { fontStyle: "bold", textColor: [28, 35, 43] },
      margin: { left: 36, right: 36 },
    });

    // biome-ignore lint/suspicious/noExplicitAny: autoTable augments the doc instance
    const afterTotals = (doc as any).lastAutoTable?.finalY ?? 170;

    autoTable(doc, {
      startY: afterTotals + 16,
      head: [["Date", "Job", "Type", "In", "Out", "Hours", "Notes"]],
      body: mine.map((entry) => [
        dayLabel(entry.work_date),
        entry.entry_type === "work" ? jobText(entry.job_id) : "—",
        typeLabel(entry.entry_type),
        entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—",
        entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—",
        entryHours(entry).toFixed(2),
        entry.notes ?? "",
      ]),
      foot: [["", "", "", "", "TOTAL", total.toFixed(2), ""]],
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: [28, 35, 43] },
      headStyles: { fillColor: [28, 35, 43], textColor: [255, 255, 255], fontStyle: "bold" },
      footStyles: { fillColor: [235, 238, 240], textColor: [28, 35, 43], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 74 },
        2: { cellWidth: 48 },
        3: { cellWidth: 52 },
        4: { cellWidth: 52 },
        5: { cellWidth: 44, halign: "right" },
      },
      margin: { left: 36, right: 36 },
      didDrawPage: () => {
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text(`TimeX · ${fullName(emp)}`, 36, doc.internal.pageSize.height - 18);
        doc.setTextColor(28, 35, 43);
      },
    });
  });

  doc.save(fileName);
  return true;
}
