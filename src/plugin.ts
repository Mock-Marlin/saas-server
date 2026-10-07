/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import {
  REQUEST_ID_HEADER,
  createPaths,
  headerValue,
  isRecord,
  type SessionUser,
} from "@mockmarlin/saas-contract";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { idempotencyKeyOf, readObject, requestIdOf, sendError, settle, assignRequestId } from "./http.js";
import type { SaasServerOptions, WebhookAdapter } from "./ports.js";
import { PortError } from "./ports.js";

function subjectOf<TUser extends SessionUser>(options: SaasServerOptions<TUser>, user: TUser): string {
  return options.subjectId === undefined ? user.id : options.subjectId(user);
}

async function userOf<TUser extends SessionUser>(
  options: SaasServerOptions<TUser>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<TUser | null> {
  const user = await options.resolveSession(request);
  if (user === null || user.id.length === 0) {
    sendError(reply, requestIdOf(request), 401, "unauthorized", "Authentication required");
    return null;
  }
  return user;
}

function selectAdapter(
  adapters: Record<string, WebhookAdapter>,
  merchant: string | undefined,
  fallback: string | undefined,
): WebhookAdapter | null {
  const name = merchant ?? fallback;
  if (name === undefined) {
    const values = Object.values(adapters);
    return values.length === 1 ? values[0] ?? null : null;
  }
  return adapters[name] ?? null;
}

const saasServerPlugin: FastifyPluginAsync<SaasServerOptions> = async (app, options): Promise<void> => {
  const services = options.services ?? {};
  const paths = createPaths(options.basePath, {
    ...(services.session === false || services.session === undefined ? {} : { session: services.session }),
    ...(services.billing === false || services.billing === undefined ? {} : { billing: services.billing }),
    ...(services.notifications === false || services.notifications === undefined ? {} : { notifications: services.notifications }),
    ...(services.sessions === false || services.sessions === undefined ? {} : { sessions: services.sessions }),
    ...(services.uploads === false || services.uploads === undefined ? {} : { uploads: services.uploads }),
    ...(services.operations === false || services.operations === undefined ? {} : { operations: services.operations }),
  });

  await app.register(async (scope) => {
    scope.addHook("onRequest", async (request, reply) => {
      assignRequestId(request, reply, options.serverBuild);
    });

    if (services.session !== false) {
      scope.get(paths.session.path, async (request, reply) => {
        const user = await userOf(options, request, reply);
        if (user !== null) {
          await reply.send(user);
        }
      });
    }

    const billing = services.billing === false ? undefined : options.billing;
    if (billing !== undefined) {
      scope.get(paths.billing.snapshotPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          return user === null ? undefined : billing.loadSnapshot(user);
        });
      });

      const postSnapshot = (
        path: string,
        run: (user: SessionUser, key: string | undefined) => Promise<unknown>,
      ): void => {
        scope.post(path, async (request, reply) => {
          await settle(reply, requestIdOf(request), async () => {
            const user = await userOf(options, request, reply);
            if (user === null) {
              return undefined;
            }
            return run(user, idempotencyKeyOf(request));
          });
        });
      };

      scope.post(paths.billing.checkoutPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const body = readObject(request.body);
          if (user === null) {
            return undefined;
          }
          if (body === null || typeof body["planId"] !== "string" || body["planId"].length === 0) {
            throw new PortError(400, "invalid_body", "Checkout requires a planId");
          }
          const currency = typeof body["currency"] === "string" && body["currency"].length > 0 ? body["currency"] : undefined;
          const key = idempotencyKeyOf(request);
          return billing.startCheckout(user, {
            planId: body["planId"],
            ...(currency === undefined ? {} : { currency }),
            ...(key === undefined ? {} : { idempotencyKey: key }),
          });
        });
      });

      postSnapshot(paths.billing.portalPath, (user, key) => billing.startPortal(user, key));
      postSnapshot(paths.billing.cancelPath, (user, key) => billing.cancel(user, key));
      postSnapshot(paths.billing.resumePath, (user, key) => billing.resume(user, key));
      postSnapshot(paths.billing.keepPath, (user, key) => billing.keep(user, key));
      postSnapshot(paths.billing.syncPath, (user) => billing.sync(user));

      await scope.register(async (webhookScope) => {
        webhookScope.removeContentTypeParser("application/json");
        webhookScope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
          done(null, body);
        });
        webhookScope.post(paths.billing.webhookPath, async (request, reply) => {
          const requestId = requestIdOf(request);
          if (!Buffer.isBuffer(request.body)) {
            sendError(reply, requestId, 400, "invalid_webhook", "Webhook body must be raw JSON");
            return;
          }
          const params = isRecord(request.params) ? request.params : {};
          const merchant = typeof params["merchant"] === "string" ? params["merchant"] : billing.merchant;
          const adapter = selectAdapter(billing.adapters, typeof params["merchant"] === "string" ? params["merchant"] : undefined, billing.merchant);
          if (adapter === null || merchant === undefined) {
            sendError(reply, requestId, 404, "unknown_merchant", "No webhook adapter matches this request");
            return;
          }
          try {
            const event = await adapter.verify(request.body, request.headers);
            const key = idempotencyKeyOf(request);
            await billing.applyEvent(event, merchant, key);
            await reply.status(204).send();
          } catch (error: unknown) {
            if (error instanceof Error && error.name === "WebhookVerificationError") {
              sendError(reply, requestId, 400, "invalid_webhook", error.message);
              return;
            }
            if (error instanceof PortError) {
              sendError(reply, requestId, error.status, error.code, error.message);
              return;
            }
            sendError(reply, requestId, 500, "internal", "The service failed");
          }
        });
      });
    }

    const notifications = services.notifications === false ? undefined : options.notifications;
    const notificationRoutes = options.notificationRoutes ?? {};
    if (notifications !== undefined) {
      if (notificationRoutes.list !== false) {
        scope.get(paths.notifications.listPath, async (request, reply) => {
          await settle(reply, requestIdOf(request), async () => {
            const user = await userOf(options, request, reply);
            if (user === null) {
              return undefined;
            }
            const cursor = headerValue(request.headers["last-event-id"]) ?? null;
            return notifications.list(subjectOf(options, user), cursor);
          });
        });
      }

      if (notificationRoutes.stream !== false) {
        scope.get(paths.notifications.streamPath, async (request, reply) => {
          const user = await userOf(options, request, reply);
          if (user === null) {
            return;
          }
          const since = headerValue(request.headers["last-event-id"]) ?? null;
          const controller = new AbortController();
          const abort = (): void => {
            controller.abort();
          };
          // Headers stay corked until this handler returns, so an idle stream
          // never reaches the client. The connection timeout then destroys the
          // socket and the dev proxy answers 502.
          request.raw.setTimeout(0);
          reply.raw.setTimeout(0);
          reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            [REQUEST_ID_HEADER]: requestIdOf(request),
          });
          reply.raw.socket?.uncork();
          reply.raw.write(":\n\n");
          reply.raw.on("close", abort);
          try {
            for await (const signal of notifications.subscribe(subjectOf(options, user), since, controller.signal)) {
              if (reply.raw.writableEnded || reply.raw.destroyed) {
                break;
              }
              if (signal.kind === "removed") {
                reply.raw.write(`id: ${signal.id}\nevent: notification.removed\ndata: ${JSON.stringify({ id: signal.id })}\n\n`);
              } else if (signal.item !== undefined) {
                reply.raw.write(`id: ${signal.id}\nevent: notification\ndata: ${JSON.stringify(signal.item)}\n\n`);
              }
            }
          } finally {
            reply.raw.off("close", abort);
            if (!reply.raw.writableEnded && !reply.raw.destroyed) {
              reply.raw.end();
            }
          }
        });
      }

      if (notificationRoutes.seen !== false) {
        scope.post(paths.notifications.seenPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const params = isRecord(request.params) ? request.params : {};
          if (user === null || typeof params["id"] !== "string") {
            return undefined;
          }
          return notifications.markSeen(subjectOf(options, user), params["id"]);
        });
        });
      }

      if (notificationRoutes.remove !== false) {
        scope.delete(paths.notifications.deletePath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const params = isRecord(request.params) ? request.params : {};
          if (user === null || typeof params["id"] !== "string") {
            return undefined;
          }
          await notifications.remove(subjectOf(options, user), params["id"]);
          return undefined;
        });
        });
      }
    }

    const sessions = services.sessions === false ? undefined : options.sessions;
    if (sessions !== undefined) {
      scope.get(paths.sessions.listPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          return user === null ? undefined : sessions.list(user, null);
        });
      });
      scope.post(paths.sessions.revokePath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const params = isRecord(request.params) ? request.params : {};
          if (user === null || typeof params["id"] !== "string") {
            return undefined;
          }
          await sessions.revoke(user, params["id"]);
          return undefined;
        });
      });
    }

    const uploads = services.uploads === false ? undefined : options.uploads;
    if (uploads !== undefined) {
      scope.post(paths.uploads.preparePath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const body = readObject(request.body);
          if (user === null) {
            return undefined;
          }
          if (
            body === null ||
            typeof body["fileName"] !== "string" ||
            typeof body["mimeType"] !== "string" ||
            typeof body["sizeBytes"] !== "number"
          ) {
            throw new PortError(400, "invalid_body", "Upload requires fileName, mimeType, and sizeBytes");
          }
          const key = idempotencyKeyOf(request);
          return uploads.prepare(user, {
            fileName: body["fileName"],
            mimeType: body["mimeType"],
            sizeBytes: body["sizeBytes"],
            ...(key === undefined ? {} : { idempotencyKey: key }),
          });
        });
      });
      scope.post(paths.uploads.completePath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const body = readObject(request.body);
          if (user === null) {
            return undefined;
          }
          if (body === null || typeof body["key"] !== "string" || body["key"].length === 0) {
            throw new PortError(400, "invalid_body", "Upload completion requires a key");
          }
          return uploads.complete(user, body["key"], idempotencyKeyOf(request));
        });
      });
    }

    const operations = services.operations === false ? undefined : options.operations;
    if (operations !== undefined) {
      scope.post(paths.operations.createPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const body = readObject(request.body);
          if (user === null) {
            return undefined;
          }
          if (body === null || typeof body["name"] !== "string" || body["name"].length === 0) {
            throw new PortError(400, "invalid_body", "Operation requires a name");
          }
          return operations.start(user, body["name"], idempotencyKeyOf(request));
        });
      });
      scope.get(paths.operations.itemPath, async (request, reply) => {
        await settle(reply, requestIdOf(request), async () => {
          const user = await userOf(options, request, reply);
          const params = isRecord(request.params) ? request.params : {};
          if (user === null || typeof params["id"] !== "string") {
            return undefined;
          }
          const operation = await operations.load(user, params["id"]);
          if (operation === null) {
            throw new PortError(404, "not_found", "Operation not found");
          }
          return operation;
        });
      });
    }
  }, { prefix: paths.basePath });
};

export const saasServer = fp(saasServerPlugin, {
  name: "saas-server",
  fastify: "5.x",
});

export { createMemoryBroker } from "./broker.js";
export { PortError } from "./ports.js";
export type {
  AccountSessionPorts,
  BillingPorts,
  CheckoutInput,
  NotificationBroker,
  NotificationRouteSwitches,
  NotificationSignal,
  OperationPorts,
  SaasServerOptions,
  ServiceSwitches,
  UploadPorts,
  UploadPrepareInput,
  WebhookAdapter,
} from "./ports.js";
