/** "I already paid" proof files: private bucket, 5 MB, photos or PDF (checked by content, not by name). */
export const PROOF_BUCKET = "collect-proofs";
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export function proofType(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: "image/png", ext: "png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}
