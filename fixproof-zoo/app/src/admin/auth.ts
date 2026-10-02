import { timingSafeEqual } from "node:crypto";
export function bearerOk(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
