import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, PortalShell } from "@/components/PortalShell";
import { KioskCodeForm } from "@/components/KioskCodeForm";
import { useDivisions, useJobs, useAllEmployees } from "@/hooks/use-timekeeping";
import { supabase } from "@/integrations/supabase/client";
import { fullName, jobLabel, type Division, type Employee, type Job } from "@/lib/timekeeping";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "TimeX" },
      { name: "description", content: "Manage divisions, jobs, employees, and kiosk settings." },
      { property: "og:title", content: "Admin — TimeX" },
      { property: "og:description", content: "Manage divisions, jobs, employees, and kiosk settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

type Tab = "employees" | "jobs" | "divisions" | "kiosk";

/** Brings the edit panel into view when a row is opened (it sits below the table on narrow screens). */
function useScrollToEditor(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [open]);
  return ref;
}

function AdminPage() {
  const [tab, setTab] = useState<Tab>("employees");

  return (
    <PortalShell
      title="Admin"
      subtitle="Manage divisions, jobs, employees, and the kiosk supervisor code"
      actions={
        <div className="flex rounded-lg bg-card/70 p-1 ring-1 ring-ink/5">
          {[
            { key: "employees", label: "Employees" },
            { key: "jobs", label: "Jobs" },
            { key: "divisions", label: "Divisions" },
            { key: "kiosk", label: "Kiosk Code" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as Tab)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                tab === t.key ? "bg-ink text-primary-foreground" : "text-steel hover:bg-ink/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === "employees" && <EmployeesSection />}
      {tab === "jobs" && <JobsSection />}
      {tab === "divisions" && <DivisionsSection />}
      {tab === "kiosk" && (
        <div className="max-w-xl">
          <KioskCodeForm />
        </div>
      )}
    </PortalShell>
  );
}

function EmployeesSection() {
  const queryClient = useQueryClient();
  const { data: employees = [] } = useAllEmployees();
  const { data: divisions = [] } = useDivisions();
  const { data: jobs = [] } = useJobs();

  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [filterDivision, setFilterDivision] = useState("");
  const [filterJob, setFilterJob] = useState("");

  const editorRef = useScrollToEditor(Boolean(editing));

  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);

  const filteredEmployees = useMemo(
    () =>
      employees.filter(
        (e) =>
          (!filterDivision || e.division_id === filterDivision) &&
          (!filterJob || e.assigned_job_id === filterJob),
      ),
    [employees, filterDivision, filterJob],
  );

  async function save() {
    if (!editing?.first_name || !editing?.last_name) return;
    setSaving(true);
    const payload = {
      first_name: editing.first_name,
      last_name: editing.last_name,
      division_id: editing.division_id || null,
      assigned_job_id: editing.assigned_job_id || null,
      active: editing.active ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);
    setSaving(false);
    if (error) {
      setMessage(error.message);
    } else {
      setMessage(editing.id ? "Employee updated." : "Employee added.");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["all-employees"] });
    }
  }

  return (
    <div className="grid grid-cols-12 gap-5">
      <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <span className="text-[13px] font-bold">Employees</span>
          <button
            onClick={() =>
              setEditing({ id: "", first_name: "", last_name: "", division_id: null, assigned_job_id: null, active: true })
            }
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
          >
            Add employee
          </button>
        </div>
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card/90 backdrop-blur">
              <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">Division</th>
                <th className="px-3 py-2.5 font-semibold">Assigned job</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                  <td className="px-4 py-2.5 font-semibold">{fullName(e)}</td>
                  <td className="px-3 py-2.5 text-steel">{divisionById.get(e.division_id ?? "")?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-steel">{jobLabel(jobs.find((j) => j.id === e.assigned_job_id))}</td>
                  <td className="px-3 py-2.5 text-steel">{e.active ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(e)}
                      className="rounded-md bg-card/80 px-2.5 py-1 text-[12px] font-medium text-steel ring-1 ring-ink/5 hover:bg-card"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {editing && (
        <Panel className="col-span-12 self-start xl:col-span-4">
          <div ref={editorRef} className="scroll-mt-24" />
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold">{editing.id ? "Edit employee" : "Add employee"}</span>
            <button onClick={() => setEditing(null)} className="text-[12px] text-steel hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">First name</span>
                <input
                  value={editing.first_name}
                  onChange={(e) => setEditing({ ...editing, first_name: e.target.value })}
                  className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Last name</span>
                <input
                  value={editing.last_name}
                  onChange={(e) => setEditing({ ...editing, last_name: e.target.value })}
                  className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Division</span>
              <select
                value={editing.division_id ?? ""}
                onChange={(e) => setEditing({ ...editing, division_id: e.target.value || null })}
                className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
              >
                <option value="">— None —</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Assigned job</span>
              <select
                value={editing.assigned_job_id ?? ""}
                onChange={(e) => setEditing({ ...editing, assigned_job_id: e.target.value || null })}
                className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
              >
                <option value="">— None —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobLabel(j)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                className="h-4 w-4 rounded border-ink/20"
              />
              Active employee
            </label>
            <button
              onClick={save}
              disabled={saving || !editing.first_name || !editing.last_name}
              className="skew-btn w-full rounded-xl bg-amber py-3 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/50"
            >
              <span>{saving ? "Saving…" : editing.id ? "Save changes" : "Add employee"}</span>
            </button>
            {message && <p className="text-[12px] font-semibold text-steel">{message}</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}

function JobsSection() {
  const queryClient = useQueryClient();
  const { data: jobs = [] } = useJobs();

  const [editing, setEditing] = useState<Partial<Job> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useScrollToEditor(Boolean(editing));

  async function save() {
    if (!editing?.number || !editing?.name) return;
    setSaving(true);
    const payload = {
      number: editing.number,
      name: editing.name,
      location: editing.location || null,
      active: editing.active ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("jobs").update(payload).eq("id", editing.id)
      : await supabase.from("jobs").insert(payload);
    setSaving(false);
    if (error) {
      setMessage(error.message);
    } else {
      setMessage(editing.id ? "Job updated." : "Job added.");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  }

  return (
    <div className="grid grid-cols-12 gap-5">
      <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <span className="text-[13px] font-bold">Jobs</span>
          <button
            onClick={() => setEditing({ id: "", number: "", name: "", location: "", active: true })}
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
          >
            Add job
          </button>
        </div>
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card/90 backdrop-blur">
              <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Number</th>
                <th className="px-3 py-2.5 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">Location</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                  <td className="px-4 py-2.5 font-mono font-semibold">#{j.number}</td>
                  <td className="px-3 py-2.5">{j.name}</td>
                  <td className="px-3 py-2.5 text-steel">{j.location || "—"}</td>
                  <td className="px-3 py-2.5 text-steel">{j.active ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(j)}
                      className="rounded-md bg-card/80 px-2.5 py-1 text-[12px] font-medium text-steel ring-1 ring-ink/5 hover:bg-card"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {editing && (
        <Panel className="col-span-12 self-start xl:col-span-4">
          <div ref={editorRef} className="scroll-mt-24" />
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold">{editing.id ? "Edit job" : "Add job"}</span>
            <button onClick={() => setEditing(null)} className="text-[12px] text-steel hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-1 block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Number</span>
                <input
                  value={editing.number}
                  onChange={(e) => setEditing({ ...editing, number: e.target.value })}
                  className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Name</span>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Location</span>
              <input
                value={editing.location ?? ""}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                className="h-4 w-4 rounded border-ink/20"
              />
              Active job
            </label>
            <button
              onClick={save}
              disabled={saving || !editing.number || !editing.name}
              className="skew-btn w-full rounded-xl bg-amber py-3 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/50"
            >
              <span>{saving ? "Saving…" : editing.id ? "Save changes" : "Add job"}</span>
            </button>
            {message && <p className="text-[12px] font-semibold text-steel">{message}</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}

function DivisionsSection() {
  const queryClient = useQueryClient();
  const { data: divisions = [] } = useDivisions();

  const [editing, setEditing] = useState<Partial<Division> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useScrollToEditor(Boolean(editing));

  async function save() {
    if (!editing?.name || !editing?.code) return;
    setSaving(true);
    const payload = { name: editing.name, code: editing.code };
    const { error } = editing.id
      ? await supabase.from("divisions").update(payload).eq("id", editing.id)
      : await supabase.from("divisions").insert(payload);
    setSaving(false);
    if (error) {
      setMessage(error.message);
    } else {
      setMessage(editing.id ? "Division updated." : "Division added.");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["divisions"] });
    }
  }

  return (
    <div className="grid grid-cols-12 gap-5">
      <Panel className="col-span-12 flex flex-col overflow-hidden xl:col-span-8">
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <span className="text-[13px] font-bold">Divisions</span>
          <button
            onClick={() => setEditing({ id: "", name: "", code: "" })}
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
          >
            Add division
          </button>
        </div>
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card/90 backdrop-blur">
              <tr className="border-b border-line/70 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">Code</th>
                <th className="px-3 py-2.5 text-right font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {divisions.map((d) => (
                <tr key={d.id} className="border-b border-line/60 hover:bg-ink/[0.02]">
                  <td className="px-4 py-2.5 font-semibold">{d.name}</td>
                  <td className="px-3 py-2.5 font-mono text-steel">{d.code}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(d)}
                      className="rounded-md bg-card/80 px-2.5 py-1 text-[12px] font-medium text-steel ring-1 ring-ink/5 hover:bg-card"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {editing && (
        <Panel className="col-span-12 self-start xl:col-span-4">
          <div ref={editorRef} className="scroll-mt-24" />
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold">{editing.id ? "Edit division" : "Add division"}</span>
            <button onClick={() => setEditing(null)} className="text-[12px] text-steel hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Name</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">Code</span>
              <input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                className="mt-1 w-full rounded-lg bg-card/80 px-3 py-2 text-[13px] ring-1 ring-ink/5"
              />
            </label>
            <button
              onClick={save}
              disabled={saving || !editing.name || !editing.code}
              className="skew-btn w-full rounded-xl bg-amber py-3 font-display text-[15px] tracking-wide text-ink transition-colors hover:bg-amber-deep disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/50"
            >
              <span>{saving ? "Saving…" : editing.id ? "Save changes" : "Add division"}</span>
            </button>
            {message && <p className="text-[12px] font-semibold text-steel">{message}</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}
