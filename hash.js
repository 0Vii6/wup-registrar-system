// Password hashing using Node's built-in crypto.scrypt.
// No external dependency (bcrypt) required — works fully offline.

const crypto = require('crypto');

const KEY_LEN = 64;

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plainPassword), salt, KEY_LEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

function verifyPassword(plainPassword, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(String(plainPassword), salt, KEY_LEN);
  const stored_buf = Buffer.from(hashHex, 'hex');
  if (stored_buf.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, stored_buf);
}

module.exports = { hashPassword, verifyPassword };
