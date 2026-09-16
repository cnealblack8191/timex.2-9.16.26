insert into public.profiles (id, email, display_name, active)
values ('dfce1899-c8bf-48ae-89ac-a7aed8aafb37', 'charles@ecinc.us', 'Charles Black', true)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
values ('dfce1899-c8bf-48ae-89ac-a7aed8aafb37', 'admin')
on conflict (user_id, role) do nothing;