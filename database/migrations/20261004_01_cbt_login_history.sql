-- Tabel riwayat login untuk mencatat setiap aktivitas login
CREATE TABLE IF NOT EXISTS public.cbt_login_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    login_method VARCHAR(20) NOT NULL DEFAULT 'password',  -- 'password' atau 'sso'
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_type VARCHAR(20),    -- 'desktop', 'mobile', 'tablet'
    browser VARCHAR(50),
    os VARCHAR(50),
    success BOOLEAN NOT NULL DEFAULT true,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON public.cbt_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON public.cbt_login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user_created ON public.cbt_login_history(user_id, created_at DESC);
