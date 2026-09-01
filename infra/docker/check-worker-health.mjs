import { stat } from 'node:fs/promises';

const healthFile = process.env.WORKER_HEALTH_FILE;
const maximumAgeMs = Number(process.env.WORKER_HEALTH_MAX_AGE_MS ?? 30_000);

if (!healthFile || !Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) {
  process.exitCode = 1;
} else {
  try {
    const details = await stat(healthFile);
    if (Date.now() - details.mtimeMs > maximumAgeMs) {
      process.exitCode = 1;
    }
  } catch {
    process.exitCode = 1;
  }
}
