import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveTimekeeping } from "@/hooks/use-timekeeping";
import { useAccess } from "@/hooks/use-access";
import { supabase } from "@/integrations/supabase/client";
import eciLogo from "@/assets/eci-logo.png.asset.json";

export const NAV = [
  { to: "/", label: "Home", adminOnly: false },
  { to: "/operations", label: "Operations", adminOnly: false },
  { to: "/time-entries", label: "Time Entries", adminOnly: false },
  { to: "/pto", label: "PTO & Holiday", adminOnly: false },
  { to: "/reports", label: "Reports", adminOnly: false },
  { to: "/payroll", label: "Payroll", adminOnly: false },
  { to: "/admin", label: "Admin", adminOnly: true },
] as const;

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  payroll: "Payroll",
  viewer: "View only",
};

function AccountMenu() {
  const { access } = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <div className="text-[12px] font-semibold">{access.displayName || access.email}</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {access.role ? ROLE_LABEL[access.role] : "No access"}
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="rounded-lg bg-card/70 px-3 py-2 text-[12px] font-semibold text-steel ring-1 ring-ink/5 transition-colors hover:bg-card"
      >
        Sign out
      </button>
    </div>
  );
}

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
