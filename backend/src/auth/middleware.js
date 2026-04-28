const { verifyToken } = require("./jwt");

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.split(" ")[1];
  try {
    req.user = verifyToken(token);
    if (req.user.mfa_pending) {
      return res.status(401).json({ error: "MFA verification required" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token expired or invalid" });
  }
}

function requireMfaPending(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.split(" ")[1];
  try {
    req.user = verifyToken(token);
    if (!req.user.mfa_pending) {
      return res.status(401).json({ error: "MFA pending token required" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token expired or invalid" });
  }
}

function requirePremium(req, res, next) {
  if (!req.user || !req.user.is_premium) {
    return res.status(403).json({ error: "Premium subscription required" });
  }
  next();
}

module.exports = { requireAuth, requirePremium, requireMfaPending };
