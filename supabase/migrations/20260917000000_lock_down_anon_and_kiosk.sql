-- Hardening pass, 2026-09-16.
--
-- 1. The browser no longer reads or writes timekeeping tables anonymously.
--    The web kiosk and the supervisor Adjustments screen now go through
--    server functions that use the service role, exactly like the mobile API.
--    Signed-in office users keep their role- and division-scoped policies.
drop policy if exists divisions_kiosk on public.divisions;
drop policy if exists jobs_kiosk on public.jobs;
drop policy if exists employees_kiosk on public.employees;
drop policy if exists time_entries_kiosk on public.time_entries;

revoke all on public.divisions from anon;
revoke all on public.jobs from anon;
revoke all on public.employees from anon;
revoke all on public.time_entries from anon;

-- 2. Company timezone. Work dates for every punch are computed in this zone on
--    the server, so the web kiosk, the mobile app and manual adjustments agree.
insert into public.app_settings (key, value)
values ('timezone', 'America/New_York')
on conflict (key) do nothing;

-- 3. One open punch per employee, enforced by the database.
--    Any duplicates that already exist are closed at their own clock-in time
--    (0 hours) with a note, keeping the most recent one open.
with ranked as (
  select id,
         row_number() over (
           partition by employee_id
           order by clock_in desc nulls last, created_at desc
         ) as rn
  from public.time_entries
  where entry_type = 'work' and clock_out is null
)
update public.time_entries t
set clock_out = coalesce(t.clock_in, t.created_at),
    edited = true,
    notes = concat_ws(E'\n', t.notes,
      'Auto-closed: duplicate open punch found while enforcing one open punch per employee')
from ranked r
where r.id = t.id and r.rn > 1;

create unique index if not exists time_entries_one_open_per_employee
  on public.time_entries (employee_id)
  where clock_out is null and entry_type = 'work';

-- 4. Failure counters for the supervisor code, so a 4-digit code cannot be
--    brute-forced. Service role only; never exposed to the browser.
create table if not exists public.auth_throttle (
  key text primary key,
  failures integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
grant all on public.auth_throttle to service_role;
alter table public.auth_throttle enable row level security;
drop policy if exists "service role only" on public.auth_throttle;
create policy "service role only" on public.auth_throttle
  for all to service_role using (true) with check (true);
