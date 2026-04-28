const router  = require("express").Router();
const crypto  = require("crypto");
const Razorpay = require("razorpay");
const { supabase } = require("../db");
const { requireAuth } = require("../auth/middleware");
const { signToken } = require("../auth/jwt");

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || "rzp_test_REPLACE_ME",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "REPLACE_ME",
});

const PREMIUM_AMOUNT = 9900; // ₹99 in paise

// POST /payment/create-order
router.post("/create-order", requireAuth, async (req, res) => {
  if (req.user.is_premium)
    return res.status(400).json({ error: "Already a premium user" });

  try {
    const order = await razorpay.orders.create({
      amount:   PREMIUM_AMOUNT,
      currency: "INR",
      receipt:  `order_user_${req.user.id}_${Date.now()}`,
      notes:    { user_id: String(req.user.id) },
    });

    await supabase.from("payments").insert({
      user_id:           req.user.id,
      razorpay_order_id: order.id,
      amount:            PREMIUM_AMOUNT,
      currency:          "INR",
    });

    res.json({
      order_id: order.id,
      amount:   order.amount,
      currency: order.currency,
      key_id:   process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// POST /payment/verify
router.post("/verify", requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: "Missing payment fields" });

  // Verify HMAC signature
  const secret   = process.env.RAZORPAY_KEY_SECRET || "REPLACE_ME";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: "Payment verification failed" });

  try {
    // Mark payment as paid
    await supabase
      .from("payments")
      .update({ razorpay_payment_id, status: "paid" })
      .eq("razorpay_order_id", razorpay_order_id)
      .eq("user_id", req.user.id);

    // Upgrade user
    await supabase
      .from("users")
      .update({ is_premium: true })
      .eq("id", req.user.id);

    // Issue fresh token with is_premium: true
    const { data: user } = await supabase
      .from("users")
      .select("id, email, is_premium")
      .eq("id", req.user.id)
      .single();

    const newToken = signToken({ id: user.id, email: user.email, is_premium: true });
    res.json({ success: true, token: newToken, message: "Premium activated!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during verification" });
  }
});

// ─── Dev Mock Verify ──────────────────────────────────────────────────────────
// Use this to test the premium upgrade without real Razorpay keys.
router.post("/mock-verify", requireAuth, async (req, res) => {
  try {
    // Upgrade user
    const { data: user, error } = await supabase
      .from("users")
      .update({ is_premium: true })
      .eq("id", req.user.id)
      .select()
      .single();

    if (error) throw error;

    // Issue fresh token with is_premium: true
    const newToken = signToken({ id: user.id, email: user.email, is_premium: true });
    res.json({ success: true, token: newToken, message: "Premium activated (MOCK)!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mock verification failed — check Supabase connection" });
  }
});

module.exports = router;
