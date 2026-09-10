import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { changeKioskPin } from "@/lib/kiosk-pin.functions";

export function KioskCodeForm() {
  const change = useServerFn(changeKioskPin);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await change({ data: { currentPin, newPin } });
      setMessage(result.message);
      if (result.ok) {
        setCurrentPin("");
        setNewPin("");
      }
    } catch {
      setMessage("Could not update the code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl bg-card/60 p-4 ring-1 ring-ink/5">
      <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-steel">
        Kiosk adjustment code
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Needed on the jobsite before anyone can change a punch by hand.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <input
          type="password"
          inputMode="numeric"
          value={currentPin}
          onChange={(e) => setCurrentPin(e.target.value)}
          placeholder="Current code"
          className="rounded-lg bg-background px-3 py-2 text-[13px] ring-1 ring-ink/10"
        />
        <input
          type="text"
          inputMode="numeric"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
          placeholder="New code"
          className="rounded-lg bg-background px-3 py-2 text-[13px] ring-1 ring-ink/10"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !currentPin || !newPin}
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-[12px] font-semibold text-primary-foreground disabled:opacity-30"
      >
        Update code
      </button>
      {message && <p className="mt-2 text-[12px] font-semibold text-steel">{message}</p>}
    </form>
  );
}
