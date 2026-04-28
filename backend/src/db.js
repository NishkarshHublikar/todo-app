const { createClient } = require("@supabase/supabase-js");

const supabaseUrl  = process.env.SUPABASE_URL;
const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role — never expose to frontend

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// initDB: create tables via Supabase SQL if they don't exist.
// Supabase (Postgres) supports IF NOT EXISTS — safe to run on every boot.
async function initDB() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id          BIGSERIAL PRIMARY KEY,
      email       TEXT UNIQUE,
      password    TEXT,
      provider    TEXT DEFAULT 'local',
      github_id   TEXT UNIQUE,
      is_premium  BOOLEAN DEFAULT FALSE,
      mfa_enabled BOOLEAN DEFAULT TRUE,
      mfa_code    TEXT,
      mfa_expires TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ensure MFA columns exist if table was already created
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mfa_enabled') THEN
        ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT TRUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mfa_code') THEN
        ALTER TABLE users ADD COLUMN mfa_code TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mfa_expires') THEN
        ALTER TABLE users ADD COLUMN mfa_expires TIMESTAMPTZ;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS todos (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task        TEXT NOT NULL,
      completed   BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_todos_user_id    ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC);

    CREATE TABLE IF NOT EXISTS payments (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      razorpay_order_id   TEXT UNIQUE NOT NULL,
      razorpay_payment_id TEXT,
      amount              INTEGER NOT NULL,
      currency            TEXT DEFAULT 'INR',
      status              TEXT DEFAULT 'created',
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
  `;

  let error;
  try {
    const response = await supabase.rpc("exec_sql", { sql });
    error = response.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    console.warn("⚠️  Could not auto-migrate via RPC. This is common if the 'exec_sql' function is not set up in Supabase.");
    console.warn("👉 PLEASE RUN THE SQL FROM implementation_plan.md MANUALLY IN THE SUPABASE SQL EDITOR.");
  } else {
    console.log("✅ Database schema verified/created");
  }
  console.log("✅ Supabase connected");
}

module.exports = { supabase, initDB };
