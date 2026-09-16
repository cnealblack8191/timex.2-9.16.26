import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "payroll" | "viewer";

export type MyAccess = {
  userId: string;
  email: string;
  displayName: string;
  active: boolean;
  role: AppRole | null;
  divisionIds: string[];
  employeeIds: string[];
};

export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  role: AppRole | null;
  divisionIds: string[];
  employeeIds: string[];
};

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: administrators only");
}

/** Everything the signed-in person is allowed to see and change. */
export const getMyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyAccess> => {
    const { supabase, userId, claims } = context;

    const [profileRes, rolesRes, divisionsRes, employeesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_divisions").select("division_id").eq("user_id", userId),
      supabase.from("user_employees").select("employee_id").eq("user_id", userId),
    ]);

    const roles = (rolesRes.data ?? []).map((r: { role: AppRole }) => r.role);
    const role: AppRole | null = roles.includes("admin")
      ? "admin"
      : roles.includes("payroll")
        ? "payroll"
        : roles.includes("viewer")
          ? "viewer"
          : null;

    return {
      userId,
      email: (profileRes.data?.email as string | undefined) ?? String(claims['email'] ?? ""),
      displayName: (profileRes.data?.display_name as string | undefined) ?? "",
      active: profileRes.data ? Boolean(profileRes.data.active) : false,
      role,
      divisionIds: (divisionsRes.data ?? []).map((d: { division_id: string }) => d.division_id),
      employeeIds: (employeesRes.data ?? []).map((e: { employee_id: string }) => e.employee_id),
    };
  });

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [profiles, roles, divisions, employees] = await Promise.all([
      supabase.from("profiles").select("*").order("email"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("user_divisions").select("user_id, division_id"),
      supabase.from("user_employees").select("user_id, employee_id"),
    ]);

    return (profiles.data ?? []).map((p: any) => {
      const userRoles = (roles.data ?? [])
        .filter((r: any) => r.user_id === p.id)
        .map((r: any) => r.role as AppRole);
      return {
        id: p.id,
        email: p.email,
        displayName: p.display_name ?? "",
        active: Boolean(p.active),
        role: userRoles.includes("admin")
          ? "admin"
          : userRoles.includes("payroll")
            ? "payroll"
            : userRoles.includes("viewer")
              ? "viewer"
              : null,
        divisionIds: (divisions.data ?? [])
          .filter((d: any) => d.user_id === p.id)
          .map((d: any) => d.division_id),
        employeeIds: (employees.data ?? [])
          .filter((e: any) => e.user_id === p.id)
          .map((e: any) => e.employee_id),
      };
    });
  });

type UpsertInput = {
  email: string;
  password?: string;
  displayName: string;
  role: AppRole;
  divisionIds: string[];
  employeeIds: string[];
};

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UpsertInput) => {
    if (!data.email?.includes("@")) throw new Error("A valid email address is required");
    if (!data.password || data.password.length < 8)
      throw new Error("The temporary password must be at least 8 characters");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password!,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create the account");

    const newId = created.user.id;
    await supabaseAdmin.from("profiles").insert({
      id: newId,
      email: data.email.trim().toLowerCase(),
      display_name: data.displayName,
      active: true,
    });
    await supabaseAdmin.from("user_roles").insert({ user_id: newId, role: data.role });
    if (data.divisionIds.length)
      await supabaseAdmin
        .from("user_divisions")
        .insert(data.divisionIds.map((division_id) => ({ user_id: newId, division_id })));
    if (data.employeeIds.length)
      await supabaseAdmin
        .from("user_employees")
        .insert(data.employeeIds.map((employee_id) => ({ user_id: newId, employee_id })));

    return { id: newId };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id: string;
      displayName: string;
      role: AppRole;
      divisionIds: string[];
      employeeIds: string[];
      active: boolean;
      password?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.id === userId && (data.role !== "admin" || !data.active))
      throw new Error("You cannot remove your own administrator access");

    await supabaseAdmin
      .from("profiles")
      .update({ display_name: data.displayName, active: data.active })
      .eq("id", data.id);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.id, role: data.role });

    await supabaseAdmin.from("user_divisions").delete().eq("user_id", data.id);
    if (data.divisionIds.length)
      await supabaseAdmin
        .from("user_divisions")
        .insert(data.divisionIds.map((division_id) => ({ user_id: data.id, division_id })));

    await supabaseAdmin.from("user_employees").delete().eq("user_id", data.id);
    if (data.employeeIds.length)
      await supabaseAdmin
        .from("user_employees")
        .insert(data.employeeIds.map((employee_id) => ({ user_id: data.id, employee_id })));

    if (data.password) {
      if (data.password.length < 8)
        throw new Error("The temporary password must be at least 8 characters");
      await supabaseAdmin.auth.admin.updateUserById(data.id, { password: data.password });
    }

    // A deactivated account must not be able to sign in again.
    await supabaseAdmin.auth.admin.updateUserById(data.id, {
      ban_duration: data.active ? "none" : "876000h",
    });

    return { ok: true };
  });
