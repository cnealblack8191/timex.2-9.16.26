
CREATE TABLE public.divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.divisions TO anon, authenticated;
GRANT ALL ON public.divisions TO service_role;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "divisions_open" ON public.divisions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  location text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO anon, authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_open" ON public.jobs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  division_id uuid REFERENCES public.divisions(id) ON DELETE SET NULL,
  assigned_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO anon, authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_open" ON public.employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  work_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  clock_in timestamptz,
  clock_out timestamptz,
  entry_type text NOT NULL DEFAULT 'work',
  manual_hours numeric(6,2),
  notes text,
  job_overridden boolean NOT NULL DEFAULT false,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO anon, authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time_entries_open" ON public.time_entries FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX time_entries_employee_date_idx ON public.time_entries (employee_id, work_date);
CREATE INDEX time_entries_open_idx ON public.time_entries (employee_id) WHERE clock_out IS NULL;

INSERT INTO public.divisions (name, code) VALUES
  ('Commercial', 'COM'),
  ('Industrial', 'IND'),
  ('Service', 'SVC'),
  ('Low Voltage', 'LV'),
  ('Residential', 'RES'),
  ('Utility', 'UTL');

INSERT INTO public.jobs (number, name, location) VALUES
  ('201', 'Riverside Tower Fit-Out', 'Riverside, Bldg A'),
  ('204', 'Northgate Warehouse Lighting', 'Northgate Industrial Park'),
  ('209', 'Transformer Loop Replacement', 'Cedar Substation'),
  ('212', 'Mercy Hospital Wing C', 'Mercy Medical Campus'),
  ('214', 'Panel Upgrade — Foundry', 'Eastside Foundry'),
  ('217', 'Data Center Rack Power', 'Summit Data Center'),
  ('221', 'Service Entrance Rebuild', 'Harbor Freight Terminal'),
  ('224', 'School District Fire Alarm', 'Lincoln High School'),
  ('228', 'Parking Structure Lighting', 'Civic Center Garage'),
  ('231', 'Retail Buildout — Phase 2', 'Meadow Mall'),
  ('235', 'Wastewater Pump Controls', 'City Treatment Plant'),
  ('238', 'Apartment Complex Rough-In', 'Willow Creek Apartments'),
  ('242', 'Airport Taxiway Lighting', 'Regional Airport');

INSERT INTO public.employees (first_name, last_name, division_id, assigned_job_id)
SELECT n.first_name, n.last_name,
       (SELECT id FROM public.divisions ORDER BY code OFFSET (n.rn % 6) LIMIT 1),
       (SELECT id FROM public.jobs ORDER BY number OFFSET (n.rn % 13) LIMIT 1)
FROM (
  SELECT row_number() OVER () - 1 AS rn, first_name, last_name FROM (VALUES
    ('Marcus','Reyes'),('Lena','Kovac'),('Danny','Okafor'),('Rob','Halloran'),('Priya','Nair'),
    ('Tomas','Delgado'),('Angela','Boone'),('Kyle','Whitfield'),('Devon','Pratt'),('Maria','Santos'),
    ('Eli','Brennan'),('Nate','Guzman'),('Sasha','Petrov'),('Curtis','Vaughn'),('Jamal','Ford'),
    ('Ivan','Marek'),('Beth','Callahan'),('Owen','Ramsey'),('Hector','Alvarez'),('Grace','Lindqvist'),
    ('Trevor','Nash'),('Dana','Whitmore'),('Luis','Ortega'),('Karl','Steiner'),('Monique','Duval'),
    ('Brian','Sheridan'),('Aaron','Kimura'),('Felix','Moreau'),('Sean','Docherty'),('Rosa','Delacruz'),
    ('Chad','Bristow'),('Vince','Carmody'),('Naomi','Blackwell'),('Pete','Larkin'),('Omar','Haddad'),
    ('Jesse','Cantrell'),('Wade','Sorensen'),('Tanya','Beaumont'),('Gil','Hollister'),('Ruben','Estrada'),
    ('Colin','Fitzgerald'),('Ada','Mensah'),('Bryce','Tolliver'),('Ricky','Vasquez'),('Sam','Okonkwo'),
    ('Derek','Winslow'),('Paulo','Andrade'),('Mitch','Garrity'),('Yusuf','Demir'),('Clay','Rutherford')
  ) AS v(first_name, last_name)
) n;

INSERT INTO public.time_entries (employee_id, job_id, work_date, clock_in, clock_out, entry_type)
SELECT e.id, e.assigned_job_id, d::date,
       (d + time '07:00') AT TIME ZONE 'utc',
       (d + time '15:30') AT TIME ZONE 'utc',
       'work'
FROM public.employees e
CROSS JOIN generate_series(
  (date_trunc('week', (now() AT TIME ZONE 'utc')::date))::timestamp,
  (date_trunc('week', (now() AT TIME ZONE 'utc')::date) + interval '4 days')::timestamp,
  interval '1 day'
) AS d
WHERE d::date < (now() AT TIME ZONE 'utc')::date;

INSERT INTO public.time_entries (employee_id, job_id, work_date, clock_in, entry_type)
SELECT e.id, e.assigned_job_id, (now() AT TIME ZONE 'utc')::date,
       now() - interval '2 hours', 'work'
FROM public.employees e
ORDER BY e.last_name
LIMIT 14;

ALTER TABLE public.time_entries REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
