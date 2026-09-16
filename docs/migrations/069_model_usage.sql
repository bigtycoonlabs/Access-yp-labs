-- 069: MODEL USAGE. What every model call and image cost, and who it was for.
--
-- Nobody could say what a person costs us to serve, so no price could be more than a guess. A cost is
-- stored in millionths of a dollar so sums are exact. It is NULL when the model has no known price:
-- an unknown cost is not a free one.

CREATE TABLE IF NOT EXISTS yp_labs.model_usage (
  id               bigserial PRIMARY KEY,
  user_id          uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  business_id      uuid REFERENCES yp_labs.businesses(id) ON DELETE SET NULL,
  purpose          text NOT NULL CHECK (purpose ~ '^[a-z0-9-]{1,40}$'),
  kind             text NOT NULL CHECK (kind IN ('text', 'image')),
  model            text NOT NULL,
  input_tokens     integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens    integer NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  output_tokens    integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens integer NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  images           integer NOT NULL DEFAULT 0 CHECK (images >= 0),
  cost_micros      bigint CHECK (cost_micros IS NULL OR cost_micros >= 0),
  prices_checked   date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cached_within_input CHECK (cached_tokens <= input_tokens),
  CONSTRAINT image_rows_count_images CHECK (kind <> 'image' OR (images > 0 AND input_tokens = 0))
);
CREATE INDEX IF NOT EXISTS model_usage_user_idx ON yp_labs.model_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_usage_time_idx ON yp_labs.model_usage(created_at DESC);
