
-- =============================================================
-- Kontrora: Estimates & Revenue Billing Migration
-- Date: 2026-11-19
-- Supports fresh and existing databases
-- =============================================================

BEGIN;

-- =============================================================
-- 1. CREATE ESTIMATES TABLE
-- =============================================================

CREATE TABLE IF NOT EXISTS public.estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE RESTRICT,

  project_id UUID
    REFERENCES public.projects(id) ON DELETE RESTRICT,

  estimate_number TEXT,

  title TEXT NOT NULL,

  description TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),

  currency TEXT NOT NULL DEFAULT 'USD',

  subtotal BIGINT NOT NULL DEFAULT 0
    CHECK (subtotal >= 0),

  total BIGINT NOT NULL DEFAULT 0
    CHECK (total >= 0),

  created_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  idempotency_key TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- 2. UPGRADE EXISTING ESTIMATES TABLE
-- =============================================================

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS estimate_number TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill legacy records.
UPDATE public.estimates
SET
  estimate_number = COALESCE(
    estimate_number,
    'EST-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(id::TEXT, 1, 8))
  ),
  idempotency_key = COALESCE(
    idempotency_key,
    'legacy-' || id::TEXT
  )
WHERE estimate_number IS NULL
   OR idempotency_key IS NULL;

ALTER TABLE public.estimates
  ALTER COLUMN estimate_number SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL;

-- =============================================================
-- 3. CREATE ESTIMATE LINE ITEMS TABLE
-- =============================================================

CREATE TABLE IF NOT EXISTS public.estimate_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  estimate_id UUID NOT NULL
    REFERENCES public.estimates(id) ON DELETE RESTRICT,

  description TEXT NOT NULL,

  quantity NUMERIC(12,3) NOT NULL
    CHECK (quantity > 0),

  unit_price BIGINT NOT NULL
    CHECK (unit_price >= 0),

  line_total BIGINT NOT NULL
    CHECK (line_total >= 0),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- 4. UPGRADE EXISTING LINE ITEMS TABLE
-- =============================================================

ALTER TABLE public.estimate_line_items
  ALTER COLUMN quantity TYPE NUMERIC(12,3)
    USING quantity::NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- =============================================================
-- 5. INDEXES
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS estimates_account_number_uidx
  ON public.estimates(account_id, estimate_number);

CREATE UNIQUE INDEX IF NOT EXISTS estimates_account_idempotency_uidx
  ON public.estimates(account_id, idempotency_key);

