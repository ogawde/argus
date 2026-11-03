import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

/** Load .env.local first, then .env — for scripts outside Next.js.
 *  override:true so empty shell-injected placeholders don't block real values.
 */
export function loadEnvFiles(): void {
  const root = process.cwd();
  const local = path.join(root, ".env.local");
  const base = path.join(root, ".env");
  if (existsSync(base)) config({ path: base, override: false });
  if (existsSync(local)) config({ path: local, override: true });
}
