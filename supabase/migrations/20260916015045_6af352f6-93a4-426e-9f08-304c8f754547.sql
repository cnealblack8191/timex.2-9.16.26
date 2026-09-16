-- roles
create type public.app_role as enum ('admin', 'payroll', 'viewer');

create table public.profiles (
  id uuid primary key,
  email text not null,
  display_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.user_divisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  division_id uuid not null references public.divisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, division_id)
);
grant select on public.user_divisions to authenticated;
grant all on public.user_divisions to service_role;
alter table public.user_divisions enable row level security;

create table public.user_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, employee_id)
);
grant select on public.user_employees to authenticated;
grant all on public.user_employees to service_role;
alter table public.user_employees enable row level security;

create trigger update_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- helpers
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.can_view_employee(_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role in ('admin', 'payroll')
    )
    or exists (
      select 1 from public.employees e
      join public.user_divisions ud on ud.division_id = e.division_id
      where e.id = _employee_id and ud.user_id = auth.uid()
    )
$$;

create or replace function public.can_edit_employee(_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (
      public.has_role(auth.uid(), 'payroll')
      and (
        exists (
          select 1 from public.employees e
          join public.user_divisions ud on ud.division_id = e.division_id
          where e.id = _employee_id and ud.user_id = auth.uid()
        )
        or exists (
          select 1 from public.user_employees ue
          where ue.employee_id = _employee_id and ue.user_id = auth.uid()
        )
      )
    )
$$;

-- account tables policies
create policy "own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "admins manage profiles" on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "own roles or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "own divisions or admin" on public.user_divisions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "own employee grants or admin" on public.user_employees for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- rescope the existing open policies: the jobsite kiosk stays open (anon),
-- signed-in office users get role and division scoping.
drop policy if exists divisions_open on public.divisions;
drop policy if exists jobs_open on public.jobs;
drop policy if exists employees_open on public.employees;
drop policy if exists time_entries_open on public.time_entries;

create policy divisions_kiosk on public.divisions for all to anon using (true) with check (true);
create policy jobs_kiosk on public.jobs for all to anon using (true) with check (true);
create policy employees_kiosk on public.employees for all to anon using (true) with check (true);
create policy time_entries_kiosk on public.time_entries for all to anon using (true) with check (true);

create policy divisions_read on public.divisions for select to authenticated using (
  public.is_admin()
  or public.has_role(auth.uid(), 'payroll')
  or exists (select 1 from public.user_divisions ud where ud.user_id = auth.uid() and ud.division_id = divisions.id)
);
create policy divisions_admin on public.divisions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy jobs_read on public.jobs for select to authenticated using (auth.uid() is not null);
create policy jobs_admin on public.jobs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy employees_read on public.employees for select to authenticated
  using (public.can_view_employee(id));
create policy employees_admin on public.employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy time_entries_read on public.time_entries for select to authenticated
  using (public.can_view_employee(employee_id));
create policy time_entries_write on public.time_entries for insert to authenticated
  with check (public.can_edit_employee(employee_id));
create policy time_entries_update on public.time_entries for update to authenticated
  using (public.can_edit_employee(employee_id)) with check (public.can_edit_employee(employee_id));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (public.can_edit_employee(employee_id));