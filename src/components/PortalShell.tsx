import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLiveTimekeeping } from "@/hooks/use-timekeeping";
import eciLogo from "@/assets/eci-logo.png.asset.json";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/operations", label: "Operations" },
  { to: "/time-entries", label: "Time Entries" },
  { to: "/pto", label: "PTO & Holiday" },
  { to: "/reports", label: "Reports" },
  { to: "/payroll", label: "Payroll" },
  { to: "/admin", label: "Admin" },
] as const;

export function PortalShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useLiveTimekeeping();

  return (
    <div className="page-wash min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-3 rounded-md transition-opacity hover:opacity-80">
            <img
              src={eciLogo.url}
              alt="Electrical Contractor Inc."
              className="h-10 w-10 rounded-md object-contain"
            />
            <div className="leading-none">
              <div className="font-display text-[15px] tracking-wide">TIMEX</div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Electrical Contractor Inc.
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-[13px] font-medium text-steel">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "bg-ink text-primary-foreground" }}
                className="rounded-md px-3 py-2 transition-colors hover:bg-ink/5"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            to="/kiosk"
            className="rounded-lg bg-card/70 px-3 py-2 text-[12px] font-semibold text-steel ring-1 ring-ink/5 transition-colors hover:bg-card"
          >
            Open kiosk
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-6">
        <div className="mb-5 flex items-end justify-between animate-rise">
          <div>
            <h1 className="text-balance font-display text-[34px] leading-none">{title}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-[12px] font-medium">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}
