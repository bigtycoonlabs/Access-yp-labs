// THE VAULT. Encrypts and decrypts business keys with AES-256-GCM.
//
// The master key is KEYS_MASTER_KEY: 64 hex characters, set only in the service's environment. If it
// is missing or malformed the vault refuses to store anything, rather than storing in the clear or
// under a made-up key. Every ciphertext records the key version so the master key can be rotated
// later without losing what was stored under the old one.

const crypto = require('crypto');

const VERSION = 1;

function masterKey() {
  const hex = String(process.env.KEYS_MASTER_KEY || '').trim();
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

function ready() { return !!masterKey(); }

function seal(plain) {
  const key = masterKey();
  if (!key) throw new Error('key storage is not switched on');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { ciphertext, iv, tag: c.getAuthTag(), version: VERSION };
}

function open({ ciphertext, iv, tag, version }) {
  if (version !== VERSION) throw new Error('this key was stored under a master key that is no longer loaded');
  const key = masterKey();
  if (!key) throw new Error('key storage is not switched on');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]).toString('utf8');
}

module.exports = { seal, open, ready, VERSION };
