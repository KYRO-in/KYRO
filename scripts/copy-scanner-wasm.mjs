/**
 * Copies the barcode scanner engine (zxing WebAssembly) into public/scanner so
 * the camera scanner loads it from Kayyro's own domain instead of a CDN.
 * Runs automatically after `npm install` (postinstall).
 */
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const outDir = join(root, "public", "scanner");

if (!existsSync(src)) {
  console.warn("[copy-scanner-wasm] zxing_reader.wasm not found - camera scanning will use the browser's own detector only");
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "zxing_reader.wasm"));
console.log("[copy-scanner-wasm] public/scanner/zxing_reader.wasm ready");
