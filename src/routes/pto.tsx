import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import { useDivisions, useEmployees, useWeekEntries } from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import { entryHours, formatDay, fullName, toDateKey } from "@/lib/timekeeping";

export const Route = createFileRoute("/pto")({
  head: () => ({
    meta: [
      { title: "PTO & Vacation — TimeX" },
      { name: "description", content: "Enter PTO and vacation pay for one employee or a whole crew." },
      { property: "og:title", content: "PTO & Vacation — TimeX" },
      { property: "og:description", content: "Enter PTO and vacation pay for one employee or a whole crew." },
    ],
  }),
  component: PtoPage,
});

function PtoPage() {
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: divisions = [] } = useDivisions();
  const { data: weekEntries = [] } = useWeekEntries(new Date());

  const [type, setType] = useState<"pto" | "vacation">("pto");
  const [date, setDate] = useState(toDateKey(new Date()));
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);

  const visible = employees.filter((e) => {
    if (divisionFilter && e.division_id !== divisionFilter) return false;
    if (search && !fullName(e).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const recent = weekEntries.filter((e) => e.entry_type !== "work");

  async function submit() {
    if (selected.length === 0 || !date) return;
    setSaving(true);
    const rows = selected.map((employee_id) => ({
      employee_id,
      job_id: null,
      work_date: date,
      entry_type: type,
      manual_hours: Number(hours) || 0,
      notes: notes || null,
    }));
    const { error } = await supabase.from("time_entries").insert(rows);
    setSaving(false);
    if (error) return setNote(error.message);
    setNote(
      `${type === "pto" ? "PTO" : "Vacation pay"} added for ${selected.length} employee${
        selected.length === 1 ? "" : "s"
      }`,
    );
    setSelected([]);
    setNotes("");
    queryClient.invalidateQueries({ queryKey: ["entries"] });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.includes(e.id));

  return (
    <PortalShell
      title="PTO & Vacation"
      subtitle="Add paid time off or vacation pay for one employee or a whole division"
    >
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-7">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees"
              className="rounded-md bg-card/80 px-3 py-1.5 text-[12px] ring-1 ring-ink/5"
            />
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSelected(allVisibleSelected ? [] : visible.map((e) => e.id))}
              className="ml-auto rounded-md bg-card/80 px-2.5 py-1.5 text-[12px] font-medium text-steel ring-1 ring-ink/5"
            >
              {allVisibleSelected ? "Clear selection" : `Select all ${visible.length}`}
            </button>
          </div>
          <div className="grid max-h-[560px] grid-cols-1 gap-1.5 overflow-auto p-3 sm:grid-cols-2">
            {visible.map((e) => {
              const checked = selected.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() =>
                    setSelected((prev) =>
                      checked ? prev.filter((id) => id !== e.id) : [...prev, e.id],
                    )
                  }
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] ${
                    checked ? "bg-amber/15 ring-1 ring-amber/40" : "bg-card/80"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-[5px] text-[10px] font-bold ${
                      checked ? "bg-amber text-ink" : "ring-1 ring-line"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span className="font-semibold">{fullName(e)}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {divisionById.get(e.division_id ?? "")?.name ?? "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="col-span-12 flex flex-col gap-5 xl:col-span-5">
          <Panel className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              New Entry
            </span>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["pto", "vacation"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`rounded-lg py-2.5 text-[13px] font-semibold ${
                    type === t ? "bg-ink text-primary-foreground" : "bg-card/80 text-steel ring-1 ring-ink/5"
                  }`}
                >
                  {t === "pto" ? "PTO" : "Vacation pay"}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-transparent font-mono text-[13px] font-semibold"
                />
              </label>
              <label className="rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Hours</span>
                <input
                  type="number"
                  step="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-full bg-transparent font-mono text-[13px] font-semibold"
                />
              </label>
            </div>
            <label className="mt-3 block rounded-lg bg-card/80 px-3 py-2.5 ring-1 ring-ink/5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full bg-transparent text-[13px]"
              />
            </label>
            <div className="mt-3 text-[12px] text-muted-foreground">
              {note || `${selected.length} employees selected`}
            </div>
            <button
              onClick={submit}
              disabled={saving || selected.length === 0}
              className="skew-btn mt-3 w-full rounded-xl bg-amber py-3.5 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:opacity-40"
            >
              <span>
                {saving
                  ? "Saving…"
                  : `Add ${hours || 0} hrs for ${selected.length} employee${
                      selected.length === 1 ? "" : "s"
                    }`}
              </span>
            </button>
          </Panel>

          <Panel className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-steel">
              This Week's PTO & Vacation
            </span>
            <ul className="mt-3 space-y-1.5">
              {recent.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg bg-card/80 px-3 py-2 text-[13px]"
                >
                  <span className="font-semibold">
                    {fullName(employeeById.get(entry.employee_id)!) ?? "Unknown"}
                  </span>
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-steel">
                    {entry.entry_type}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatDay(entry.work_date)}
                  </span>
                  <span className="font-mono text-[12px] font-semibold">
                    {entryHours(entry).toFixed(1)}
                  </span>
                </li>
              ))}
              {recent.length === 0 && (
                <li className="rounded-lg bg-card/80 px-3 py-4 text-center text-[12px] text-muted-foreground">
                  Nothing entered for this week yet.
                </li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </PortalShell>
  );
}
