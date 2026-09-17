-- Payroll integrity pass, 2026-09-16.
--
--  * Every change to a time entry is recorded in time_entry_revisions.
--  * Time entries are voided, never deleted. Only an administrator can restore one.
--  * A payroll week can be closed by payroll or an administrator; only an
--    administrator can reopen it. Office edits inside a closed week are blocked
--    for everyone except administrators. A kiosk punch that arrives for a closed
--    week is still recorded, flagged after_close.
-- Every statement is guarded so the file can be re-run.

-- ---------------------------------------------------------------------------
-- time_entries: void and late-punch columns
-- ---------------------------------------------------------------------------
alter table public.time_entries
  add column if not exists voided boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text,
  add column if not exists after_close boolean not null default false;

-- A voided open punch must not block a new one.
drop index if exists public.time_entries_one_open_per_employee;
create unique index time_entries_one_open_per_employee
  on public.time_entries (employee_id)
  where clock_out is null and entry_type = 'work' and voided = false;

create index if not exists time_entries_after_close_idx
  on public.time_entries (work_date) where after_close;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.actor_name()
returns text language sql stable security definer set search_path = public as $$
  select display_name from public.profiles where id = auth.uid()
$$;
revoke all on function public.actor_name() from public, anon;
grant execute on function public.actor_name() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pay_periods: one row per closed (or reopened) payroll week, keyed by its Sunday
-- ---------------------------------------------------------------------------
create table if not exists public.pay_periods (
  week_start date primary key,
  status text not null default 'closed' check (status in ('open', 'closed')),
  closed_at timestamptz not null default now(),
  closed_by uuid,
  closed_by_name text,
  reopened_at timestamptz,
  reopened_by uuid,
  reopened_by_name text,
  updated_at timestamptz not null default now(),
  constraint pay_periods_week_start_is_sunday check (extract(dow from week_start) = 0)
);
grant select, insert, update on public.pay_periods to authenticated;
grant all on public.pay_periods to service_role;
alter table public.pay_periods enable row level security;

create or replace function public.is_week_closed(_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pay_periods
    where week_start = _date - extract(dow from _date)::int and status = 'closed'
  )
$$;
revoke all on function public.is_week_closed(date) from public, anon;
grant execute on function public.is_week_closed(date) to authenticated, service_role;

drop policy if exists pay_periods_read on public.pay_periods;
create policy pay_periods_read on public.pay_periods
  for select to authenticated using (true);

drop policy if exists pay_periods_close on public.pay_periods;
create policy pay_periods_close on public.pay_periods
  for insert to authenticated
  with check (public.is_admin() or public.has_role(auth.uid(), 'payroll'));

drop policy if exists pay_periods_update on public.pay_periods;
create policy pay_periods_update on public.pay_periods
  for update to authenticated
  using (public.is_admin() or public.has_role(auth.uid(), 'payroll'))
  with check (public.is_admin() or public.has_role(auth.uid(), 'payroll'));

create or replace function public.pay_periods_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.closed_at := now();
    new.closed_by := coalesce(new.closed_by, auth.uid());
    new.closed_by_name := coalesce(new.closed_by_name, public.actor_name());
  else
    if old.status = 'closed' and new.status = 'open' then
      if auth.uid() is not null and not public.is_admin() then
        raise exception 'Only an administrator can reopen a closed week';
      end if;
      new.reopened_at := now();
      new.reopened_by := auth.uid();
      new.reopened_by_name := public.actor_name();
    elsif old.status = 'open' and new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := auth.uid();
      new.closed_by_name := public.actor_name();
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists pay_periods_guard on public.pay_periods;
create trigger pay_periods_guard
  before insert or update on public.pay_periods
  for each row execute function public.pay_periods_guard();

alter table public.pay_periods replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pay_periods'
  ) then
    alter publication supabase_realtime add table public.pay_periods;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- time_entries policies: no deletes; closed weeks are read-only except for admins
-- ---------------------------------------------------------------------------
drop policy if exists time_entries_delete on public.time_entries;
revoke delete on public.time_entries from authenticated;

