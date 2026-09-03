import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { ConfigValidationError, loadApiConfig } from "@dar-tech/config";
import { RequestContextStore, StructuredLogger } from "@dar-tech/observability";
import { AppModule } from "../app.module.js";
import { PermissionRegistryService } from "./permission.service.js";

async function run(): Promise<void> {
  const operation = process.argv[2];
  if (operation !== "sync" && operation !== "validate") {
    throw new Error("Permission registry command must be sync or validate");
  }
  const config = loadApiConfig(process.env);
  const contextStore = new RequestContextStore();
  const logger = new StructuredLogger(contextStore, {
    runtime: "api",
    environment: config.appEnvironment,
    level: config.logLevel,
  });
  const application = await NestFactory.createApplicationContext(
    AppModule.register(config, { contextStore, logger }),
    { logger },
  );
  try {
    const registry = application.get(PermissionRegistryService);
    const result =
      operation === "sync"
        ? await registry.synchronize()
        : await registry.validate();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (operation === "validate" && "valid" in result && !result.valid)
      process.exitCode = 1;
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  const message =
    error instanceof ConfigValidationError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Permission registry operation failed safely";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
