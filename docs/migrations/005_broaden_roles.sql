-- 005: Broaden user roles for the marketplace; default new members to 'member'.
ALTER TABLE yp_labs.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE yp_labs.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('member','consultant','client','staff','admin','master_staff'));
ALTER TABLE yp_labs.users ALTER COLUMN role SET DEFAULT 'member';