drop policy if exists time_entries_write on public.time_entries;
create policy time_entries_write on public.time_entries
  for insert to authenticated
  with check (
    public.can_edit_employee(employee_id)
    and (public.is_admin() or not public.is_week_closed(work_date))
  );

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    public.can_edit_employee(employee_id)
    and (public.is_admin() or not public.is_week_closed(work_date))
  )
  with check (
    public.can_edit_employee(employee_id)
    and (public.is_admin() or not public.is_week_closed(work_date))
  );

-- ---------------------------------------------------------------------------
-- guard trigger: void rules and the late-punch flag
-- ---------------------------------------------------------------------------
create or replace function public.time_entries_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();  -- null when the service role (kiosk, mobile API, cron) writes
begin
  if tg_op = 'UPDATE' then
    if old.voided and not new.voided then
      if v_uid is not null and not public.is_admin() then
        raise exception 'Only an administrator can restore a voided entry';
      end if;
      new.voided_at := null;
      new.voided_by := null;
      new.void_reason := null;
    elsif old.voided and new.voided and v_uid is not null then
      raise exception 'A voided entry cannot be changed';
    elsif not old.voided and new.voided then
      new.voided_at := now();
      new.voided_by := coalesce(new.voided_by, v_uid);
    end if;
  end if;

  -- A punch or clock-out that lands in a week the office already closed is
  -- recorded (never lost) but flagged so payroll can decide about a correction.
  if v_uid is null and public.is_week_closed(new.work_date) then
    if tg_op = 'INSERT'
       or old.clock_in is distinct from new.clock_in
       or old.clock_out is distinct from new.clock_out then
      new.after_close := true;
    end if;
  end if;

  return new;
end
$$;
drop trigger if exists time_entries_guard on public.time_entries;
create trigger time_entries_guard
  before insert or update on public.time_entries
  for each row execute function public.time_entries_guard();

-- ---------------------------------------------------------------------------
-- revisions: who changed what, when, from where
-- ---------------------------------------------------------------------------
create table if not exists public.time_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  employee_id uuid not null,
  action text not null check (action in ('insert', 'update', 'void', 'unvoid', 'delete')),
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text,
  changed_via text not null,
  old_row jsonb,
  new_row jsonb
);
create index if not exists time_entry_revisions_entry_idx
  on public.time_entry_revisions (entry_id, changed_at desc);
create index if not exists time_entry_revisions_employee_idx
  on public.time_entry_revisions (employee_id, changed_at desc);
grant select on public.time_entry_revisions to authenticated;
grant all on public.time_entry_revisions to service_role;
alter table public.time_entry_revisions enable row level security;

drop policy if exists revisions_read on public.time_entry_revisions;
create policy revisions_read on public.time_entry_revisions
  for select to authenticated using (public.can_edit_employee(employee_id));

create or replace function public.time_entries_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_action text;
  v_via text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_via := coalesce(new.source, 'unknown');
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_via := case when v_uid is not null then 'portal' else 'server' end;
    v_old := to_jsonb(old);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- photo housekeeping is not a change anyone needs to see
    if (v_old - 'clock_in_photo' - 'clock_out_photo') = (v_new - 'clock_in_photo' - 'clock_out_photo') then
      return null;
    end if;
    v_action := case
      when not old.voided and new.voided then 'void'
      when old.voided and not new.voided then 'unvoid'
      else 'update'
    end;
    v_via := case when v_uid is not null then 'portal' else 'server' end;
  end if;

  insert into public.time_entry_revisions
    (entry_id, employee_id, action, changed_by, changed_by_name, changed_via, old_row, new_row)
  values (
    coalesce(new.id, old.id),
    coalesce(new.employee_id, old.employee_id),
    v_action,
    v_uid,
    case when v_uid is not null then public.actor_name() end,
    v_via,
    v_old,
    v_new
  );
  return null;
end
$$;
drop trigger if exists time_entries_audit on public.time_entries;
create trigger time_entries_audit
  after insert or update or delete on public.time_entries
  for each row execute function public.time_entries_audit();
