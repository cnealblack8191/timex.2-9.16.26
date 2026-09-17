import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getPunchPhotoUrl, PHOTO_RETENTION_DAYS } from "@/lib/punch-photos.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import { TimeCardPanel } from "@/components/TimeCardPanel";
import {
  useDivisions,
  useEmployees,
  useJobs,
  usePayPeriods,
  useRangeEntries,
  useRevisions,
} from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/use-access";
import {
  entryHours,
  formatDay,
  formatTime,
  fromLocalInput,
  parseDateKey,
  fullName,
  jobLabel,
  toDateKey,
  toLocalInput,
  weekEnd,
  weekStart,
  type Job,
  type TimeEntry,
} from "@/lib/timekeeping";
import {
  STALE_PUNCH_HOURS,
  actionLabel,
  actorLabel,
  appendNote,
  changeLine,
  changedFields,
  isStalePunch,
  type FieldChange,
} from "@/lib/time-rules";

export const Route = createFileRoute("/_authenticated/time-entries")({
  head: () => ({
    meta: [
      { title: "Time Entries — TimeX" },
      {
        name: "description",
        content: "Review and correct employee time by day, week, employee and job.",
      },
      { property: "og:title", content: "Time Entries — TimeX" },
      {
        property: "og:description",
        content: "Review and correct employee time by day, week, employee and job.",
      },
    ],
  }),
  component: TimeEntriesPage,
});

/** Turns a database permission error into something a payroll clerk can act on. */
function friendlyError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) {
    return "You are not allowed to change this entry. The week may be closed, or it is outside your groups.";
  }
  return message;
}

type Draft = { clock_in: string; clock_out: string; job_id: string; reason: string };
const EMPTY_DRAFT: Draft = { clock_in: "", clock_out: "", job_id: "", reason: "" };

