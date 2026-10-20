import { verify } from 'node:crypto';
import { provisioningPublicKey } from './provisioning-key.js';

// Only the holder of the offline private key can authorize initial accounts.
// Public deployments contain no password, password hash, or private key.
export function verifyProvisioning(body, now = Date.now(), publicKey = provisioningPublicKey) {
  if (typeof body.payload !== 'string' || body.payload.length > 4096 || typeof body.signature !== 'string' || body.signature.length > 128) return null;
  try {
    if (!verify(null, Buffer.from(body.payload), publicKey, Buffer.from(body.signature, 'base64'))) return null;
    const payload = JSON.parse(body.payload);
    if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + 3_600_000) return null;
    if (!Array.isArray(payload.accounts) || payload.accounts.length !== 2) return null;
    const expected = {podo:'raquel', personal:'jefferson'};
    if (new Set(payload.accounts.map(a=>a.profile)).size !== 2) return null;
    for (const account of payload.accounts) {
      if (expected[account.profile] !== account.username || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash)) return null;
    }
    return payload.accounts;
  } catch { return null; }
}
