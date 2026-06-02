require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const passport = require("passport");
const { initDB } = require("./db");
const { redis } = require("./redis");

const authRoutes = require("./routes/auth");
const todoRoutes = require("./routes/todos");
const paymentRoutes = require("./routes/payment");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set("trust proxy", 1);

const allowedOrigins = new Set([
  process.env.FRONTEND_URL,

  // Vercel deployments
  "https://todo-dpcx8tp2e-nishkarshhublikars-projects.vercel.app",
  "https://todo-app-ruby-one-63.vercel.app",

  // Local
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:32080",
  "http://127.0.0.1:32080",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://host.docker.internal:8080",
].filter(Boolean));

function isAllowedOrigin(origin) {
  console.log("Incoming Origin:", origin);

  if (!origin) return true;

  if (allowedOrigins.has(origin)) {
    console.log("✅ Allowed via whitelist:", origin);
    return true;
  }

  if (origin.includes(".vercel.app")) {
    console.log("✅ Allowed via Vercel rule:", origin);
    return true;
  }

  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/host\.docker\.internal(:\d+)?$/.test(origin)) return true;

  console.log("❌ BLOCKED ORIGIN:", origin);
  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());
app.use(passport.initialize());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.use("/auth", authRoutes);
app.use("/todos", todoRoutes);
app.use("/payment", paymentRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Boot with retry ──────────────────────────────────────────────────────────
async function withRetry(fn, label, retries = 10, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      console.error(`[${label}] attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function start() {
  try {
    await withRetry(() => initDB(), "PostgreSQL");

    // Connect to Redis but don't fail if it's down (caching will be disabled)
    redis.connect().catch(err => {
      console.warn("⚠️  Redis connection failed. Performance may be degraded as caching is disabled.");
    });

    global._server = app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
  } catch (err) {
    console.error("Fatal: could not connect to database. Exiting.", err.message);
    process.exit(1);
  }
}

start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Kubernetes sends SIGTERM before killing the pod. We stop accepting new
// connections and wait up to 10 s for in-flight requests to finish.
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  if (global._server) {
    global._server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced exit after timeout");
      process.exit(1);
    }, 10_000);
  } else {
    process.exit(0);
  }
});
