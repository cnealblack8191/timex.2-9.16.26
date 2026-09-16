import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import eciLogo from "@/assets/eci-logo.png.asset.json";
import { capturePunchPhoto } from "@/lib/capture-photo";
import { kioskBootstrap, kioskPunch } from "@/lib/kiosk.functions";
import { resolveClockedIn } from "@/lib/kiosk-state";
import {
  KIOSK_BOOTSTRAP_KEY,
  type KioskBootstrap,
  type KioskEmployee,
  type KioskJob,
  type KioskPunchInput,
} from "@/lib/kiosk-types";
import {
  QUEUE_EVENT,
  clearRejected,
  enqueue,
  flushQueue,
  getQueue,
  getRejected,
  type QueuedPunch,
  type RejectedPunch,
} from "@/lib/offline-queue";
import { registerKioskServiceWorker } from "@/lib/pwa";
import { fullName, jobLabel } from "@/lib/timekeeping";

export const Route = createFileRoute("/kiosk")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "TimeX" },
      { name: "description", content: "Clock in and out on the jobsite. No login needed." },
      { property: "og:title", content: "Jobsite Kiosk — TimeX" },
      { property: "og:description", content: "Clock in and out on the jobsite. No login needed." },
      { name: "theme-color", content: "#1c232b" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/kiosk-180.png" },
    ],
  }),
  component: Kiosk,
});

/* ---------- on-device copy of the employee and job lists, for offline starts ---------- */

const BOOTSTRAP_CACHE_KEY = "eci-kiosk-bootstrap";

function readCachedBootstrap(): KioskBootstrap | undefined {
  try {
    const raw = window.localStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<KioskBootstrap>;
    if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.jobs)) return undefined;
    return {
      synced_at: parsed.synced_at ?? "",
      timezone: parsed.timezone ?? "",
      divisions: parsed.divisions ?? [],
      jobs: parsed.jobs,
      employees: parsed.employees,
      open_entries: parsed.open_entries ?? [],
    };
  } catch {
    return undefined;
  }
}

function writeCachedBootstrap(data: KioskBootstrap) {
  try {
    window.localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the live data still works for this session.
  }
}

type Result = { ok: boolean; message: string; detail: string } | null;

