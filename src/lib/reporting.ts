import {
  OVERTIME_THRESHOLD,
  entryHours,
  fullName,
  parseDateKey,
  toDateKey,
  weekStart,
  type Division,
  type Employee,
  type Job,
  type TimeEntry,
} from "@/lib/timekeeping";

export type GroupBy = "employee" | "division" | "job" | "company";
export type SortBy = "last" | "first";

export type HoursBucket = {
  worked: number;
  overtime: number;
  regular: number;
  pto: number;
  holiday: number;
  total: number;
};

export type ReportRow = HoursBucket & {
  key: string;
  label: string;
  sublabel: string;
  perDay: Record<string, number>;
  perJob: Record<string, number>;
};

export const emptyBucket = (): HoursBucket => ({
  worked: 0,
  overtime: 0,
  regular: 0,
  pto: 0,
  holiday: 0,
  total: 0,
});

export function dayKeysBetween(from: string, to: string) {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  const keys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && keys.length < 400) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/** Overtime is worked hours above 40 in a Sunday–Saturday week. PTO and holiday never count. */
export function overtimeForEmployee(entries: TimeEntry[]) {
  const byWeek = new Map<string, number>();
  for (const entry of entries) {
    if (entry.entry_type !== "work") continue;
    const key = toDateKey(weekStart(parseDateKey(entry.work_date)));
    byWeek.set(key, (byWeek.get(key) ?? 0) + entryHours(entry));
  }
  let overtime = 0;
  for (const hours of byWeek.values()) {
    overtime += Math.max(0, hours - OVERTIME_THRESHOLD);
  }
  return Math.round(overtime * 100) / 100;
}

export type ReportInput = {
  entries: TimeEntry[];
  employees: Employee[];
  jobs: Job[];
  divisions: Division[];
  groupBy: GroupBy;
  sortBy: SortBy;
  includeEmptyEmployees: boolean;
};

function addTo(bucket: HoursBucket, entry: TimeEntry) {
  const hours = entryHours(entry);
  if (entry.entry_type === "pto") bucket.pto += hours;
  else if (entry.entry_type === "holiday") bucket.holiday += hours;
  else if (entry.entry_type === "work") bucket.worked += hours;
}

function finalize(bucket: HoursBucket, overtime: number) {
  bucket.overtime = overtime;
  bucket.regular = Math.max(0, bucket.worked - overtime);
  bucket.total = bucket.worked + bucket.pto + bucket.holiday;
  return bucket;
}

