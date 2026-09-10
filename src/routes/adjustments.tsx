import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEmployees, useJobs, useRangeEntries } from "@/hooks/use-timekeeping";
import { verifyKioskPin } from "@/lib/kiosk-pin.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  entryHours,
  formatTime,
  fromLocalInput,
  fullName,
  jobLabel,
  toDateKey,
  toLocalInput,
  type TimeEntry,
} from "@/lib/timekeeping";
import eciLogo from "@/assets/eci-logo.png.asset.json";

export const Route = createFileRoute("/adjustments")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "TimeX" },
      {
        name: "description",
        content: "Protected screen for correcting employee punches on the jobsite, with a reason on every change.",
      },
      { property: "og:title", content: "Time Adjustments — TimeX" },
      {
        property: "og:description",
        content: "Protected screen for correcting employee punches on the jobsite, with a reason on every change.",
      },
    ],
  }),
  component: Adjustments,
});

const label = "text-[12px] font-semibold uppercase tracking-wide text-primary-foreground/50";
const field =
  "mt-2 w-full appearance-none rounded-xl bg-primary-foreground/10 px-4 py-4 text-[17px] font-bold text-primary-foreground ring-1 ring-primary-foreground/15 disabled:opacity-40";

function Adjustments() {
  const [unlocked, setUnlocked] = useState(false);
  return (
    <div className="min-h-screen bg-kiosk px-4 py-5 text-primary-foreground sm:px-6">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={eciLogo.url}
              alt="Electrical Contractor Inc."
              className="h-11 w-11 rounded object-contain"
            />
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
              Adjustments
            </span>
          </div>
          <Link
            to="/kiosk"
            className="rounded-lg bg-primary-foreground/10 px-3 py-2 text-[12px] font-semibold ring-1 ring-primary-foreground/15"
          >
            Back to punch
          </Link>
        </div>
        {unlocked ? <Editor /> : <Lock onUnlock={() => setUnlocked(true)} />}
      </div>
    </div>
  );
}

function Lock({ onUnlock }: { onUnlock: () => void }) {
  const verify = useServerFn(verifyKioskPin);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ok } = await verify({ data: { pin } });
      if (ok) onUnlock();
      else setError("That code is not correct.");
    } catch {
      setError("Could not check the code — check your signal.");
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[26px] bg-primary-foreground/5 p-6 ring-1 ring-primary-foreground/10"
    >
      <p className="font-display text-2xl tracking-wide">Supervisor code</p>
      <p className="mt-2 text-[13px] text-primary-foreground/60">
        Manual time changes are limited to supervisors.
      </p>
      <input
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        className={`${field} text-center font-mono tracking-[0.5em]`}
      />
      {error && <p className="mt-3 text-[13px] font-semibold text-rose">{error}</p>}
      <button
        type="submit"
        disabled={busy || pin.length < 4}
        className="skew-btn mt-5 w-full rounded-xl bg-amber py-6 font-display text-2xl tracking-wide text-ink disabled:opacity-30"
      >
        <span>Unlock</span>
      </button>
    </form>
  );
}

type Draft = {
  clock_in: string;
  clock_out: string;
  job_id: string;
  reason: string;
};

