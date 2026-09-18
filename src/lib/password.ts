import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * scrypt password hashing, with no native build step.
 *
 * bcrypt and argon2 both need compiling, which turns a container build into a
 * toolchain problem. scrypt is in Node itself and is a sound choice here.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
