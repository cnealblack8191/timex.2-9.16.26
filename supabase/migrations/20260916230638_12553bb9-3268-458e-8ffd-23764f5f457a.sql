ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS clock_in_photo text,
  ADD COLUMN IF NOT EXISTS clock_out_photo text;