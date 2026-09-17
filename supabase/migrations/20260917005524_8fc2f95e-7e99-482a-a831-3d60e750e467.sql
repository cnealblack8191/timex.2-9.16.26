CREATE TABLE public.day_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.day_notes TO authenticated;
GRANT ALL ON public.day_notes TO service_role;

ALTER TABLE public.day_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY day_notes_read ON public.day_notes FOR SELECT TO authenticated
  USING (public.can_view_employee(employee_id));
CREATE POLICY day_notes_write ON public.day_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_employee(employee_id));
CREATE POLICY day_notes_update ON public.day_notes FOR UPDATE TO authenticated
  USING (public.can_edit_employee(employee_id)) WITH CHECK (public.can_edit_employee(employee_id));
CREATE POLICY day_notes_delete ON public.day_notes FOR DELETE TO authenticated
  USING (public.can_edit_employee(employee_id));