const router = require("express").Router();
const { supabase } = require("../db");
const { requireAuth } = require("../auth/middleware");
const { cacheGet, cacheSet, cacheDel, withCache } = require("../redis");

const todoKey = (userId) => `todos:user:${userId}`;

// GET /todos
router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const key = todoKey(userId);

  try {
    const data = await withCache(key, async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    }, 30);

    res.json(data);
  } catch (err) {
    console.error("Fetch todos error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /todos
router.post("/", requireAuth, async (req, res) => {
  const { task } = req.body;
  if (!task || !task.trim())
    return res.status(400).json({ error: "Task cannot be empty" });

  // Free tier: max 10 todos
  if (!req.user.is_premium) {
    const { count } = await supabase
      .from("todos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id);

    if (count >= 10) {
      return res.status(403).json({
        error: "Free plan limit reached (10 todos). Upgrade to Premium for unlimited todos.",
        upgrade_required: true,
      });
    }
  }

  const { data, error } = await supabase
    .from("todos")
    .insert({ user_id: req.user.id, task: task.trim() })
    .select()
    .single();

  if (error) { console.error(error); return res.status(500).json({ error: "Server error" }); }

  await cacheDel(todoKey(req.user.id));
  res.status(201).json(data);
});

// PUT /todos/:id
router.put("/:id", requireAuth, async (req, res) => {
  const { task, completed } = req.body;
  const { id } = req.params;

  // Ownership check
  const { data: existing } = await supabase
    .from("todos")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!existing) return res.status(404).json({ error: "Todo not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

  const updates = { updated_at: new Date().toISOString() };
  if (task      !== undefined) updates.task      = task.trim();
  if (completed !== undefined) updates.completed = completed;

  const { data, error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) { console.error(error); return res.status(500).json({ error: "Server error" }); }

  await cacheDel(todoKey(req.user.id));
  res.json(data);
});

// DELETE /todos/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: existing } = await supabase
    .from("todos")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!existing) return res.status(404).json({ error: "Todo not found" });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) { console.error(error); return res.status(500).json({ error: "Server error" }); }

  await cacheDel(todoKey(req.user.id));
  res.json({ success: true });
});

module.exports = router;