function Editor() {
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();

  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(toDateKey(new Date()));
  const { data: entries = [] } = useRangeEntries(date, date);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ clock_in: "", clock_out: "", job_id: "", reason: "" });
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const employee = employees.find((e) => e.id === employeeId);
  const dayEntries = useMemo(
    () => entries.filter((e) => e.employee_id === employeeId),
    [entries, employeeId],
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["entries"] });
    queryClient.invalidateQueries({ queryKey: ["open-entries"] });
  }

  function startEdit(entry: TimeEntry) {
    setAdding(false);
    setEditingId(entry.id);
    setStatus("");
    setDraft({
      clock_in: toLocalInput(entry.clock_in),
      clock_out: toLocalInput(entry.clock_out),
      job_id: entry.job_id ?? "",
      reason: "",
    });
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setStatus("");
    setDraft({
      clock_in: `${date}T07:00`,
      clock_out: `${date}T15:30`,
      job_id: employee?.assigned_job_id ?? "",
      reason: "",
    });
  }

  function noteLine(reason: string) {
    return `Manual adjustment ${new Date().toLocaleString()}: ${reason.trim()}`;
  }

  async function save() {
    if (!employeeId || !draft.reason.trim()) return;
    setBusy(true);
    try {
      if (adding) {
        const { error } = await supabase.from("time_entries").insert({
          employee_id: employeeId,
          job_id: draft.job_id || null,
          work_date: date,
          clock_in: fromLocalInput(draft.clock_in),
          clock_out: fromLocalInput(draft.clock_out),
          entry_type: "work",
          edited: true,
          notes: noteLine(draft.reason),
        });
        if (error) throw error;
        setStatus("Missing punch added.");
      } else if (editingId) {
        const existing = dayEntries.find((e) => e.id === editingId);
        const notes = [existing?.notes, noteLine(draft.reason)].filter(Boolean).join("\n");
        const { error } = await supabase
          .from("time_entries")
          .update({
            job_id: draft.job_id || null,
            clock_in: fromLocalInput(draft.clock_in),
            clock_out: fromLocalInput(draft.clock_out),
            edited: true,
            notes,
          })
          .eq("id", editingId);
        if (error) throw error;
        setStatus("Time corrected.");
      }
      setEditingId(null);
      setAdding(false);
      setDraft({ clock_in: "", clock_out: "", job_id: "", reason: "" });
      refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const formOpen = adding || editingId !== null;

  return (
    <div className="space-y-4">
      <div className="rounded-[26px] bg-primary-foreground/5 p-5 ring-1 ring-primary-foreground/10">
        <label className="block">
          <span className={label}>Employee</span>
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setEditingId(null);
              setAdding(false);
              setStatus("");
            }}
            className={field}
          >
            <option value="">Select an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id} className="text-ink">
                {fullName(e)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block">
          <span className={label}>Day</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setEditingId(null);
              setAdding(false);
            }}
            className={field}
          />
        </label>
      </div>

      {employeeId && (
        <div className="rounded-[26px] bg-primary-foreground/5 p-5 ring-1 ring-primary-foreground/10">
          <div className="flex items-center justify-between">
            <span className={label}>Time on this day</span>
            <button
              onClick={startAdd}
              className="rounded-lg bg-amber px-3 py-2 text-[12px] font-bold text-ink"
            >
              Add missing punch
            </button>
          </div>

          {dayEntries.length === 0 ? (
            <p className="mt-4 text-[13px] text-primary-foreground/50">
              No time recorded for this day.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {dayEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-primary-foreground/10 px-4 py-3 ring-1 ring-primary-foreground/10"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold">
                      {jobLabel(jobs.find((j) => j.id === entry.job_id))}
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-primary-foreground/60">
                      {formatTime(entry.clock_in)} – {formatTime(entry.clock_out)} ·{" "}
                      {entryHours(entry).toFixed(2)} h{entry.edited ? " · adjusted" : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(entry)}
                    className="shrink-0 rounded-lg bg-primary-foreground/10 px-3 py-2 text-[12px] font-semibold ring-1 ring-primary-foreground/15"
                  >
                    Adjust
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {formOpen && (
        <div className="animate-rise rounded-[26px] bg-primary-foreground/5 p-5 ring-1 ring-primary-foreground/10">
          <p className="font-display text-xl tracking-wide">
            {adding ? "Add missing punch" : "Adjust time"}
          </p>
          <label className="mt-4 block">
            <span className={label}>Job</span>
            <select
              value={draft.job_id}
              onChange={(e) => setDraft({ ...draft, job_id: e.target.value })}
              className={field}
            >
              <option value="">No job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id} className="text-ink">
                  {jobLabel(j)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Clock in</span>
              <input
                type="datetime-local"
                value={draft.clock_in}
                onChange={(e) => setDraft({ ...draft, clock_in: e.target.value })}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>Clock out</span>
              <input
                type="datetime-local"
                value={draft.clock_out}
                onChange={(e) => setDraft({ ...draft, clock_out: e.target.value })}
                className={field}
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className={label}>Reason for this change (required)</span>
            <textarea
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              rows={3}
              placeholder="Forgot to clock out, wrong job, left early…"
              className={`${field} text-[15px] font-medium`}
            />
          </label>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              onClick={save}
              disabled={busy || !draft.reason.trim()}
              className="skew-btn rounded-xl bg-amber py-5 font-display text-xl tracking-wide text-ink disabled:opacity-30"
            >
              <span>Save change</span>
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setAdding(false);
              }}
              className="rounded-xl bg-primary-foreground/10 py-5 font-display text-xl tracking-wide ring-1 ring-primary-foreground/20"
            >
              Cancel
            </button>
          </div>
          {!draft.reason.trim() && (
            <p className="mt-3 text-center text-[12px] text-primary-foreground/50">
              A reason is required before a change can be saved.
            </p>
          )}
        </div>
      )}

      {status && (
        <p className="rounded-xl bg-emerald/15 px-4 py-3 text-center text-[14px] font-semibold text-emerald ring-1 ring-emerald/30">
          {status}
        </p>
      )}
    </div>
  );
}
