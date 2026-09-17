ALTER TABLE public.day_notes
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'work';

ALTER TABLE public.day_notes DROP CONSTRAINT IF EXISTS day_notes_employee_id_work_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS day_notes_employee_date_row_uidx
  ON public.day_notes (employee_id, work_date, entry_type, COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid));