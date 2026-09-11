ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS clock_in_photo text,
  ADD COLUMN IF NOT EXISTS clock_out_photo text;

CREATE INDEX IF NOT EXISTS time_entries_client_punch_id_idx ON public.time_entries (client_punch_id);