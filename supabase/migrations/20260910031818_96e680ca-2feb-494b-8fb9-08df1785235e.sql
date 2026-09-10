ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS client_punch_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_client_punch_id_key
  ON public.time_entries (client_punch_id)
  WHERE client_punch_id IS NOT NULL;