export function buildRows(input: ReportInput): ReportRow[] {
  const { entries, employees, jobs, divisions, groupBy, sortBy } = input;
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const divisionById = new Map(divisions.map((d) => [d.id, d]));

  const jobName = (id: string | null | undefined) => {
    const job = id ? jobById.get(id) : undefined;
    return job ? `#${job.number} ${job.name}` : "Unassigned";
  };

  type Acc = {
    row: ReportRow;
    entriesByEmployee: Map<string, TimeEntry[]>;
    sortName: string;
  };
  const accs = new Map<string, Acc>();

  const ensure = (key: string, label: string, sublabel: string, sortName: string) => {
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        row: { key, label, sublabel, perDay: {}, perJob: {}, ...emptyBucket() },
        entriesByEmployee: new Map(),
        sortName,
      };
      accs.set(key, acc);
    }
    return acc;
  };

  // Seed employee / division rows so people with no hours still appear.
  if (groupBy === "employee") {
    for (const emp of employees) {
      const division = divisionById.get(emp.division_id ?? "");
      ensure(
        emp.id,
        fullName(emp),
        division?.name ?? "—",
        sortBy === "last" ? `${emp.last_name} ${emp.first_name}` : `${emp.first_name} ${emp.last_name}`,
      );
    }
  } else if (groupBy === "division") {
    for (const division of divisions) ensure(division.id, division.name, division.code, division.name);
    ensure("none", "No division", "—", "zzz");
  } else if (groupBy === "company") {
    ensure("company", "Company total", "All divisions and jobs", "");
  }

  for (const entry of entries) {
    const emp = employeeById.get(entry.employee_id);
    if (!emp) continue;

    let key: string;
    let label: string;
    let sublabel: string;
    let sortName: string;

    if (groupBy === "employee") {
      key = emp.id;
      label = fullName(emp);
      sublabel = divisionById.get(emp.division_id ?? "")?.name ?? "—";
      sortName =
        sortBy === "last" ? `${emp.last_name} ${emp.first_name}` : `${emp.first_name} ${emp.last_name}`;
    } else if (groupBy === "division") {
      const division = divisionById.get(emp.division_id ?? "");
      key = division?.id ?? "none";
      label = division?.name ?? "No division";
      sublabel = division?.code ?? "—";
      sortName = label;
    } else if (groupBy === "job") {
      key = entry.job_id ?? "none";
      label = jobName(entry.job_id);
      sublabel = (entry.job_id ? jobById.get(entry.job_id)?.location : null) ?? "—";
      sortName = label;
    } else {
      key = "company";
      label = "Company total";
      sublabel = "All divisions and jobs";
      sortName = "";
    }

    const acc = ensure(key, label, sublabel, sortName);
    addTo(acc.row, entry);
    acc.row.perDay[entry.work_date] = (acc.row.perDay[entry.work_date] ?? 0) + entryHours(entry);
    const jn = jobName(entry.job_id);
    acc.row.perJob[jn] = (acc.row.perJob[jn] ?? 0) + entryHours(entry);
    const list = acc.entriesByEmployee.get(emp.id) ?? [];
    list.push(entry);
    acc.entriesByEmployee.set(emp.id, list);
  }

  const rows = [...accs.values()].map((acc) => {
    let overtime = 0;
    for (const list of acc.entriesByEmployee.values()) overtime += overtimeForEmployee(list);
    return { acc, row: finalize(acc.row, Math.round(overtime * 100) / 100) };
  });

  return rows
    .sort((a, b) => {
      const hasA = a.row.total > 0 ? 1 : 0;
      const hasB = b.row.total > 0 ? 1 : 0;
      if (hasA !== hasB) return hasB - hasA;
      return a.acc.sortName.localeCompare(b.acc.sortName);
    })
    .map((r) => r.row);
}

export function sumRows(rows: ReportRow[]): HoursBucket {
  return rows.reduce((acc, row) => {
    acc.worked += row.worked;
    acc.overtime += row.overtime;
    acc.regular += row.regular;
    acc.pto += row.pto;
    acc.holiday += row.holiday;
    acc.total += row.total;
    return acc;
  }, emptyBucket());
}

export function hoursByJob(entries: TimeEntry[], jobs: Job[]) {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.entry_type !== "work") continue;
    const job = entry.job_id ? jobById.get(entry.job_id) : undefined;
    const label = job ? `#${job.number} ${job.name}` : "Unassigned";
    totals.set(label, (totals.get(label) ?? 0) + entryHours(entry));
  }
  return [...totals.entries()]
    .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours);
}

export function hoursByDay(entries: TimeEntry[], from: string, to: string) {
  const keys = dayKeysBetween(from, to);
  const work = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const entry of entries) {
    const target = entry.entry_type === "work" ? work : paid;
    target.set(entry.work_date, (target.get(entry.work_date) ?? 0) + entryHours(entry));
  }
  return keys.map((key) => ({
    day: key,
    label: parseDateKey(key).toLocaleDateString([], { month: "numeric", day: "numeric" }),
    worked: Math.round((work.get(key) ?? 0) * 100) / 100,
    paidLeave: Math.round((paid.get(key) ?? 0) * 100) / 100,
  }));
}

export const formatHours = (value: number) => (value ? value.toFixed(2) : "—");
