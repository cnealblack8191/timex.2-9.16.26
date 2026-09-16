import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import eciLogo from "@/assets/eci-logo.png.asset.json";
import timexLogo from "@/assets/timex-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "TimeX" },
      { name: "description", content: "Sign in to the TimeX office portal." },
      { property: "og:title", content: "Sign in — TimeX" },
      { property: "og:description", content: "Sign in to the TimeX office portal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError("That email and password don't match an active account.");
      return;
    }
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="page-wash flex min-h-screen w-full flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <img
        src={eciLogo.url}
        alt="Electrical Contractor Inc."
        className="h-16 w-16 rounded-xl object-contain"
      />
      <img src={timexLogo.url} alt="TimeX" className="mt-5 h-11 w-auto" width={1024} height={512} />
      <h1 className="sr-only">Sign in to TimeX</h1>

      <form onSubmit={signIn} className="panel mt-8 w-full max-w-sm space-y-4 p-6">
        <div>
          <label className="text-[12px] font-medium text-steel" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-ink/10"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-steel" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-ink/10"
          />
        </div>

        {error && <p className="text-[12.5px] text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-[11.5px] text-muted-foreground">
          Accounts are created by an administrator.
        </p>
      </form>
    </div>
  );
}
