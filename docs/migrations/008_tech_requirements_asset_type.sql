-- 008: tech_requirements asset type — Clay plans the API keys, services, and
-- build flow a concept needs (everything except writing the code).
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'tech_requirements';
