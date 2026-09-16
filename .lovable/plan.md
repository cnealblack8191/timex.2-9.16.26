# Office logins with roles and division permissions

Add a sign-in requirement to the office side of TimeX and control what each person can see and change. The jobsite kiosk stays exactly as it is today — open, no login, supervisor code for adjustments.

## Roles

- **Admin** — full access to everything, including creating users and assigning roles and divisions.
- **Payroll** — sees all divisions, runs reviews and exports, and can edit time only for the divisions or specific employees an admin grants them.
- **View only** — can look at time, reports and payroll for the divisions assigned to them, and cannot change anything.

## What each person sees

Anyone who is not an admin only sees their assigned divisions. Employees outside those divisions are hidden from Operations, Time Entries, PTO & Holiday, Reports, Payroll and the Admin lists. Payroll users are the exception on viewing: they see every division, but the Save/Edit/Delete controls only turn on for the people they are allowed to change.

## Accounts

Admins create accounts from a new **Users** tab in Admin: email, temporary password, role, and the divisions (plus optional individual employees for payroll editors). The person signs in with that password and can change it from an account menu. Admins can change a person's role or divisions later, or deactivate the account.

## Screens

- New **Sign in** page. Anyone not signed in who opens an office page lands here.
- Header gains the signed-in person's name with a sign-out option.
- Admin → **Users** tab: list of accounts, add account, edit role/divisions, deactivate.
- Buttons a person isn't allowed to use are hidden rather than shown broken.

## Technical notes

- Email/password auth on Lovable Cloud (no self sign-up; admin-created accounts with a temp password, auto-confirm on so the temp password works immediately).
- New tables: `app_role` enum (`admin`, `payroll`, `viewer`), `user_roles` (user_id, role) — roles never stored on a profile table — plus `user_divisions` (user_id, division_id) and `user_employees` (user_id, employee_id) for payroll edit grants, and a `profiles` table for display name and active flag. Security-definer `has_role()` and `can_edit_employee()` helpers to keep policies non-recursive.
- All office pages move under the `_authenticated` layout; `/kiosk`, `/adjustments` and `/api/public/kiosk/*` stay public and unchanged.
- The current wide-open policies on `employees`, `divisions`, `jobs` and `time_entries` are replaced with role-aware policies: kiosk access keeps working through the existing device-key server routes (service role), while browser reads/writes are scoped to the signed-in user's divisions. Punch photos get matching storage policies.
- User creation runs through an admin-only server function using the privileged auth API, guarded by a server-side admin role check.

## Sequence

1. Auth tables, roles, helper functions, policies.
2. Sign-in page, auth gate, header account menu.
3. Admin → Users tab (create, edit, deactivate).
4. Division scoping and edit-permission gating across Operations, Time Entries, PTO, Reports, Payroll, Admin.
5. Verify each role end to end in the preview.