function Kiosk() {
  const queryClient = useQueryClient();
  const { data: boot, isError } = useQuery({
    queryKey: KIOSK_BOOTSTRAP_KEY,
    queryFn: async () => {
      const data = await kioskBootstrap();
      writeCachedBootstrap(data);
      return data;
    },
    initialData: readCachedBootstrap,
    staleTime: 0,
    retry: 1,
    refetchInterval: 30_000,
  });

  const employees = useMemo<KioskEmployee[]>(() => boot?.employees ?? [], [boot]);
  const jobs = useMemo<KioskJob[]>(() => (boot?.jobs ?? []).filter((j) => j.active), [boot]);
  const openEntries = useMemo(() => boot?.open_entries ?? [], [boot]);

  const [employeeId, setEmployeeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [clock, setClock] = useState("");
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedPunch[]>(() => getQueue());
  const [rejected, setRejected] = useState<RejectedPunch[]>(() => getRejected());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const employee = useMemo(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  );
  const assignedJob = useMemo(
    () => jobs.find((j) => j.id === employee?.assigned_job_id),
    [jobs, employee],
  );
  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId), [jobs, jobId]);

  // Punches still waiting on this device count: a queued clock-in means "clocked in"
  // even though the server has not heard about it yet.
  const isClockedIn = resolveClockedIn(openEntries, queue, employeeId);
  const pending = queue.length;

  useEffect(() => {
    registerKioskServiceWorker();
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const refreshQueueState = useCallback(() => {
    setQueue(getQueue());
    setRejected(getRejected());
  }, []);

  const syncQueue = useCallback(async () => {
    const outcome = await flushQueue();
    refreshQueueState();
    if (outcome.sent > 0 || outcome.rejected > 0) {
      void queryClient.invalidateQueries({ queryKey: KIOSK_BOOTSTRAP_KEY });
    }
  }, [queryClient, refreshQueueState]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener(QUEUE_EVENT, refreshQueueState);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) void syncQueue();
    return () => {
      window.removeEventListener(QUEUE_EVENT, refreshQueueState);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncQueue, refreshQueueState]);

  function selectEmployee(nextEmployeeId: string) {
    const nextEmployee = employees.find((item) => item.id === nextEmployeeId);
    setEmployeeId(nextEmployeeId);
    // Default the job to whatever the office assigned this employee.
    setJobId(nextEmployee?.assigned_job_id ?? "");
  }

  async function punch(action: "in" | "out") {
    if (!employee || !jobId) return;
    setBusy(true);
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const base: KioskPunchInput = {
      punch_id: crypto.randomUUID(),
      employee_id: employee.id,
      job_id: jobId,
      action,
      at: new Date().toISOString(),
      job_overridden: jobId !== employee.assigned_job_id,
    };
    const detail = `${fullName(employee)} · ${jobLabel(selectedJob)} · ${stamp}`;
    // A photo is a bonus, never a blocker: if the camera is off, the punch still goes through.
    const photo = await capturePunchPhoto();
    const queued: QueuedPunch = {
      ...base,
      photo,
      employee_name: fullName(employee),
      job_label: jobLabel(selectedJob),
      queued_at: new Date().toISOString(),
    };
    const saveOnDevice = () => {
      enqueue(queued);
      setResult({
        ok: true,
        message: action === "in" ? "Clock in saved on device" : "Clock out saved on device",
        detail: `No signal — sends automatically when you're back online · ${stamp}`,
      });
    };

    try {
      if (!navigator.onLine) {
        saveOnDevice();
        return;
      }
      const response = await kioskPunch({ data: { ...base, photo } });
      if (response.ok) {
        setResult({ ok: true, message: response.message, detail });
        void queryClient.invalidateQueries({ queryKey: KIOSK_BOOTSTRAP_KEY });
      } else if (response.retry) {
        saveOnDevice();
      } else {
        setResult({ ok: false, message: "Punch not recorded", detail: response.message });
      }
    } catch {
      // The request never reached the server: keep it on the device.
      saveOnDevice();
    } finally {
      setBusy(false);
      setEmployeeId("");
      setJobId("");
      window.setTimeout(() => setResult(null), 6000);
    }
  }

  const noData = !boot;

  return (
    <div className="min-h-[100dvh] bg-kiosk px-4 py-5 text-primary-foreground sm:px-6 landscape:py-3">
      <div className="mx-auto flex min-h-[calc(100dvh-40px)] w-full max-w-[520px] flex-col landscape:max-w-[920px]">
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
                {new Date().toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
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

          {rejected.length > 0 && (
            <div className="mb-4 rounded-xl bg-rose/15 px-4 py-3 text-[13px] ring-1 ring-rose/40">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">
                  {rejected.length === 1
                    ? "1 punch could not be recorded"
                    : `${rejected.length} punches could not be recorded`}
                </span>
                <button
                  onClick={() => {
                    clearRejected();
                    setRejected([]);
                  }}
                  className="rounded-md bg-primary-foreground/10 px-2.5 py-1 text-[12px] font-semibold"
                >
                  Dismiss
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-[12px] text-primary-foreground/80">
                {rejected.slice(-3).map((r) => (
                  <li key={r.punch.punch_id}>
                    {r.punch.employee_name || "Unknown"} ·{" "}
                    {r.punch.action === "in" ? "Clock in" : "Clock out"} · {r.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-primary-foreground/50">
                Tell the office so the time can be corrected.
              </p>
            </div>
          )}

          {result ? (
            <div
              className={`animate-rise rounded-[26px] p-8 text-center ring-1 ${
                result.ok ? "bg-emerald/15 ring-emerald/40" : "bg-rose/15 ring-rose/40"
              }`}
            >
              <div
                className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl font-bold ${
                  result.ok
                    ? "bg-emerald text-primary-foreground"
                    : "bg-rose text-primary-foreground"
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
          ) : noData ? (
            <div className="rounded-[26px] bg-primary-foreground/5 p-8 text-center ring-1 ring-primary-foreground/10">
              <p className="font-display text-2xl tracking-wide">
                {isError || !online ? "Waiting for a connection" : "Loading…"}
              </p>
              <p className="mt-3 text-[13px] text-primary-foreground/60">
                {isError || !online
                  ? "This device has not loaded the crew list yet. Connect once and the kiosk will work offline from then on."
                  : "Loading the crew and job lists."}
              </p>
            </div>
          ) : (
            <div className="rounded-[26px] bg-primary-foreground/5 p-5 ring-1 ring-primary-foreground/10 landscape:grid landscape:grid-cols-2 landscape:gap-x-6">
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

              <label className="mt-4 block landscape:mt-0">
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
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id} className="text-ink">
                      {jobLabel(j)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-5 grid grid-cols-2 gap-3 landscape:col-span-2 landscape:mt-4">
                <button
                  onClick={() => punch("in")}
                  disabled={busy || !employeeId || !jobId || isClockedIn}
                  className="skew-btn rounded-xl bg-amber py-8 font-display text-2xl tracking-wide text-ink transition-transform active:translate-y-1 disabled:opacity-30 landscape:py-5"
                >
                  <span>Clock In</span>
                </button>
                <button
                  onClick={() => punch("out")}
                  disabled={busy || !employeeId || !isClockedIn}
                  className="skew-btn rounded-xl bg-primary-foreground/10 py-8 font-display text-2xl tracking-wide text-primary-foreground ring-1 ring-primary-foreground/20 transition-transform active:translate-y-1 disabled:opacity-30 landscape:py-5"
                >
                  <span>Clock Out</span>
                </button>
              </div>

              {employeeId && (
                <p className="mt-4 text-center text-[13px] text-primary-foreground/50 landscape:col-span-2">
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

        <div className="mt-auto pt-8 landscape:pt-4">
          <Link
            to="/adjustments"
            className="flex items-center justify-between rounded-[22px] bg-primary-foreground/5 px-5 py-4 ring-1 ring-primary-foreground/15 transition-colors active:bg-primary-foreground/10"
          >
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
          <p className="mt-3 text-center text-[11px] text-primary-foreground/40">
            A photo is taken with each punch and kept for 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}
