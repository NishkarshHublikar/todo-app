const router = require("express").Router();
const bcrypt = require("bcryptjs");
const passport = require("passport");
const GitHubStrategy = require("passport-github2").Strategy;
const { supabase } = require("../db");
const { signToken } = require("../auth/jwt");
const { requireAuth, requireMfaPending } = require("../auth/middleware");
const { redis, cacheGet, cacheSet, cacheDel, withCache } = require("../redis");
const { sendEmail } = require("../utils/email");
const MFA_TTL_SECONDS = 10 * 60;

// ─── GitHub OAuth Strategy ────────────────────────────────────────────────────
passport.use(
  new GitHubStrategy(
    {
      clientID:     process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL:  process.env.GITHUB_CALLBACK_URL || "http://localhost:3001/auth/github/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // GitHub might not return emails if set to private - handle gracefully
        const email = profile.emails?.[0]?.value || 
                     (profile.username ? `${profile.username}@github.local` : null);
        
        if (!email) return done(new Error("GitHub profile missing email and username"));

        // Check if user exists by github_id
        let { data: user, error: fetchError } = await supabase
          .from("users")
          .select("*")
          .eq("github_id", profile.id)
          .single();

        if (fetchError && fetchError.code !== "PGRST116") { // PGRST116 is 'no rows returned'
          console.error("Supabase fetch error for OAuth:", fetchError);
          return done(fetchError);
        }

        if (!user) {
          // Try to find by email
          let { data: byEmail } = await supabase
            .from("users")
            .select("*")
            .eq("email", email)
            .single();

          if (byEmail) {
            const { error: updateError } = await supabase
              .from("users")
              .update({ github_id: profile.id, provider: "github" })
              .eq("id", byEmail.id);
            
            if (updateError) console.error("Update github_id error:", updateError);
            user = { ...byEmail, github_id: profile.id };
          } else {
            const { data: newUser, error: insertError } = await supabase
              .from("users")
              .insert({ email, provider: "github", github_id: profile.id })
              .select()
              .single();

            if (insertError) {
              console.error("Supabase Insert Error (OAuth):", insertError);
              return done(insertError);
            }
            user = newUser;
          }
        }
        return done(null, user);
      } catch (err) {
        console.error("OAUTH_CATCH_ERROR:", err);
        return done(err);
      }
    }
  )
);

