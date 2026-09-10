import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployees, useJobs, useOpenEntries } from "@/hooks/use-timekeeping";
import { applyPunch, fullName, jobLabel, type Employee, type Job } from "@/lib/timekeeping";
import { enqueue, flushQueue, getQueue } from "@/lib/offline-queue";
import eciLogo from "@/assets/eci-logo.png.asset.json";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/kiosk")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Jobsite Kiosk — ECI Timekeeping" },
      { name: "description", content: "Clock in and out on the jobsite. No login needed." },
      { property: "og:title", content: "Jobsite Kiosk — ECI Timekeeping" },
      { property: "og:description", content: "Clock in and out on the jobsite. No login needed." },
    ],
  }),
  component: Kiosk,
});

type Result = { ok: boolean; message: string; detail: string } | null;

function Kiosk() {
  const queryClient = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: jobs = [] } = useJobs();
  const { data: openEntries = [] } = useOpenEntries();

  const [employeeId, setEmployeeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [override, setOverride] = useState(false);
  const [clock, setClock] = useState("");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const employee = useMemo<Employee | undefined>(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  );
  const assignedJob = useMemo<Job | undefined>(
    () => jobs.find((j) => j.id === employee?.assigned_job_id),
    [jobs, employee],
  );
  const selectedJob = useMemo<Job | undefined>(
    () => jobs.find((j) => j.id === jobId),
    [jobs, jobId],
  );
  const isClockedIn = openEntries.some((e) => e.employee_id === employeeId);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const syncQueue = useCallback(async () => {
    const { sent } = await flushQueue();
    setPending(getQueue().length);
    if (sent > 0) {
      queryClient.invalidateQueries({ queryKey: ["open-entries"] });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
    }
  }, [queryClient]);

  useEffect(() => {
    setPending(getQueue().length);
    setOnline(navigator.onLine);
    const onQueue = () => setPending(getQueue().length);
    const goOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("eci-queue-changed", onQueue);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) void syncQueue();
    return () => {
      window.removeEventListener("eci-queue-changed", onQueue);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncQueue]);

  // Default the job to whatever the office assigned this employee.
  useEffect(() => {
    if (!employee) return;
    setOverride(false);
    setJobId(employee.assigned_job_id ?? "");
  }, [employee]);

  const jobChoices = override || !assignedJob ? jobs : jobs.filter((j) => j.id === assignedJob.id);

  function selectEmployee(nextEmployeeId: string) {
    const nextEmployee = employees.find((item) => item.id === nextEmployeeId);
    setEmployeeId(nextEmployeeId);
    setJobId(nextEmployee?.assigned_job_id ?? "");
    setOverride(false);
  }

  async function punch(action: "in" | "out") {
    if (!employee || !jobId) return;
    setBusy(true);
    const payload = {
      employee_id: employee.id,
      job_id: jobId,
      action,
      at: new Date().toISOString(),
      job_overridden: override,
    };
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    try {
      if (!navigator.onLine) throw new Error("offline");
      const message = await applyPunch(payload);
      setResult({
        ok: true,
        message,
        detail: `${fullName(employee)} · ${jobLabel(selectedJob)} · ${stamp}`,
      });
      queryClient.invalidateQueries({ queryKey: ["open-entries"] });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
    } catch (error) {
      const offline = !navigator.onLine || (error as Error).message === "offline";
      if (offline) {
        enqueue({
          ...payload,
          queued_id: crypto.randomUUID(),
          employee_name: fullName(employee),
          job_label: jobLabel(selectedJob),
        });
        setResult({
          ok: true,
          message: action === "in" ? "Clock in saved on device" : "Clock out saved on device",
          detail: `No signal — sends automatically when you're back online · ${stamp}`,
        });
      } else {
        setResult({
          ok: false,
          message: "Punch not recorded",
          detail: (error as Error).message,
        });
      }
    } finally {
      setBusy(false);
      setEmployeeId("");
      setJobId("");
      setOverride(false);
      window.setTimeout(() => setResult(null), 6000);
    }
  }

  return (
    <div className="min-h-screen bg-kiosk px-4 py-5 text-primary-foreground sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[520px] flex-col">
        <div>
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={eciLogo.url}
                alt="Electrical Contractor Inc."
                className="h-11 w-11 rounded object-contain"
              />
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
                Punch
              </span>
            </div>
            <div className="text-right leading-none">
              <div className="font-mono text-2xl">{clock}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-primary-foreground/40">
                {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </div>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span
              className={`h-2 w-2 rounded-full ${online ? "bg-emerald animate-blip" : "bg-amber"}`}
            />
            <span className="text-primary-foreground/60">
              {online ? "Connected" : "No signal — punches save on this device"}
            </span>
            {pending > 0 && (
              <span className="ml-auto rounded bg-amber/20 px-2 py-1 text-amber">
                {pending} waiting to send
              </span>
            )}
          </div>

          {result ? (
            <div
              className={`animate-rise rounded-[26px] p-8 text-center ring-1 ${
                result.ok ? "bg-emerald/15 ring-emerald/40" : "bg-rose/15 ring-rose/40"
              }`}
            >
              <div
                className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl font-bold ${
                  result.ok ? "bg-emerald text-primary-foreground" : "bg-rose text-primary-foreground"
                }`}
              >
                {result.ok ? "✓" : "!"}
              </div>
              <p className="mt-4 font-display text-3xl tracking-wide">{result.message}</p>
              <p className="mt-2 text-[14px] text-primary-foreground/70">{result.detail}</p>
              <button
                onClick={() => setResult(null)}
                className="mt-6 w-full rounded-xl bg-primary-foreground/10 py-4 font-display text-xl tracking-wide ring-1 ring-primary-foreground/20"
              >
                Next employee
              </button>
            </div>
          ) : (
            <div className="rounded-[26px] bg-primary-foreground/5 p-5 ring-1 ring-primary-foreground/10">
              <label className="block">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-primary-foreground/50">
                  Your name
                </span>
                <select
                  value={employeeId}
                  onChange={(e) => selectEmployee(e.target.value)}
                  className="mt-2 w-full appearance-none rounded-xl bg-primary-foreground/10 px-4 py-5 text-[19px] font-bold text-primary-foreground ring-1 ring-primary-foreground/15"
                >
                  <option value="">Select your name</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id} className="text-ink">
                      {fullName(e)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-4 block">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-primary-foreground/50">
                  Job
                </span>
                <select
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                  disabled={!employeeId}
                  className="mt-2 w-full appearance-none rounded-xl bg-primary-foreground/10 px-4 py-5 text-[19px] font-bold text-primary-foreground ring-1 ring-primary-foreground/15 disabled:opacity-40"
                >
                  <option value="">Select a job</option>
                  {jobChoices.map((j) => (
                    <option key={j.id} value={j.id} className="text-ink">
                      {jobLabel(j)}
                    </option>
                  ))}
                </select>
              </label>

              {employeeId && (
                <button
                  onClick={() => setOverride((v) => !v)}
                  className="mt-3 w-full rounded-xl bg-primary-foreground/5 px-4 py-3 text-left text-[13px] font-semibold text-amber ring-1 ring-primary-foreground/10"
                >
                  {override
                    ? "Showing all jobs — tap to use the assigned job"
                    : "Wrong job? Tap to choose from all jobs"}
                </button>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={() => punch("in")}
                  disabled={busy || !employeeId || !jobId || isClockedIn}
                  className="skew-btn rounded-xl bg-amber py-8 font-display text-2xl tracking-wide text-ink transition-transform active:translate-y-1 disabled:opacity-30"
                >
                  <span>Clock In</span>
                </button>
                <button
                  onClick={() => punch("out")}
                  disabled={busy || !employeeId || !isClockedIn}
                  className="skew-btn rounded-xl bg-primary-foreground/10 py-8 font-display text-2xl tracking-wide text-primary-foreground ring-1 ring-primary-foreground/20 transition-transform active:translate-y-1 disabled:opacity-30"
                >
                  <span>Clock Out</span>
                </button>
              </div>

              {employeeId && (
                <p className="mt-4 text-center text-[13px] text-primary-foreground/50">
                  {isClockedIn
                    ? "You are clocked in right now."
                    : assignedJob
                      ? `Assigned to ${jobLabel(assignedJob)}`
                      : "No job assigned yet — pick one from the list."}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-auto pt-8">
          <Link
            to="/adjustments"
            className="flex items-center justify-between rounded-[22px] bg-primary-foreground/5 px-5 py-4 ring-1 ring-primary-foreground/15 transition-colors active:bg-primary-foreground/10"
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-foreground/10 text-primary-foreground/70">
                <Lock className="h-4 w-4" />
              </span>
              <div className="text-left leading-tight">
                <span className="block font-display text-lg tracking-wide text-primary-foreground/90">
                  Adjustments
                </span>
                <span className="text-[11px] uppercase tracking-wide text-primary-foreground/40">
                  Supervisor code required
                </span>
              </div>
            </div>
            <span className="text-[18px] text-primary-foreground/40">›</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
