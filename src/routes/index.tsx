import { createFileRoute, Link } from "@tanstack/react-router";
import eciLogo from "@/assets/eci-logo.png.asset.json";
import timexLogo from "@/assets/timex-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TimeX — ECI Timekeeping" },
      {
        name: "description",
        content:
          "TimeX by Electrical Contractor Inc. — simple field timekeeping, payroll hours, and job assignments.",
      },
      { property: "og:title", content: "TimeX — ECI Timekeeping" },
      {
        property: "og:description",
        content:
          "TimeX by Electrical Contractor Inc. — simple field timekeeping, payroll hours, and job assignments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const TILES = [
  {
    to: "/operations",
    label: "Operations",
    description: "Who's on the clock right now, this week's hours, and recent punches.",
  },
  {
    to: "/time-entries",
    label: "Time Entries",
    description: "Review, correct, or remove any employee time entry.",
  },
  {
    to: "/assignments",
    label: "Assignments",
    description: "Assign employees to jobs, one at a time or by division.",
  },
  {
    to: "/pto",
    label: "PTO & Vacation",
    description: "Enter paid time off or vacation pay for one or many employees.",
  },
  {
    to: "/payroll",
    label: "Payroll",
    description: "Weekly hours by employee, overtime flags, and CSV or PDF export.",
  },
  {
    to: "/admin",
    label: "Admin",
    description: "Manage employees, jobs, divisions, and the kiosk code.",
  },
] as const;

function Home() {
  return (
    <div className="page-wash flex min-h-screen w-full flex-col items-center bg-background px-6 py-10 text-foreground">
      <img
        src={eciLogo.url}
        alt="Electrical Contractor Inc."
        className="h-20 w-20 rounded-xl object-contain"
      />
      <img
        src={timexLogo.url}
        alt="TimeX"
        className="mt-6 h-14 w-auto"
        width={1024}
        height={512}
      />
      <p className="mt-2 text-[12px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
        Electrical Contractor Inc. timekeeping
      </p>

      <div className="mt-10 grid w-full max-w-[900px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="panel group flex flex-col gap-2 p-5 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <span className="font-display text-[17px] tracking-wide text-ink group-hover:text-amber-deep">
              {tile.label}
            </span>
            <span className="text-[12.5px] leading-relaxed text-muted-foreground">
              {tile.description}
            </span>
          </Link>
        ))}
      </div>

      <Link
        to="/kiosk"
        className="mt-10 rounded-xl bg-ink px-5 py-3 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Open the kiosk
      </Link>
    </div>
  );
}
