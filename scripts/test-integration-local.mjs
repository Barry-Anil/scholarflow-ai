import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let localStatus;
try {
  const statusCommand =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "supabase status -o json",
          ],
        ]
      : ["supabase", ["status", "-o", "json"]];
  localStatus = JSON.parse(
    execFileSync(statusCommand[0], statusCommand[1], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
} catch {
  console.error("Local Supabase is unavailable. Run `supabase start` first.");
  process.exit(1);
}

const vitestBin = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitestBin, "run", "--config", "vitest.integration.config.mts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: localStatus.DB_URL,
      TEST_SUPABASE_URL: localStatus.API_URL,
      TEST_SUPABASE_SERVICE_ROLE_KEY: localStatus.SERVICE_ROLE_KEY,
    },
  },
);

process.exit(result.status ?? 1);
