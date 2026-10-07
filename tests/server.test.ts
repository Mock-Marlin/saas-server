/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { PortError, createMemoryBroker, saasServer } from "../src/index.js";

const snapshot = {
  planId: "pro",
  renewsAt: null,
  cancelAtPeriodEnd: false,
  paymentState: "ok" as const,
  checkoutState: "none" as const,
  entitlements: { seats: true },
  usage: [{ key: "requests", used: 0, limit: 10 }],
};

async function appWithSession() {
  const app = Fastify();
  await app.register(saasServer, {
    basePath: "/api/v1",
    serverBuild: "2026.10.08",
    resolveSession: async (request) => (request.headers["x-user"] === "ada" ? { id: "ada" } : null),
    services: {
      notifications: false,
      sessions: false,
      uploads: false,
      operations: false,
      billing: false,
    },
  });
  return app;
}

describe("saasServer", () => {
  it("returns the session and echoes the request id", async () => {
    const app = await appWithSession();
    const response = await app.inject({ method: "GET", url: "/api/v1/session", headers: { "x-user": "ada", "x-request-id": "req_1" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "ada" });
    expect(response.headers["x-request-id"]).toBe("req_1");
    expect(response.headers["x-saas-server-build"]).toBe("2026.10.08");
    await app.close();
  });

  it("rejects a missing session with the error envelope", async () => {
    const app = await appWithSession();
    const response = await app.inject({ method: "GET", url: "/api/v1/session" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unauthorized", status: 401 });
    await app.close();
  });

  it("checks out through the billing port and verifies a webhook adapter", async () => {
    const events: string[] = [];
    const app = Fastify();
    await app.register(saasServer, {
      basePath: "/api/v1",
      resolveSession: async () => ({ id: "ada" }),
      services: { session: false, notifications: false, sessions: false, uploads: false, operations: false, billing: { webhookPath: "/billing/webhook" } },
      billing: {
        merchant: "dodo",
        adapters: {
          dodo: {
            allowRedirect: () => true,
            verify: () => ({ name: "subscription.updated", occurredAt: "2026-10-08T00:00:00.000Z" }),
          },
        },
        loadSnapshot: async () => snapshot,
        startCheckout: async (_user, input) => {
          events.push(input.idempotencyKey ?? "");
          return { status: "pending" };
        },
        startPortal: async () => ({ url: "https://checkout.dodopayments.com/portal" }),
        cancel: async () => snapshot,
        resume: async () => snapshot,
        keep: async () => snapshot,
        sync: async () => snapshot,
        applyEvent: async (event) => {
          events.push(event.name);
        },
      },
    });
    const checkout = await app.inject({
      method: "POST",
      url: "/api/v1/billing/checkout",
      headers: { "idempotency-key": "key_1", "content-type": "application/json" },
      payload: { planId: "pro" },
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json()).toEqual({ status: "pending" });
    const webhook = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhook",
      headers: { "content-type": "application/json" },
      payload: { type: "subscription.updated" },
    });
    expect(webhook.statusCode).toBe(204);
    expect(events).toEqual(["key_1", "subscription.updated"]);
    await app.close();
  });

  it("lists account sessions and revokes one", async () => {
    const revoked: string[] = [];
    const app = Fastify();
    await app.register(saasServer, {
      basePath: "/api/v1",
      resolveSession: async () => ({ id: "ada" }),
      services: { session: false, billing: false, notifications: false, uploads: false, operations: false, sessions: { listPath: "/auth/sessions", revokePath: "/auth/sessions/:id/revoke" } },
      sessions: {
        list: async () => ({
          items: [{ id: "s1", userAgent: null, ip: null, createdAt: "2026-10-08T00:00:00.000Z", current: true }],
          nextCursor: null,
        }),
        revoke: async (_user, id) => {
          if (id === "s1") {
            throw new PortError(400, "current_session", "Sign out to end this session");
          }
          revoked.push(id);
        },
      },
    });
    const list = await app.inject({ method: "GET", url: "/api/v1/auth/sessions" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    const current = await app.inject({ method: "POST", url: "/api/v1/auth/sessions/s1/revoke" });
    expect(current.statusCode).toBe(400);
    const other = await app.inject({ method: "POST", url: "/api/v1/auth/sessions/s2/revoke" });
    expect(other.statusCode).toBe(204);
    expect(revoked).toEqual(["s2"]);
    await app.close();
  });

  it("prepares an upload and starts an operation", async () => {
    const app = Fastify();
    await app.register(saasServer, {
      basePath: "/api/v1",
      resolveSession: async () => ({ id: "ada" }),
      services: { session: false, billing: false, notifications: false, sessions: false },
      uploads: {
        prepare: async () => ({ url: "https://files.example/put", method: "PUT", headers: {}, key: "file-1" }),
        complete: async () => ({ key: "file-1", sizeBytes: 3, mimeType: "text/plain" }),
      },
      operations: {
        start: async () => ({ id: "op-1", status: "queued", pollAfterMs: 500 }),
        load: async () => ({ id: "op-1", status: "succeeded", pollAfterMs: 0, result: { ok: true } }),
      },
    });
    const prepared = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: { "content-type": "application/json" },
      payload: { fileName: "a.txt", mimeType: "text/plain", sizeBytes: 3 },
    });
    expect(prepared.json().key).toBe("file-1");
    const operation = await app.inject({
      method: "POST",
      url: "/api/v1/operations",
      headers: { "content-type": "application/json" },
      payload: { name: "import" },
    });
    expect(operation.json().status).toBe("queued");
    const loaded = await app.inject({ method: "GET", url: "/api/v1/operations/op-1" });
    expect(loaded.json().status).toBe("succeeded");
    await app.close();
  });
});

describe("notification stream", () => {
  it("flushes a frame before the connection timeout", async () => {
    const app = Fastify({ connectionTimeout: 400 });
    await app.register(saasServer, {
      basePath: "/api/v1",
      resolveSession: async () => ({ id: "ada" }),
      services: { session: false, billing: false, sessions: false, uploads: false, operations: false },
      notifications: createMemoryBroker(),
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/api/v1/notifications/stream`, { signal: AbortSignal.timeout(1_500) });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("missing stream body");
      }
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value).startsWith(":")).toBe(true);
      await reader.cancel();
    } finally {
      await app.close();
    }
  });
});

describe("createMemoryBroker", () => {
  it("publishes and lists a notification", async () => {
    const broker = createMemoryBroker();
    const item = { id: "n1", createdAt: "2026-10-08T00:00:00.000Z", seenAt: null, type: "notice", payload: { message: "hi" } };
    await broker.publish("ada", item);
    const page = await broker.list("ada", null);
    expect(page.items).toEqual([item]);
    const seen = await broker.markSeen("ada", "n1");
    expect(seen.seenAt).not.toBeNull();
  });
});
