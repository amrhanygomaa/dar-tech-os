import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiConfig } from "@dar-tech/config";
import { RequestContextStore, StructuredLogger } from "@dar-tech/observability";
import { AppModule } from "../app.module.js";
import { configureApiFoundation } from "../platform/configure-api-foundation.js";

const config: ApiConfig = {
  runtime: "api",
  appEnvironment: "production",
  nodeEnvironment: "production",
  logLevel: "error",
  port: 3001,
  databaseUrl: "postgresql://unused:unused@127.0.0.1:1/unused?schema=public",
  databasePoolMax: 1,
  databaseConnectTimeoutMs: 50,
  databaseIdleTimeoutMs: 50,
  authentication: {
    allowedRedirectUris: [
      "https://portal.example.test/onboarding/callback/provider",
    ],
    localProviderEnabled: false,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: {
    ttlSeconds: 300,
    rateLimitMaxRequests: 30,
    rateLimitWindowSeconds: 60,
  },
};

describe("S02-T06 API and production fail-closed boundary", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: "api",
      environment: "production",
      level: "error",
      destination,
    });
    app = await NestFactory.create(
      AppModule.register(config, { contextStore, logger }),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("denies every T06 route before database access and ignores identity-like assertions", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/permissions?role=Founder")
      .set("X-Role", "Super Admin")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/roles/018f53d4-2f68-7c52-a399-3df2364d9901/permissions")
      .expect(401);
    await request(app.getHttpServer())
      .post(
        "/api/v1/roles/018f53d4-2f68-7c52-a399-3df2364d9901/permissions?jobTitle=Owner",
      )
      .set("X-Role", "Founder")
      .send({
        permissionKey: "admin.permission.manage",
        scopeType: "ORGANIZATION",
      })
      .expect(401);
    await request(app.getHttpServer())
      .post(
        "/api/v1/roles/018f53d4-2f68-7c52-a399-3df2364d9901/permissions/admin.permission.manage/remove",
      )
      .expect(401);
  });

  it("documents exactly the four T06 routes and no public registry mutation or DELETE route", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/openapi.json")
      .expect(200);
    const document = response.body.data ?? response.body;
    expect(document.paths["/api/v1/permissions"].get).toBeDefined();
    expect(document.paths["/api/v1/permissions"].post).toBeUndefined();
    expect(document.paths["/api/v1/permissions"].patch).toBeUndefined();
    expect(document.paths["/api/v1/permissions"].delete).toBeUndefined();
    expect(document.paths["/api/v1/roles/{id}/permissions"].get).toBeDefined();
    expect(document.paths["/api/v1/roles/{id}/permissions"].post).toBeDefined();
    expect(
      document.paths[
        "/api/v1/roles/{roleId}/permissions/{permissionKey}/remove"
      ].post,
    ).toBeDefined();
    expect(JSON.stringify(document.paths)).not.toMatch(
      /authorize-debug|role-permissions/iu,
    );
  });
});
