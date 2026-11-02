import { randomBytes } from "node:crypto";
const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function generateUlid(now = Date.now()): string {
  let t = now; let time = "";
  for (let i = 0; i < 10; i++) { time = ENC[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(10); let rand = "";
  // 80 bits -> 16 Crockford chars (5 bits each)
  let bits = 0, val = 0;
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; rand += ENC[(val >>> bits) & 31]; } }
  if (bits > 0) rand += ENC[(val << (5 - bits)) & 31];
  return time + rand.slice(0, 16);
}
export function isUlid(v: string): boolean { return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(v); }