CREATE INDEX IF NOT EXISTS estimates_account_created_idx
  ON public.estimates(account_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS estimates_account_status_idx
  ON public.estimates(account_id, status);

CREATE INDEX IF NOT EXISTS estimate_line_items_estimate_order_idx
  ON public.estimate_line_items(estimate_id, sort_order);

-- =============================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 7. CREATE ESTIMATE FUNCTION
-- =============================================================

CREATE OR REPLACE FUNCTION public.create_account_estimate(
  p_account_id UUID,
  p_project_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_currency TEXT,
  p_created_by UUID,
  p_idempotency_key TEXT,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$

DECLARE
  v_estimate_id UUID;
  v_estimate_number TEXT;
  v_subtotal BIGINT := 0;
  v_item JSONB;
  v_quantity NUMERIC(12,3);
  v_unit_price BIGINT;
  v_line_total BIGINT;
  v_description TEXT;
  v_result JSONB;
  v_sort_order INTEGER := 0;

BEGIN

  -- Validate title.
  IF p_title IS NULL OR LENGTH(TRIM(p_title)) = 0 THEN
    RAISE EXCEPTION 'Estimate title is required';
  END IF;

  -- Validate idempotency key.
  IF p_idempotency_key IS NULL
     OR LENGTH(TRIM(p_idempotency_key)) = 0
     OR LENGTH(p_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'Invalid idempotency key';
  END IF;

  -- Validate currency.
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid currency';
  END IF;

  -- Validate line items.
  IF p_line_items IS NULL
     OR jsonb_typeof(p_line_items) <> 'array'
     OR jsonb_array_length(p_line_items) = 0
     OR jsonb_array_length(p_line_items) > 100 THEN
    RAISE EXCEPTION 'Between 1 and 100 line items are required';
  END IF;

  -- Verify optional project belongs to this account.
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = p_project_id
      AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this account';
  END IF;

  -- Return existing estimate for an idempotent retry.
  SELECT id
  INTO v_estimate_id
  FROM public.estimates
  WHERE account_id = p_account_id
    AND idempotency_key = p_idempotency_key;

  IF v_estimate_id IS NOT NULL THEN

    SELECT jsonb_build_object(
      'estimate', to_jsonb(e),
      'line_items', COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(li) ORDER BY li.sort_order)
          FROM public.estimate_line_items li
          WHERE li.estimate_id = e.id
        ),
        '[]'::jsonb
      ),
      'replayed', true
    )
    INTO v_result
    FROM public.estimates e
    WHERE e.id = v_estimate_id;

    RETURN v_result;
  END IF;

  -- Generate estimate ID and number.
  v_estimate_id := gen_random_uuid();

  v_estimate_number :=
    'EST-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(v_estimate_id::TEXT, 1, 8));

  -- Insert draft estimate.
  INSERT INTO public.estimates (
    id,
    account_id,
    project_id,
    estimate_number,
    title,
    description,
    status,
    currency,
    subtotal,
    total,
    created_by,
    idempotency_key
  )
  VALUES (
    v_estimate_id,
    p_account_id,
    p_project_id,
    v_estimate_number,
    TRIM(p_title),
    p_description,
    'draft',
    p_currency,
    0,
    0,
    p_created_by,
    p_idempotency_key
  );

  -- Insert line items and calculate totals.
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_line_items)
  LOOP

    v_description := TRIM(v_item->>'description');
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::BIGINT;

    IF v_description IS NULL
       OR v_description = ''
       OR LENGTH(v_description) > 500 THEN
      RAISE EXCEPTION 'Invalid line item description';
    END IF;

    IF v_quantity IS NULL
       OR v_quantity <= 0
       OR v_quantity > 1000000 THEN
      RAISE EXCEPTION 'Invalid line item quantity';
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit price';
    END IF;

    v_line_total := ROUND(v_quantity * v_unit_price);

    IF v_line_total > 9000000000000000000 - v_subtotal THEN
      RAISE EXCEPTION 'Estimate amount exceeds allowed limit';
    END IF;

    INSERT INTO public.estimate_line_items (
      estimate_id,
      description,
      quantity,
      unit_price,
      line_total,
      sort_order
    )
    VALUES (
      v_estimate_id,
      v_description,
      v_quantity,
      v_unit_price,
      v_line_total,
      v_sort_order
    );

    v_subtotal := v_subtotal + v_line_total;
    v_sort_order := v_sort_order + 1;

  END LOOP;

  -- Update estimate totals.
  UPDATE public.estimates
  SET
    subtotal = v_subtotal,
    total = v_subtotal,
    updated_at = NOW()
  WHERE id = v_estimate_id;

  -- Return created estimate and line items.
  SELECT jsonb_build_object(
    'estimate', to_jsonb(e),
    'line_items', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(li) ORDER BY li.sort_order)
        FROM public.estimate_line_items li
        WHERE li.estimate_id = e.id
      ),
      '[]'::jsonb
    ),
    'replayed', false
  )
  INTO v_result
  FROM public.estimates e
  WHERE e.id = v_estimate_id;

  RETURN v_result;

END;

$function$;

-- =============================================================
-- 8. FUNCTION PERMISSIONS
-- =============================================================

REVOKE ALL ON FUNCTION public.create_account_estimate(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_account_estimate(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB
) TO service_role;

-- =============================================================
-- 9. ESTIMATE ROLE PERMISSIONS
-- =============================================================

COMMIT;
