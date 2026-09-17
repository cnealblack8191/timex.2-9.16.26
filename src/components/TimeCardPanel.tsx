import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/use-access";
import { useJobs, usePayPeriods } from "@/hooks/use-timekeeping";
import { appendNote, changeLine } from "@/lib/time-rules";
import {
  entryHours,
  fetchEntriesBetween,
  formatDay,
  fullName,
  jobLabel,
  parseDateKey,
  toDateKey,
  weekEnd,
  weekStart,
  type Employee,
  type TimeEntry,
} from "@/lib/timekeeping";

/* ---------- hour parsing / formatting ---------- */

/** Accepts "7.5", "7:30", "7" and returns decimal hours, or null when blank/invalid. */
function parseHours(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (v.includes(":")) {
    const [h, m] = v.split(":");
    const hours = Number(h);
    const mins = Number(m);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return Math.round((hours + mins / 60) * 100) / 100;
  }
  const n = Number(v);
  return Number.isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

/** Formats decimal hours as H:MM (e.g. 7.5 -> "7:30"). */
function formatHours(hours: number | null): string {
  if (hours == null || hours <= 0) return "";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/* ---------- cell addressing ---------- */

type RowKind = { type: "work"; jobId: string } | { type: "pto" } | { type: "holiday" };

const rowKey = (kind: RowKind) => (kind.type === "work" ? `work:${kind.jobId}` : kind.type);
const cellKey = (kind: RowKind, dateKey: string) => `${rowKey(kind)}|${dateKey}`;

function kindOf(entry: TimeEntry): RowKind {
  if (entry.entry_type === "pto") return { type: "pto" };
  if (entry.entry_type === "holiday") return { type: "holiday" };
  return { type: "work", jobId: entry.job_id ?? "" };
}

export function TimeCardPanel({
  employee,
  anchor,
  onClose,
  readOnly = false,
}: {
  employee: Employee;
  anchor: string;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { access } = useAccess();
  const payPeriods = usePayPeriods();
  const actor = access.displayName || access.email || "Office user";
  const [weekAnchor, setWeekAnchor] = useState(anchor);
  const [cells, setCells] = useState<Record<string, string> | null>(null);
  const [extraJobs, setExtraJobs] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCell, setSelectedCell] = useState<{ kind: RowKind; dateKey: string } | null>(null);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: jobs = [] } = useJobs();
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const anchorDate = useMemo(() => parseDateKey(weekAnchor), [weekAnchor]);
  const start = weekStart(anchorDate);
  const end = weekEnd(anchorDate);
  const from = toDateKey(start);
  const to = toDateKey(end);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return toDateKey(d);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from],
  );

  const { data: weekEntries = [], isLoading } = useQuery({
    queryKey: ["entries", from, to],
    queryFn: () => fetchEntriesBetween(from, to),
  });

  // saved per-cell notes for this employee, loaded with the week
  const { data: savedDayNotes = [] } = useQuery({
    queryKey: ["day-notes", employee.id, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("day_notes")
        .select("*")
        .eq("employee_id", employee.id)
        .gte("work_date", from)
        .lte("work_date", to);
      if (error) throw error;
      return data ?? [];
    },
  });

  // a saved note row -> the cell it belongs to (day + job / PTO / holiday)
  const noteCellKey = (n: { entry_type: string; job_id: string | null; work_date: string }) =>
    n.entry_type === "work"
      ? cellKey({ type: "work", jobId: n.job_id ?? "" }, n.work_date)
      : cellKey({ type: n.entry_type === "pto" ? "pto" : "holiday" }, n.work_date);

  // prefill the notes state from saved notes once they load (don't clobber edits)
  const [notesLoadedFor, setNotesLoadedFor] = useState<string | null>(null);
  const notesKey = `${employee.id}|${from}`;
  if (notesLoadedFor !== notesKey && !isLoading) {
    const map: Record<string, string> = {};
    for (const n of savedDayNotes) map[noteCellKey(n)] = n.note;
    setDayNotes((prev) => (Object.keys(prev).length === 0 ? map : prev));
    setNotesLoadedFor(notesKey);
  }

  const entries = useMemo(
    () => weekEntries.filter((e) => e.employee_id === employee.id),
    [weekEntries, employee.id],
  );

  // build the initial cell values from existing entries once per week load
  const baseCells = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of entries) {
      const key = cellKey(kindOf(entry), entry.work_date);
      map[key] = Math.round(((map[key] ?? 0) + entryHours(entry)) * 100) / 100;
    }
    const out: Record<string, string> = {};
    for (const [key, hours] of Object.entries(map)) out[key] = formatHours(hours);
    return out;
  }, [entries]);

  const values = cells ?? baseCells;
  const savedNoteByCell = useMemo(
    () => new Map(savedDayNotes.map((n) => [noteCellKey(n), n.note])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedDayNotes],
  );
  const notesDirty =
    notesLoadedFor === notesKey &&
    [...new Set([...Object.keys(dayNotes), ...savedNoteByCell.keys()])].some(
      (k) => (dayNotes[k] ?? "").trim() !== (savedNoteByCell.get(k) ?? "").trim(),
    );
  const dirty = cells != null || notesDirty;

  // A closed week is read-only for everyone but administrators; the database enforces the same rule.
  const closedPeriod = payPeriods.closedFor(from);
  const locked = readOnly || (Boolean(closedPeriod) && !access.isAdmin);

  // jobs that have any work entries this week, plus manually added rows
  const workJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) if (e.entry_type === "work" && e.job_id) ids.add(e.job_id);
    for (const id of extraJobs) ids.add(id);
    return [...ids].sort((a, b) =>
      jobLabel(jobById.get(a)).localeCompare(jobLabel(jobById.get(b))),
    );
  }, [entries, extraJobs, jobById]);

  const addableJobs = jobs.filter((j) => j.active && !workJobIds.includes(j.id));

  function setCell(kind: RowKind, dateKey: string, value: string) {
    const next = { ...values, [cellKey(kind, dateKey)]: value };
    setCells(next);
    setSelectedCell({ kind, dateKey });
  }

  function shiftWeek(dir: -1 | 1) {
    const d = parseDateKey(weekAnchor);
    d.setDate(d.getDate() + dir * 7);
    setWeekAnchor(toDateKey(d));
    setCells(null);
    setExtraJobs([]);
    setSelectedCell(null);
    setDayNotes({});
    setNotesLoadedFor(null);
  }

  function goToday() {
    setWeekAnchor(toDateKey(new Date()));
    setCells(null);
    setExtraJobs([]);
    setSelectedCell(null);
    setDayNotes({});
    setNotesLoadedFor(null);
  }

  /* ---------- totals ---------- */

  const allKinds: RowKind[] = useMemo(
    () => [
      ...workJobIds.map((jobId): RowKind => ({ type: "work", jobId })),
      { type: "pto" },
      { type: "holiday" },
    ],
    [workJobIds],
  );

  const rowTotal = (kind: RowKind) =>
    days.reduce((sum, dk) => sum + (parseHours(values[cellKey(kind, dk)] ?? "") ?? 0), 0);
  const dayTotal = (dk: string) =>
    allKinds.reduce((sum, kind) => sum + (parseHours(values[cellKey(kind, dk)] ?? "") ?? 0), 0);
  const grandTotal = days.reduce((sum, dk) => sum + dayTotal(dk), 0);

  /* ---------- save ---------- */

  async function save() {
    if (cells != null && !reason.trim()) {
      setError("A reason is required for time card changes.");
      return;
    }
    if (locked) {
      setError("This week is closed. Only an administrator can change it.");
      return;
    }
    setSaving(true);
    setError(null);
    const reasonNote = reason.trim();
    const noteText = notes.trim();
    const note = changeLine(
      "Time card",
      actor,
      noteText ? `${reasonNote} — ${noteText}` : reasonNote,
    );

    try {
      for (const kind of allKinds) {
        for (const dk of days) {
          const key = cellKey(kind, dk);
          const hours = parseHours(values[key] ?? "");
          const base = parseHours(baseCells[key] ?? "");
          if (hours === base) continue; // untouched cell

          const matches = entries.filter((e) => {
            if (e.work_date !== dk) return false;
            if (kind.type === "work")
              return e.entry_type === "work" && (e.job_id ?? "") === kind.jobId;
            return e.entry_type === kind.type;
          });

          if (matches.length > 0) {
            // put the full day total on the first entry, zero the rest
            const first = matches[0];
            if (!first) continue;
            const rest = matches.slice(1);
            if (hours != null) {
              const { error: err } = await supabase
                .from("time_entries")
                .update({ manual_hours: hours, edited: true, notes: appendNote(first.notes, note) })
                .eq("id", first.id);
              if (err) throw err;
            }
            for (const extra of rest) {
              const { error: err } = await supabase
                .from("time_entries")
                .update({ manual_hours: 0, edited: true, notes: appendNote(extra.notes, note) })
                .eq("id", extra.id);
              if (err) throw err;
            }
          } else if (hours != null && hours > 0) {
            const { error: err } = await supabase.from("time_entries").insert({
              employee_id: employee.id,
              job_id: kind.type === "work" ? kind.jobId : null,
              work_date: dk,
              entry_type: kind.type,
              manual_hours: hours,
              edited: true,
              notes: note,
              source: "time-card",
            });
            if (err) throw err;
          }
        }
      }

      // persist per-cell notes (day + job / PTO / holiday), independent of hour edits
      const savedRowByCell = new Map(savedDayNotes.map((n) => [noteCellKey(n), n]));
      for (const kind of allKinds) {
        for (const dk of days) {
          const key = cellKey(kind, dk);
          const text = (dayNotes[key] ?? "").trim();
          const existing = savedRowByCell.get(key);
          if (text && text !== existing?.note) {
            if (existing) {
              const { error: err } = await supabase
                .from("day_notes")
                .update({ note: text })
                .eq("id", existing.id);
              if (err) throw err;
            } else {
              const { error: err } = await supabase.from("day_notes").insert({
                employee_id: employee.id,
                work_date: dk,
                entry_type: kind.type,
                job_id: kind.type === "work" ? kind.jobId || null : null,
                note: text,
              });
              if (err) throw err;
            }
          } else if (!text && existing) {
            const { error: err } = await supabase.from("day_notes").delete().eq("id", existing.id);
            if (err) throw err;
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["entries"] });
      queryClient.invalidateQueries({ queryKey: ["day-notes"] });
      queryClient.invalidateQueries({ queryKey: ["open-entries"] });
      setCells(null);
      setExtraJobs([]);
      setReason("");
      setNotes("");
      setSelectedCell(null);
      setDayNotes({});
      setNotesLoadedFor(null);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the time card.";
      setError(
        /row-level security|permission denied/i.test(message)
          ? "You are not allowed to change this week. It may be closed, or outside your groups."
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-md bg-card px-2 py-1.5 text-center font-mono text-[13px] ring-1 ring-ink/10 focus:outline-none focus:ring-2 focus:ring-amber/60";

  const isSelected = (kind: RowKind, dk: string) =>
    selectedCell != null &&
    rowKey(selectedCell.kind) === rowKey(kind) &&
    selectedCell.dateKey === dk;

  const cellClass = (kind: RowKind, dk: string) => {
    const key = cellKey(kind, dk);
    const hasNote = (dayNotes[key] ?? "").trim().length > 0;
    return `${inputClass} cursor-pointer ${
      isSelected(kind, dk) ? "ring-2 ring-amber/70" : hasNote ? "ring-2 ring-amber/40" : ""
    }`;
  };

  const kindLabel = (kind: RowKind) =>
    kind.type === "work"
      ? jobLabel(jobById.get(kind.jobId))
      : kind.type === "pto"
        ? "PTO"
        : "Holiday";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" onClick={onClose}>
      <div
        className="panel max-h-[92vh] w-full max-w-[980px] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-deep">
              Weekly Time Card
            </div>
            <div className="mt-0.5 font-display text-[20px]">{fullName(employee)}</div>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <button
              onClick={goToday}
              className="rounded-md bg-card/80 px-2.5 py-1.5 text-steel ring-1 ring-ink/5"
            >
              Today
            </button>
            <button
              onClick={() => shiftWeek(-1)}
              className="rounded-md bg-card/80 px-2.5 py-1.5 text-steel ring-1 ring-ink/5"
              aria-label="Previous week"
            >
              ←
            </button>
            <span className="px-2 font-mono font-semibold text-steel">
              {formatDay(from)} – {formatDay(to)}
            </span>
            <button
              onClick={() => shiftWeek(1)}
              className="rounded-md bg-card/80 px-2.5 py-1.5 text-steel ring-1 ring-ink/5"
              aria-label="Next week"
            >
              →
            </button>
            <button onClick={onClose} className="ml-2 px-2 text-[14px] text-muted-foreground">
              ✕
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
            Loading week…
          </div>
        ) : (
          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">Job</th>
                  {days.map((dk) => {
                    const d = parseDateKey(dk);
                    return (
                      <th key={dk} className="px-1 py-2 text-center font-semibold">
                        <span className="block leading-tight">
                          {d.toLocaleDateString([], { weekday: "short" })}
                        </span>
                        <span className="block leading-tight font-mono text-[10px] font-medium normal-case tracking-normal">
                          {d.toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {workJobIds.map((jobId) => {
                  const kind: RowKind = { type: "work", jobId };
                  return (
                    <tr key={jobId} className="border-b border-line/50">
                      <td className="whitespace-nowrap px-2 py-1.5 font-semibold">
                        {jobLabel(jobById.get(jobId))}
                      </td>
                      {days.map((dk) => (
                        <td key={dk} className="px-1 py-1.5">
                          <input
                            value={values[cellKey(kind, dk)] ?? ""}
                            onChange={(e) => setCell(kind, dk, e.target.value)}
                            onFocus={() => setSelectedCell({ kind, dateKey: dk })}
                            onClick={() => setSelectedCell({ kind, dateKey: dk })}
                            placeholder="0:00"
                            inputMode="decimal"
                            className={cellClass(kind, dk)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {formatHours(rowTotal(kind)) || "0:00"}
                      </td>
                      <td className="px-1 text-right">
                        {extraJobs.includes(jobId) &&
                          !entries.some(
                            (e) => e.entry_type === "work" && (e.job_id ?? "") === jobId,
                          ) && (
                            <button
                              onClick={() => setExtraJobs(extraJobs.filter((id) => id !== jobId))}
                              className="text-[12px] font-semibold text-rose"
                              title="Remove row"
                            >
                              ✕
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}

                {(["pto", "holiday"] as const).map((type) => {
                  const kind: RowKind = { type };
                  return (
                    <tr key={type} className="border-b border-line/50 bg-ink/[0.015]">
                      <td className="px-2 py-1.5 font-semibold text-steel">
                        {type === "pto" ? "PTO" : "Holiday"}
                      </td>
                      {days.map((dk) => (
                        <td key={dk} className="px-1 py-1.5">
                          <input
                            value={values[cellKey(kind, dk)] ?? ""}
                            onChange={(e) => setCell(kind, dk, e.target.value)}
                            onFocus={() => setSelectedCell({ kind, dateKey: dk })}
                            onClick={() => setSelectedCell({ kind, dateKey: dk })}
                            placeholder="0:00"
                            inputMode="decimal"
                            className={cellClass(kind, dk)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {formatHours(rowTotal(kind)) || "0:00"}
                      </td>
                      <td />
                    </tr>
                  );
                })}

                <tr className="text-[13px]">
                  <td className="px-2 py-2 font-bold">Totals</td>
                  {days.map((dk) => (
                    <td key={dk} className="px-1 py-2 text-center font-mono font-semibold">
                      {formatHours(dayTotal(dk)) || "0:00"}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono font-bold">
                    {formatHours(grandTotal) || "0:00"}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>

            {addableJobs.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setExtraJobs([...extraJobs, e.target.value]);
                  }}
                  className="rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
                >
                  <option value="">+ Add a job row…</option>
                  {addableJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {jobLabel(j)}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">Hours accept 7.5 or 7:30</span>
              </div>
            )}

            {selectedCell && (
              <label className="mt-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-amber/40">
                <span className="text-[10px] uppercase tracking-wide text-amber-deep">
                  Notes for {kindLabel(selectedCell.kind)} — {formatDay(selectedCell.dateKey)}
                </span>
                <input
                  value={dayNotes[cellKey(selectedCell.kind, selectedCell.dateKey)] ?? ""}
                  onChange={(e) =>
                    setDayNotes({
                      ...dayNotes,
                      [cellKey(selectedCell.kind, selectedCell.dateKey)]: e.target.value,
                    })
                  }
                  placeholder="Anything notable about these hours?"
                  className="w-full bg-transparent text-[13px]"
                  autoFocus
                />
              </label>
            )}
          </div>
        )}

        {/* footer */}
        <div className="border-t border-line/70 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Reason (required)
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this time being entered or changed?"
                className="w-full bg-transparent text-[13px]"
              />
            </label>
            <label className="block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Notes (optional)
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Extra detail for this week's card"
                className="w-full bg-transparent text-[13px]"
              />
            </label>
          </div>
          {closedPeriod && (
            <div className="mt-2 text-[12px] text-steel">
              Week closed {new Date(closedPeriod.closed_at).toLocaleString()}
              {closedPeriod.closed_by_name ? ` by ${closedPeriod.closed_by_name}` : ""}.
              {access.isAdmin ? " Administrator changes are recorded." : ""}
            </div>
          )}
          {error && <div className="mt-2 text-[12px] font-semibold text-rose">{error}</div>}
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => {
                setCells(null);
                setReason("");
                setNotes("");
                setSelectedCell(null);
                setDayNotes(Object.fromEntries(savedNoteByCell));
              }}
              disabled={!dirty}
              className="text-[12px] font-semibold text-steel disabled:opacity-40"
            >
              Reset changes
            </button>
            {locked ? (
              <span className="text-[12px] text-muted-foreground">
                {readOnly
                  ? "You can view this time card but not change it."
                  : "This week is closed. Only an administrator can change it."}
              </span>
            ) : (
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save time card"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
