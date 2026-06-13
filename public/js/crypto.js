// ============================================================
//  crypto.js — zero-knowledge passphrase encryption for API keys
//  Uses the browser's built-in Web Crypto (free, no dependencies):
//  AES-GCM with a key derived from your passphrase via PBKDF2.
//  The passphrase is never stored — without it the ciphertext is
//  useless, even to someone who can read your Firestore document.
// ============================================================
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64  = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const ub64 = (s)   => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const ct   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

// Throws if the passphrase is wrong (AES-GCM auth tag fails) — that's the check.
export async function decryptString(blob, passphrase) {
  const key = await deriveKey(passphrase, ub64(blob.salt));
  const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub64(blob.iv) }, key, ub64(blob.ct));
  return dec.decode(pt);
}

export const isEncrypted = (v) => !!(v && typeof v === "object" && v.ct && v.iv && v.salt);
