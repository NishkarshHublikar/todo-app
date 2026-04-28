require('dotenv').config();
const { Client } = require('pg');

// Extract project ref from SUPABASE_URL
// Format: https://[ref].supabase.co
const projectRef = process.env.SUPABASE_URL?.split('//')[1]?.split('.')[0];
const dbPassword = process.argv[2];

if (!projectRef) {
  console.error("❌ SUPABASE_URL is missing or invalid in .env");
  process.exit(1);
}

if (!dbPassword) {
  console.error("❌ No password provided.");
  console.log("\nUsage: node init-db.js <YOUR_DATABASE_PASSWORD>");
  process.exit(1);
}

const client = new Client({
  // Fallback to direct IPv6 address if DNS fails
  host: process.env.DB_HOST_OVERRIDE || `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: dbPassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

// If lookup failed, we'll try the known IPv6 for this project ref
const IPV6_FALLBACK = '2406:da1a:6b0:f60a:13d1:5f17:40c6:c184';

const sql = `
  -- 1. Create Users Table
  CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT UNIQUE,
    password    TEXT,
    provider    TEXT DEFAULT 'local',
    github_id   TEXT UNIQUE,
    is_premium  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- 2. Create Todos Table
  CREATE TABLE IF NOT EXISTS todos (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task        TEXT NOT NULL,
    completed   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
  );

  -- 3. Create Payments Table
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

  -- 4. Create exec_sql helper for future migrations
  -- This allows supabase.rpc('exec_sql', { sql }) to work.
  CREATE OR REPLACE FUNCTION exec_sql(sql text)
  RETURNS void AS $$
  BEGIN
    EXECUTE sql;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  -- 5. Add some basic indexes
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
`;

async function run() {
  let activeClient = client;
  try {
    console.log(`📡 Connecting to ${activeClient.host}...`);
    try {
      await activeClient.connect();
    } catch (err) {
      if (err.message.includes('ENOTFOUND') || err.message.includes('EAI_AGAIN')) {
        console.log(`⚠️  DNS failed. Retrying with direct IPv6: [${IPV6_FALLBACK}]...`);
        // We must create a NEW client to retry
        activeClient = new Client({
          host: IPV6_FALLBACK,
          port: 5432,
          user: 'postgres',
          password: dbPassword,
          database: 'postgres',
          ssl: { rejectUnauthorized: false },
        });
        await activeClient.connect();
      } else {
        throw err;
      }
    }
    console.log("✅ Connected!");
    
    console.log("🚀 Executing initialization SQL...");
    await activeClient.query(sql);
    
    console.log("\n✨ DATABASE INITIALIZED SUCCESSFULLY!");
    console.log("-----------------------------------------");
    console.log("✅ Table: public.users created");
    console.log("✅ Table: public.todos created");
    console.log("✅ Table: public.payments created");
    console.log("✅ Function: exec_sql created (Auto-migrations now enabled)");
    console.log("-----------------------------------------");
    
  } catch (err) {
    console.error("\n❌ DATABASE ERROR:", err.message);
    console.log("\n-----------------------------------------");
    console.log("🛠️  TROUBLESHOOTING STEPS:");
    console.log("1. QUOTES: Your password contains a '#'. You MUST wrap it in double quotes.");
    console.log("   Example: node init-db.js \"YourPass#\"");
    console.log("2. CONNECTION: If 'ENOTFOUND' persists, check if your firewall/VPN is blocking Port 5432.");
    console.log("3. REGION: In your Supabase Dashboard -> Settings -> Database, check your 'Host' link.");
    console.log("-----------------------------------------");
  } finally {
    await client.end();
  }
}

run();
