/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";

import {
  IDEMPOTENCY_KEY_HEADER,
  REQUEST_ID_HEADER,
  SERVER_BUILD_HEADER,
  headerValue,
  isRecord,
} from "@mockmarlin/saas-contract";
import type { FastifyReply, FastifyRequest } from "fastify";

import { PortError } from "./ports.js";

const requestIds = new WeakMap<FastifyRequest, string>();

export function assignRequestId(request: FastifyRequest, reply: FastifyReply, serverBuild: string | undefined): string {
  const incoming = headerValue(request.headers[REQUEST_ID_HEADER]);
  const requestId = incoming ?? randomUUID();
  requestIds.set(request, requestId);
  void reply.header(REQUEST_ID_HEADER, requestId);
  if (serverBuild !== undefined) {
    void reply.header(SERVER_BUILD_HEADER, serverBuild);
  }
  return requestId;
}

export function requestIdOf(request: FastifyRequest): string {
  return requestIds.get(request) ?? randomUUID();
}

export function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  return headerValue(request.headers[IDEMPOTENCY_KEY_HEADER]);
}

export function sendError(reply: FastifyReply, requestId: string, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ status, code, message, requestId });
}

export async function settle(reply: FastifyReply, requestId: string, work: () => Promise<unknown>): Promise<void> {
  try {
    const body = await work();
    if (reply.sent) {
      return;
    }
    if (body === undefined) {
      await reply.status(204).send();
      return;
    }
    await reply.send(body);
  } catch (error: unknown) {
    if (reply.sent) {
      return;
    }
    if (error instanceof PortError) {
      sendError(reply, requestId, error.status, error.code, error.message);
      return;
    }
    sendError(reply, requestId, 500, "internal", "The service failed");
  }
}

export function readObject(body: unknown): Record<string, unknown> | null {
  return isRecord(body) ? body : null;
}
