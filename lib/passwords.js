import { scryptSync, timingSafeEqual } from 'node:crypto';

export const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');
export function passMatches(password, salt, expected) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
export function accountView(account) {
  const mustChangePassword = Boolean(account.password_change_required);
  return {profile:account.profile, username:account.username || null, mustChangePassword,
    ...(!mustChangePassword ? {data:account.data, revision:account.revision} : {})};
}
