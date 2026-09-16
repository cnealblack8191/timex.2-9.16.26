import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/PortalShell";
import { useDivisions } from "@/hooks/use-timekeeping";
import {
  createUser,
  listUsers,
  updateUser,
  type AppRole,
  type ManagedUser,
} from "@/lib/auth.functions";

const ROLES: { value: AppRole; label: string; hint: string }[] = [
  { value: "admin", label: "Administrator", hint: "Full access, including user management" },
  {
    value: "payroll",
    label: "Payroll",
    hint: "Sees every division, changes time only for assigned divisions",
  },
  { value: "viewer", label: "View only", hint: "Read-only, limited to assigned divisions" },
];

type Draft = {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
  divisionIds: string[];
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  email: "",
  password: "",
  displayName: "",
  role: "viewer",
  divisionIds: [],
  active: true,
};

export function UsersSection() {
  const queryClient = useQueryClient();
  const { data: divisions = [] } = useDivisions();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["portal-users"],
    queryFn: () => listUsers(),
  });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(EMPTY_DRAFT);
  const [message, setMessage] = useState("");

  const divisionName = useMemo(
    () => new Map(divisions.map((d) => [d.id, d.name])),
    [divisions],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portal-users"] });

  const create = useMutation({
    mutationFn: () =>
      createUser({
        data: {
          email: draft.email,
          password: draft.password,
          displayName: draft.displayName,
          role: draft.role,
          divisionIds: draft.divisionIds,
          employeeIds: [],
        },
      }),
    onSuccess: async () => {
      setAdding(false);
      setDraft(EMPTY_DRAFT);
      setMessage("Account created. Share the temporary password with them.");
      await refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const save = useMutation({
    mutationFn: (user: ManagedUser) =>
      updateUser({
        data: {
          id: user.id,
          displayName: edit.displayName,
          role: edit.role,
          divisionIds: edit.divisionIds,
          employeeIds: user.employeeIds,
          active: edit.active,
          ...(edit.password ? { password: edit.password } : {}),
        },
      }),
    onSuccess: async () => {
      setEditingId(null);
      setMessage("Changes saved.");
      await refresh();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  function startEdit(user: ManagedUser) {
    setEditingId(user.id);
    setMessage("");
    setEdit({
      email: user.email,
      password: "",
      displayName: user.displayName,
      role: user.role ?? "viewer",
      divisionIds: user.divisionIds,
      active: user.active,
    });
  }

  function toggleDivision(list: string[], id: string) {
    return list.includes(id) ? list.filter((d) => d !== id) : [...list, id];
  }

  const DivisionPicker = ({
    selected,
    onToggle,
    disabled,
  }: {
    selected: string[];
    onToggle: (id: string) => void;
    disabled: boolean;
  }) => (
    <div className="flex flex-wrap gap-1.5">
      {divisions.map((d) => {
        const on = selected.includes(d.id);
        return (
          <button
            key={d.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(d.id)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-40 ${
              on ? "bg-ink text-primary-foreground" : "bg-card text-steel ring-1 ring-ink/10"
            }`}
          >
            {d.name}
          </button>
        );
      })}
      {disabled && (
        <span className="self-center text-[11.5px] text-muted-foreground">
          Administrators always see every division.
        </span>
      )}
    </div>
  );

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-[18px] tracking-wide">Portal users</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Create office logins and choose what each person can see and change.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v);
            setMessage("");
            setDraft(EMPTY_DRAFT);
          }}
          className="rounded-lg bg-ink px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {adding ? "Cancel" : "Add user"}
        </button>
      </div>

      {message && <p className="mt-3 text-[12.5px] text-amber-deep">{message}</p>}

      {adding && (
        <div className="mt-4 space-y-3 rounded-xl bg-card/60 p-4 ring-1 ring-ink/10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11.5px] font-medium text-steel">
              Email
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <label className="text-[11.5px] font-medium text-steel">
              Name
              <input
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <label className="text-[11.5px] font-medium text-steel">
              Temporary password
              <input
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <label className="text-[11.5px] font-medium text-steel">
              Role
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as AppRole })}
                className="mt-1 w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px]"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {ROLES.find((r) => r.value === draft.role)?.hint}
          </p>
          <DivisionPicker
            selected={draft.divisionIds}
            disabled={draft.role === "admin"}
            onToggle={(id) => setDraft({ ...draft, divisionIds: toggleDivision(draft.divisionIds, id) })}
          />
          <button
            type="button"
            disabled={create.isPending || !draft.email || draft.password.length < 8}
            onClick={() => create.mutate()}
            className="rounded-lg bg-amber px-3.5 py-2 text-[12px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:bg-line disabled:text-steel"
          >
            {create.isPending ? "Creating…" : "Create account"}
          </button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-ink/10">
        <table className="w-full text-[13px]">
          <thead className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Divisions</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {users.map((user) =>
              editingId === user.id ? (
                <tr key={user.id} className="bg-amber/15">
                  <td className="px-3 py-2">
                    <input
                      value={edit.displayName}
                      onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                      className="w-full rounded-md border border-line bg-card px-2 py-1 text-[13px]"
                    />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{user.email}</td>
                  <td className="px-3 py-2">
                    <select
                      value={edit.role}
                      onChange={(e) => setEdit({ ...edit, role: e.target.value as AppRole })}
                      className="rounded-md border border-line bg-card px-2 py-1 text-[13px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <DivisionPicker
                      selected={edit.divisionIds}
                      disabled={edit.role === "admin"}
                      onToggle={(id) =>
                        setEdit({ ...edit, divisionIds: toggleDivision(edit.divisionIds, id) })
                      }
                    />
                    <input
                      placeholder="New temporary password (optional)"
                      value={edit.password}
                      onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                      className="mt-2 w-full rounded-md border border-line bg-card px-2 py-1 text-[12px]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={edit.active}
                        onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                      />
                      Active
                    </label>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => save.mutate(user)}
                      className="rounded-md bg-amber px-2.5 py-1 text-[12px] font-semibold text-ink"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="ml-2 rounded-md px-2.5 py-1 text-[12px] text-steel hover:bg-ink/5"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={user.id} className="border-t border-line/70">
                  <td className="px-3 py-2">{user.displayName || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{user.email}</td>
                  <td className="px-3 py-2">
                    {ROLES.find((r) => r.value === user.role)?.label ?? "No access"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {user.role === "admin"
                      ? "All"
                      : user.divisionIds.map((id) => divisionName.get(id) ?? "—").join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">{user.active ? "Active" : "Disabled"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(user)}
                      className="rounded-md px-2.5 py-1 text-[12px] font-medium text-steel hover:bg-ink/5"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
