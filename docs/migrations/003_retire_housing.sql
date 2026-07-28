-- 003: Retire the old housing-agency model from yp_labs (all tables were empty).
-- Touches only yp_labs. Does not affect yp_flow_arbo (YP Flow) or public (Access Your Place).
DROP TABLE IF EXISTS yp_labs.platform_performance CASCADE;
DROP TABLE IF EXISTS yp_labs.appointments CASCADE;
DROP TABLE IF EXISTS yp_labs.client_requests CASCADE;
DROP TABLE IF EXISTS yp_labs.messages CASCADE;
DROP TABLE IF EXISTS yp_labs.project_files CASCADE;
DROP TABLE IF EXISTS yp_labs.milestones CASCADE;
DROP TABLE IF EXISTS yp_labs.order_line_items CASCADE;
DROP TABLE IF EXISTS yp_labs.contracts CASCADE;
DROP TABLE IF EXISTS yp_labs.payment_plans CASCADE;
DROP TABLE IF EXISTS yp_labs.projects CASCADE;
DROP TABLE IF EXISTS yp_labs.wizard_submissions CASCADE;