// ─── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const hashed = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase
      .from("users")
      .insert({ email: email.toLowerCase(), password: hashed, provider: "local", mfa_enabled: true })
      .select("id, email, is_premium, mfa_enabled")
      .single();

    if (error) {
      console.error("SUPABASE_REGISTER_ERROR:", error);
      if (error.code === "23505") return res.status(409).json({ error: "Email already registered" });
      // If table doesn't exist, code is usually '42P01' in Postgres
      if (error.code === "42P01") return res.status(500).json({ error: "Database tables not initialized. Run the SQL in README." });
      return res.status(500).json({ error: error.message || "Database error during registration" });
    }

    if (!user) {
      return res.status(500).json({ error: "User creation failed - no data returned" });
    }

    // Generate MFA challenge for the new user
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challenge = {
      code,
      expiresAt: Date.now() + MFA_TTL_SECONDS * 1000,
    };

    if (redis.status === "ready") {
      await redis.setex(`mfa:${user.id}`, MFA_TTL_SECONDS, JSON.stringify(challenge));
    } else {
      const expires = new Date(challenge.expiresAt).toISOString();
      await supabase
        .from("users")
        .update({ mfa_code: code, mfa_expires: expires })
        .eq("id", user.id);
    }

    // Send the MFA code via email (asynchronous to avoid blocking)
    sendEmail({
      to: user.email,
      subject: "Verify your new TodoApp Account",
      text: `Welcome! Your verification code is: ${code}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #6366f1;">Welcome to TodoApp!</h2>
          <p style="font-size: 16px; color: #475569;">Please verify your account using the code below:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 12px; background: #f8fafc; text-align: center; border-radius: 4px; color: #1e293b;">
            ${code}
          </div>
        </div>
      `,
    }).catch(mailErr => console.error("Failed to send welcome MFA email:", mailErr.message));

    console.log(`🔐 MFA registration code for ${user.email}: ${code}`);

    const tempToken = signToken(
      { id: user.id, email: user.email, is_premium: user.is_premium, mfa_pending: true },
      "10m"
    );

    res.status(201).json({ 
      mfa_required: true, 
      tempToken, 
      message: "Registration successful. Please enter the verification code sent to your email." 
    });
  } catch (err) {
    console.error("REGISTER_CATCH_ERROR:", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .single();

    if (!user) {
      console.log("Login failed: User not found for email:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.password) {
      console.log("Login failed: User has no password (maybe OAuth only?):", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log("Login failed: Password mismatch for email:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.mfa_enabled) {
      const { error: enableErr } = await supabase
        .from("users")
        .update({ mfa_enabled: true })
        .eq("id", user.id);
      if (enableErr) {
        console.error("Unable to enforce MFA on user login:", enableErr);
      }
      user.mfa_enabled = true;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challenge = {
      code,
      expiresAt: Date.now() + MFA_TTL_SECONDS * 1000,
    };

    let challengeStored = false;
    if (redis.status === "ready") {
      try {
        await redis.setex(`mfa:${user.id}`, MFA_TTL_SECONDS, JSON.stringify(challenge));
        challengeStored = true;
      } catch (err) {
        console.warn("Redis MFA cache failed:", err.message || err);
      }
    }

    if (!challengeStored) {
      const expires = new Date(challenge.expiresAt).toISOString();
      const { error: updateError } = await supabase
        .from("users")
        .update({ mfa_code: code, mfa_expires: expires })
        .eq("id", user.id);

      if (updateError) {
        console.error("MFA code save error:", updateError);
        return res.status(500).json({ error: "Unable to create MFA challenge" });
      }
    }

    const tempToken = signToken(
      { id: user.id, email: user.email, is_premium: user.is_premium, mfa_pending: true },
      "10m"
    );
    console.log(`🔐 MFA login code for ${email}: ${code}`);

    // Send email with MFA code (asynchronous to avoid blocking)
    sendEmail({
      to: user.email,
      subject: "Your TodoApp MFA Code",
      text: `Your 6-digit MFA code is: ${code}. It will expire in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #6366f1;">Your Verification Code</h2>
          <p style="font-size: 16px; color: #475569;">Enter the code below to complete your login to TodoApp:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 12px; background: #f8fafc; text-align: center; border-radius: 4px; color: #1e293b;">
            ${code}
          </div>
          <p style="margin-top: 20px; font-size: 14px; color: #94a3b8;">This code will expire in 10 minutes.</p>
        </div>
      `,
    }).catch(mailErr => console.error("Failed to send MFA email:", mailErr.message));

    return res.json({
      mfa_required: true,
      tempToken,
      message: "A 6-digit verification code has been sent to your email.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/verify", requireMfaPending, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "MFA code required" });

  try {
    let challenge = null;
    if (redis.status === "ready") {
      challenge = await cacheGet(`mfa:${req.user.id}`);
    }

    let user = null;
    if (!challenge) {
      const { data } = await supabase
        .from("users")
        .select("id, email, is_premium, mfa_code, mfa_expires")
        .eq("id", req.user.id)
        .single();
      user = data;
    }

    const codeRecord = challenge
      ? { code: challenge.code, expiresAt: challenge.expiresAt }
      : user && user.mfa_code && user.mfa_expires
      ? { code: user.mfa_code, expiresAt: new Date(user.mfa_expires).getTime() }
      : null;

    if (!codeRecord || !codeRecord.code || !codeRecord.expiresAt) {
      return res.status(400).json({ error: "No pending MFA challenge found" });
    }

    if (codeRecord.code !== String(code).trim()) {
      return res.status(400).json({ error: "Invalid MFA code" });
    }

    if (codeRecord.expiresAt < Date.now()) {
      return res.status(400).json({ error: "MFA code expired" });
    }

    if (redis.status === "ready") {
      await cacheDel(`mfa:${req.user.id}`);
    } else {
      await supabase
        .from("users")
        .update({ mfa_code: null, mfa_expires: null })
        .eq("id", req.user.id);
    }

    const token = signToken({ id: req.user.id, email: req.user.email, is_premium: req.user.is_premium, mfa_enabled: true });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/enable", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("users")
      .update({ mfa_enabled: true })
      .eq("id", req.user.id);
    if (error) throw error;
    res.json({ success: true, mfa_enabled: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to enable MFA" });
  }
});

router.post("/mfa/disable", requireAuth, async (req, res) => {
  res.status(403).json({ error: "MFA is mandatory and cannot be disabled." });
});

// ─── Change Password ──────────────────────────────────────────────────────────
router.put("/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) 
    return res.status(400).json({ error: "Current and new password required" });
  if (newPassword.length < 6) 
    return res.status(400).json({ error: "New password must be at least 6 characters" });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("password")
      .eq("id", req.user.id)
      .single();

    if (!user || !user.password) return res.status(400).json({ error: "Invalid operation. Account might be OAuth only." });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: "Incorrect current password" });

    const hashed = await bcrypt.hash(newPassword, 10);
    const { error } = await supabase
      .from("users")
      .update({ password: hashed })
      .eq("id", req.user.id);
      
    if (error) throw error;
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GitHub OAuth ──────────────────────────────────────────────────────────────
router.get("/github", (req, res, next) => {
  const options = {
    scope: ["user:email"],
    session: false,
  };

  // When users want to switch GitHub accounts, request explicit account selection.
  if (req.query.switch_account === "1") {
    options.prompt = "select_account";
  }

  // Optional: pre-fill username/email on GitHub side when provided.
  if (typeof req.query.login_hint === "string" && req.query.login_hint.trim()) {
    options.login = req.query.login_hint.trim();
  }

  passport.authenticate("github", options)(req, res, next);
});

router.get(
  "/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: "/login-failed" }),
  (req, res) => {
    const user  = req.user;
    const token = signToken({ id: user.id, email: user.email, is_premium: user.is_premium, mfa_enabled: user.mfa_enabled });
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:8080";
    res.redirect(`${frontendUrl}/?token=${token}`);
  }
);

// ─── Get current user ──────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const key = `user:profile:${userId}`;

  try {
    const user = await withCache(key, async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, provider, is_premium, mfa_enabled, created_at")
        .eq("id", userId)
        .single();

      if (error) throw error;
      return data;
    }, 300); // Cache for 5 minutes

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Fetch profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Dev Mock Login ───────────────────────────────────────────────────────────
// Use this to test the app without real GitHub OAuth setup.
router.post("/mock-login", async (req, res) => {
  const email = req.body.email || "testuser@example.com";
  try {
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .single();

    if (!user) {
      // Create test user
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ email: email.toLowerCase(), provider: "mock", is_premium: false })
        .select()
        .single();
      if (error) throw error;
      user = newUser;
    }

    const token = signToken({ id: user.id, email: user.email, is_premium: user.is_premium, mfa_enabled: user.mfa_enabled });
    res.json({ token, user: { id: user.id, email: user.email, is_premium: user.is_premium, mfa_enabled: user.mfa_enabled }, message: "Mock login successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mock login failed — check Supabase connection" });
  }
});

// ─── Forgot Password ──────────────────────────────────────────────────────────
const resetTokens = new Map(); // In production, use Redis or database

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("id, email, provider")
      .eq("email", email.toLowerCase())
      .single();

    if (!user) return res.status(404).json({ error: "No account found with this email" });
    if (user.provider !== "local") return res.status(400).json({ error: "This account uses OAuth login. Please use GitHub to login." });

    // Generate reset token
    const resetToken = require("crypto").randomBytes(32).toString("hex");
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
    resetTokens.set(resetToken, { userId: user.id, expires });

    // In production, send email. For demo, log the reset link
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:8080"}/reset-password?token=${resetToken}`;
    console.log(`🔑 Password reset link for ${email}: ${resetLink}`);

    res.json({ message: "Password reset link sent to your email (check server logs for demo)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Reset Password ───────────────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: "Token and new password required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const resetData = resetTokens.get(token);
  if (!resetData || Date.now() > resetData.expires) {
    if (resetData) resetTokens.delete(token);
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 12);
    const { error } = await supabase
      .from("users")
      .update({ password: hashed })
      .eq("id", resetData.userId);

    if (error) throw error;

    resetTokens.delete(token);
    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Change Password (for logged in users) ────────────────────────────────────
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("password")
      .eq("id", req.user.id)
      .single();

    if (!user || !user.password) return res.status(400).json({ error: "Account has no password set" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    const hashed = await bcrypt.hash(newPassword, 12);
    const { error } = await supabase
      .from("users")
      .update({ password: hashed })
      .eq("id", req.user.id);

    if (error) throw error;
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
