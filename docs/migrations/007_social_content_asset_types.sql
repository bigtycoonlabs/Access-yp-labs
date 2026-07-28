-- 007: social content asset types for Clay (posts, photos-as-prompts, videos-as-
-- scripts, templates, calendar). Applied to yp_labs.asset_type via apply_migration.
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'social_post';
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'social_template';
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'video_script';
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'image_prompt';
ALTER TYPE yp_labs.asset_type ADD VALUE IF NOT EXISTS 'content_calendar';
