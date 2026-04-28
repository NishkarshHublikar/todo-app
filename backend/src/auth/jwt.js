const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "change_me_in_production";
const EXPIRES_IN = "7d";

function signToken(payload, expiresIn = EXPIRES_IN) {
  return jwt.sign(payload, SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
