
ALTER TABLE public.time_entries REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