function TimeEntriesPage() {
  const { access } = useAccess();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(toDateKey(new Date()));
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [showVoided, setShowVoided] = useState(true);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [historyEntry, setHistoryEntry] = useState<TimeEntry | null>(null);
  const [cardEmployeeId, setCardEmployeeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [voidReason, setVoidReason] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const actor = access.displayName || access.email || "Office user";

  async function showPhoto(entryId: string, kind: "in" | "out") {
    setPhotoLoading(true);
    try {
      const { url } = await getPunchPhotoUrl({ data: { entry_id: entryId, kind } });
      if (url) setPhoto({ url, label: kind === "in" ? "Clock in photo" : "Clock out photo" });
    } catch {
      // nothing to show
    } finally {
      setPhotoLoading(false);
    }
  }

  const anchorDate = useMemo(() => parseDateKey(anchor), [anchor]);

  const from = scope === "day" ? anchor : toDateKey(weekStart(anchorDate));
  const to = scope === "day" ? anchor : toDateKey(weekEnd(anchorDate));

  const { data: entries = [] } = useRangeEntries(from, to, { includeVoided: true });
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: divisions = [] } = useDivisions();
  const payPeriods = usePayPeriods();

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const closedPeriod = payPeriods.closedFor(anchor);

  const searchLower = employeeSearch.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const emp = employeeById.get(entry.employee_id);
    if (!showVoided && entry.voided) return false;
    if (employeeFilter && entry.employee_id !== employeeFilter) return false;
    if (jobFilter && entry.job_id !== jobFilter) return false;
    if (divisionFilter && emp?.division_id !== divisionFilter) return false;
    if (searchLower && !(emp && fullName(emp).toLowerCase().includes(searchLower))) return false;
    return true;
  });

  const live = filtered.filter((e) => !e.voided);
  const totalHours = live.reduce((sum, e) => sum + entryHours(e), 0);
  const staleCount = live.filter((e) => isStalePunch(e)).length;
  const afterCloseCount = live.filter((e) => e.after_close).length;

  /** May this person change the entry right now? Mirrors the database rules so buttons match reality. */
  function canChange(entry: TimeEntry) {
    if (entry.voided) return false;
    if (!access.canEdit(employeeById.get(entry.employee_id))) return false;
    return access.isAdmin || !payPeriods.closedFor(entry.work_date);
  }

  function startEdit(entry: TimeEntry) {
    setEditing(entry);
    setVoidOpen(false);
    setVoidReason("");
    setFeedback(null);
    setDraft({
      clock_in: toLocalInput(entry.clock_in),
      clock_out: toLocalInput(entry.clock_out),
      job_id: entry.job_id ?? "",
      reason: "",
    });
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["entries"] });
    queryClient.invalidateQueries({ queryKey: ["open-entries"] });
    queryClient.invalidateQueries({ queryKey: ["revisions"] });
  }

  async function save() {
    if (!editing) return;
    const reason = draft.reason.trim();
    if (!reason) {
      setFeedback({ ok: false, message: "A reason is required for every correction." });
      return;
    }
    const clockIn = fromLocalInput(draft.clock_in);
    const clockOut = fromLocalInput(draft.clock_out);
    if (editing.entry_type === "work" && clockIn && clockOut && clockOut <= clockIn) {
      setFeedback({ ok: false, message: "Clock out must be after clock in." });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("time_entries")
      .update({
        clock_in: clockIn,
        clock_out: clockOut,
        job_id: draft.job_id || null,
        edited: true,
        notes: appendNote(editing.notes, changeLine("Corrected", actor, reason)),
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      setFeedback({ ok: false, message: friendlyError(error.message) });
      return;
    }
    setFeedback({ ok: true, message: "Time corrected." });
    setEditing(null);
    refresh();
  }

  async function voidEntry() {
    if (!editing) return;
    const reason = voidReason.trim();
    if (!reason) {
      setFeedback({ ok: false, message: "Say why this entry is being voided." });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("time_entries")
      .update({
        voided: true,
        void_reason: reason,
        notes: appendNote(editing.notes, changeLine("Voided", actor, reason)),
      })
      .eq("id", editing.id);
    setSaving(false);
    if (error) {
      setFeedback({ ok: false, message: friendlyError(error.message) });
      return;
    }
    setFeedback({ ok: true, message: "Entry voided. It stays on record and counts for nothing." });
    setEditing(null);
    setVoidOpen(false);
    setVoidReason("");
    refresh();
  }

  async function restore(entry: TimeEntry) {
    if (!access.isAdmin) return;
    setSaving(true);
    const { error } = await supabase
      .from("time_entries")
      .update({
        voided: false,
        notes: appendNote(entry.notes, changeLine("Restored", actor, "restored by administrator")),
      })
      .eq("id", entry.id);
    setSaving(false);
    setFeedback(
      error
        ? { ok: false, message: friendlyError(error.message) }
        : { ok: true, message: "Entry restored." },
    );
    if (!error) refresh();
  }

  const selectClass =
    "rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5";
  const badge = "ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase";

  return (
    <PortalShell
      title="Time Entries"
      subtitle="Review by day, week, employee or job — and correct anything that's off"
      actions={
        <>
          {staleCount > 0 && (
            <span className="rounded-lg bg-amber/15 px-3 py-2 font-semibold text-amber-deep ring-1 ring-amber/30">
              {staleCount} need clock-out
            </span>
          )}
          {afterCloseCount > 0 && (
            <span className="rounded-lg bg-rose/10 px-3 py-2 font-semibold text-rose ring-1 ring-rose/30">
              {afterCloseCount} after close
            </span>
          )}
          <span className="rounded-lg bg-ink px-3 py-2 font-mono text-primary-foreground">
            {totalHours.toFixed(1)} hrs
          </span>
        </>
      }
    >
      {closedPeriod && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-ink/[0.04] px-4 py-3 text-[13px] ring-1 ring-ink/10">
          <span className="font-semibold">
            Week of {formatDay(closedPeriod.week_start)} is closed
          </span>
          <span className="text-muted-foreground">
            · closed {new Date(closedPeriod.closed_at).toLocaleString()}
            {closedPeriod.closed_by_name ? ` by ${closedPeriod.closed_by_name}` : ""}
          </span>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {access.isAdmin
              ? "Administrators can still make corrections; each one is recorded."
              : "Corrections need an administrator or a reopened week."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-4 py-3">
            <button
              onClick={() => setScope("day")}
              className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
                scope === "day"
                  ? "bg-ink text-primary-foreground"
                  : "bg-card/80 text-steel ring-1 ring-ink/5"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setScope("week")}
              className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
                scope === "week"
                  ? "bg-ink text-primary-foreground"
                  : "bg-card/80 text-steel ring-1 ring-ink/5"
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
            <select
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
              className={selectClass}
            >
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
              <option value="">All groups</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              placeholder="Search employee name…"
              className={selectClass}
            />
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-steel">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
              />
              Show voided
            </label>
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
                  <th className="px-3 py-2.5 font-semibold">Photos</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const emp = employeeById.get(entry.employee_id);
                  const stale = isStalePunch(entry);
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => setCardEmployeeId(entry.employee_id)}
                      className={`cursor-pointer border-b border-line/60 hover:bg-ink/[0.04] ${
                        entry.voided ? "text-muted-foreground" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-steel">
                        {formatDay(entry.work_date)}
                        {entry.voided && (
                          <span className={`${badge} bg-ink/10 text-steel`}>Voided</span>
                        )}
                        {entry.after_close && !entry.voided && (
                          <span className={`${badge} bg-rose/10 text-rose`}>After close</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-3 font-semibold ${entry.voided ? "line-through" : ""}`}
                      >
                        {emp ? fullName(emp) : "Unknown"}
                      </td>
                      <td className="px-3 py-3 text-steel">
                        {entry.entry_type === "work"
                          ? jobLabel(jobById.get(entry.job_id ?? ""))
                          : entry.entry_type === "pto"
                            ? "PTO"
                            : "Holiday"}
                        {entry.job_overridden && (
                          <span className={`${badge} bg-amber/15 text-amber-deep`}>Override</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-steel">
                        {formatTime(entry.clock_in)}
                      </td>
                      <td className="px-3 py-3 font-mono text-steel">
                        {entry.clock_in && !entry.clock_out && !entry.voided ? (
                          stale ? (
                            <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-deep">
                              Needs clock-out
                            </span>
                          ) : (
                            <span className="text-emerald">on site</span>
                          )
                        ) : (
                          formatTime(entry.clock_out)
                        )}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono font-semibold ${
                          entry.voided ? "line-through" : ""
                        }`}
                      >
                        {entryHours(entry).toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {entry.clock_in_photo || entry.clock_out_photo ? (
                          <span className="flex gap-2">
                            {entry.clock_in_photo && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showPhoto(entry.id, "in");
                                }}
                                className="text-[12px] font-semibold text-steel underline decoration-dotted"
                              >
                                In
                              </button>
                            )}
                            {entry.clock_out_photo && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showPhoto(entry.id, "out");
                                }}
                                className="text-[12px] font-semibold text-steel underline decoration-dotted"
                              >
                                Out
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button
                          onClick={() => setCardEmployeeId(entry.employee_id)}
                          className="mr-3 text-[12px] font-semibold text-steel underline decoration-dotted"
                        >
                          Time Card
                        </button>
                        {access.canEdit(emp) && (
                          <button
                            onClick={() => setHistoryEntry(entry)}
                            className="mr-3 text-[12px] font-semibold text-steel underline decoration-dotted"
                          >
                            History
                          </button>
                        )}
                        {canChange(entry) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(entry);
                            }}
                            className="text-[12px] font-semibold text-amber-deep"
                          >
                            Edit
                          </button>
                        )}
                        {entry.voided && access.isAdmin && (
                          <button
                            onClick={() => void restore(entry)}
                            disabled={saving}
                            className="text-[12px] font-semibold text-emerald disabled:opacity-50"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-[13px] text-muted-foreground"
                    >
                      No time entries for this selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span className="font-medium">
              {live.length} entries
              {filtered.length !== live.length ? ` · ${filtered.length - live.length} voided` : ""}
            </span>
            <span className="font-mono">{totalHours.toFixed(2)} hrs total</span>
          </div>
        </Panel>

        <div className="col-span-12 space-y-4 xl:col-span-4">
          {feedback && (
            <div
              className={`rounded-xl px-4 py-3 text-[13px] font-semibold ring-1 ${
                feedback.ok
                  ? "bg-emerald/10 text-emerald ring-emerald/30"
                  : "bg-rose/10 text-rose ring-rose/30"
              }`}
            >
              {feedback.message}
            </div>
          )}

          {editing ? (
            <Panel className="animate-slidein p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-deep">
                    Edit Entry
                  </div>
                  <div className="mt-0.5 text-[15px] font-bold">
                    {(() => {
                      const emp = employeeById.get(editing.employee_id);
                      return emp ? fullName(emp) : "Unknown";
                    })()}{" "}
                    · {formatDay(editing.work_date)}
                  </div>
                </div>
                <button
                  onClick={() => setEditing(null)}
                  className="text-[12px] text-muted-foreground"
                >
                  ✕
                </button>
              </div>

              {editing.entry_type === "work" ? (
                <>
                  <label className="mb-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Job
                    </span>
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
                </>
              ) : (
                <p className="mb-3 text-[12.5px] text-muted-foreground">
                  {editing.entry_type === "pto" ? "PTO" : "Holiday"} ·{" "}
                  {entryHours(editing).toFixed(2)} hours. Change the hours from the Time Card, or
                  void this entry below.
                </p>
              )}

              <label className="mt-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Reason for this correction (required)
                </span>
                <input
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                  placeholder="Forgot to clock out, wrong job, left early…"
                  className="w-full bg-transparent text-[13px]"
                />
              </label>

              {editing.notes && (
                <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-[11.5px] text-muted-foreground whitespace-pre-line">
                  {editing.notes}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={() => setVoidOpen((v) => !v)}
                  className="text-[12px] font-semibold text-rose"
                >
                  {voidOpen ? "Keep entry" : "Void entry"}
                </button>
                {editing.entry_type === "work" && (
                  <button
                    onClick={save}
                    disabled={saving || !draft.reason.trim()}
                    className="rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save correction"}
                  </button>
                )}
              </div>

              {voidOpen && (
                <div className="mt-4 rounded-lg bg-rose/5 p-3 ring-1 ring-rose/30">
                  <p className="text-[12px] text-steel">
                    Voiding keeps the entry on record but removes it from hours, payroll and
                    reports. Only an administrator can restore it.
                  </p>
                  <input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Why is this entry being voided?"
                    className="mt-2 w-full rounded-md bg-card px-3 py-2 text-[13px] ring-1 ring-ink/10"
                  />
                  <button
                    onClick={voidEntry}
                    disabled={saving || !voidReason.trim()}
                    className="mt-2 rounded-lg bg-rose px-4 py-2 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {saving ? "Voiding…" : "Void this entry"}
                  </button>
                </div>
              )}
            </Panel>
          ) : (
            <Panel className="p-5 text-[13px] text-muted-foreground">
              Click anywhere on a row to open that person's weekly time card. Pick{" "}
              <span className="font-semibold text-steel">Edit</span> on a row to correct the
              times, change the job, or add a note. Every correction needs a reason and is kept in
              the entry's <span className="font-semibold text-steel">History</span>. Entries are
              voided, never deleted. A punch open longer than {STALE_PUNCH_HOURS} hours is marked{" "}
              <span className="font-semibold text-amber-deep">Needs clock-out</span> and counts zero
              hours until someone sets the time. Punch photos are only loaded when you click{" "}
              <span className="font-semibold text-steel">In</span> or{" "}
              <span className="font-semibold text-steel">Out</span>, and are deleted after{" "}
              {PHOTO_RETENTION_DAYS} days.
            </Panel>
          )}
        </div>
      </div>

      {photoLoading && !photo && (
        <div className="fixed bottom-5 right-5 rounded-lg bg-ink px-3 py-2 text-[12px] text-primary-foreground">
          Loading photo…
        </div>
      )}

      {cardEmployeeId &&
        (() => {
          const emp = employeeById.get(cardEmployeeId);
          return emp ? (
            <TimeCardPanel
              employee={emp}
              anchor={anchor}
              readOnly={!access.canEdit(emp)}
              onClose={() => setCardEmployeeId(null)}
            />
          ) : null;
        })()}

      {historyEntry && (
        <HistoryPanel
          entry={historyEntry}
          employeeName={
            employeeById.get(historyEntry.employee_id)
              ? fullName(employeeById.get(historyEntry.employee_id)!)
              : "Unknown"
          }
          jobById={jobById}
          onClose={() => setHistoryEntry(null)}
        />
      )}

      {photo && (
        <div
          onClick={() => setPhoto(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-6"
        >
          <div className="max-w-[420px] rounded-xl bg-card p-3 shadow-xl">
            <img src={photo.url} alt={photo.label} className="w-full rounded-lg" />
            <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground">
              <span className="font-semibold text-steel">{photo.label}</span>
              <button onClick={() => setPhoto(null)} className="font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

/* ---------- change history ---------- */

const FIELD_LABELS: Record<string, string> = {
  work_date: "Date",
  entry_type: "Type",
  job_id: "Job",
  clock_in: "Clock in",
  clock_out: "Clock out",
  manual_hours: "Hours",
  notes: "Notes",
  voided: "Voided",
  void_reason: "Void reason",
  after_close: "After close",
};

function formatStamp(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatValue(change: FieldChange, value: unknown, jobById: Map<string, Job>): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (change.field) {
    case "clock_in":
    case "clock_out":
      return typeof value === "string" ? formatStamp(value) : String(value);
    case "work_date":
      return typeof value === "string" ? formatDay(value) : String(value);
    case "job_id":
      return jobLabel(jobById.get(String(value)));
    case "voided":
    case "after_close":
      return value ? "yes" : "no";
    case "manual_hours":
      return Number(value).toFixed(2);
    default:
      return String(value);
  }
}

function HistoryPanel({
  entry,
  employeeName,
  jobById,
  onClose,
}: {
  entry: TimeEntry;
  employeeName: string;
  jobById: Map<string, Job>;
  onClose: () => void;
}) {
  const { data: revisions = [], isLoading, isError } = useRevisions(entry.id);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" onClick={onClose}>
      <div
        className="panel max-h-[88vh] w-full max-w-[640px] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/70 px-5 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              Change history
            </div>
            <div className="mt-0.5 font-display text-[18px]">
              {employeeName} · {formatDay(entry.work_date)}
            </div>
          </div>
          <button onClick={onClose} className="px-2 text-[14px] text-muted-foreground">
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {isError && (
            <p className="text-[13px] text-rose">Could not load the history for this entry.</p>
          )}
          {!isLoading && !isError && revisions.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No changes recorded yet. History starts from the day change tracking was switched on.
            </p>
          )}
          <ol className="space-y-3">
            {revisions.map((rev) => {
              const changes = changedFields(rev.old_row, rev.new_row).filter(
                (c) => rev.action !== "insert" || c.to !== false,
              );
              return (
                <li key={rev.id} className="rounded-xl bg-card/80 px-4 py-3 ring-1 ring-ink/5">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-semibold">{actionLabel(rev.action)}</span>
                    <span className="text-muted-foreground">by {actorLabel(rev)}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {new Date(rev.changed_at).toLocaleString()}
                    </span>
                  </div>
                  {changes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[12.5px]">
                      {changes.map((c) => (
                        <li key={c.field} className="flex flex-wrap gap-x-2">
                          <span className="w-24 shrink-0 text-muted-foreground">
                            {FIELD_LABELS[c.field] ?? c.field}
                          </span>
                          {rev.action !== "insert" && (
                            <>
                              <span className="text-steel line-through decoration-rose/60 whitespace-pre-line">
                                {formatValue(c, c.from, jobById)}
                              </span>
                              <span className="text-muted-foreground">→</span>
                            </>
                          )}
                          <span className="font-semibold whitespace-pre-line">
                            {formatValue(c, c.to, jobById)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
