revoke execute on function public.has_role(uuid, public.app_role) from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.can_view_employee(uuid) from anon;
revoke execute on function public.can_edit_employee(uuid) from anon;