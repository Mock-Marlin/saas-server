/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import type {
  AccountSession,
  AccountSessionPaths,
  BillingEvent,
  BillingPaths,
  BillingSnapshot,
  CheckoutResult,
  CursorPage,
  NotificationItem,
  NotificationPaths,
  Operation,
  OperationPaths,
  SessionUser,
  UploadGrant,
  UploadPaths,
  UploadResult,
} from "@mockmarlin/saas-contract";
import type { FastifyRequest } from "fastify";

export class PortError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PortError";
    this.status = status;
    this.code = code;
  }
}

export interface WebhookAdapter {
  verify: (
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) => BillingEvent | Promise<BillingEvent>;
  allowRedirect: (url: string) => boolean;
}

export interface CheckoutInput {
  planId: string;
  currency?: string;
  idempotencyKey?: string;
}

export interface BillingPorts<TUser extends SessionUser> {
  loadSnapshot: (user: TUser) => Promise<BillingSnapshot>;
  startCheckout: (user: TUser, input: CheckoutInput) => Promise<CheckoutResult>;
  startPortal: (user: TUser, idempotencyKey?: string) => Promise<{ url: string }>;
  cancel: (user: TUser, idempotencyKey?: string) => Promise<BillingSnapshot>;
  resume: (user: TUser, idempotencyKey?: string) => Promise<BillingSnapshot>;
  keep: (user: TUser, idempotencyKey?: string) => Promise<BillingSnapshot>;
  sync: (user: TUser) => Promise<BillingSnapshot>;
  applyEvent: (event: BillingEvent, merchant: string, idempotencyKey?: string) => Promise<void>;
  adapters: Record<string, WebhookAdapter>;
  merchant?: string;
}

export interface NotificationSignal {
  kind: "item" | "removed";
  item?: NotificationItem;
  id: string;
}

export interface NotificationBroker {
  publish: (userId: string, item: NotificationItem) => Promise<void> | void;
  subscribe: (userId: string, since: string | null, signal: AbortSignal) => AsyncIterable<NotificationSignal>;
  list: (userId: string, cursor: string | null) => Promise<CursorPage<NotificationItem>>;
  markSeen: (userId: string, id: string) => Promise<NotificationItem>;
  remove: (userId: string, id: string) => Promise<void>;
}

export interface AccountSessionPorts<TUser extends SessionUser> {
  list: (user: TUser, cursor: string | null) => Promise<CursorPage<AccountSession>>;
  revoke: (user: TUser, id: string) => Promise<void>;
}

export interface UploadPrepareInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  idempotencyKey?: string;
}

export interface UploadPorts<TUser extends SessionUser> {
  prepare: (user: TUser, input: UploadPrepareInput) => Promise<UploadGrant>;
  complete: (user: TUser, key: string, idempotencyKey?: string) => Promise<UploadResult>;
}

export interface OperationPorts<TUser extends SessionUser> {
  start: (user: TUser, name: string, idempotencyKey?: string) => Promise<Operation>;
  load: (user: TUser, id: string) => Promise<Operation | null>;
}

export interface NotificationRouteSwitches {
  list?: boolean;
  stream?: boolean;
  seen?: boolean;
  remove?: boolean;
}

export interface ServiceSwitches {
  session?: false | { path?: string };
  billing?: false | Partial<BillingPaths>;
  notifications?: false | Partial<NotificationPaths>;
  sessions?: false | Partial<AccountSessionPaths>;
  uploads?: false | Partial<UploadPaths>;
  operations?: false | Partial<OperationPaths>;
}

export interface SaasServerOptions<TUser extends SessionUser = SessionUser> {
  basePath: string;
  resolveSession: (request: FastifyRequest) => Promise<TUser | null>;
  serverBuild?: string;
  subjectId?: (user: TUser) => string;
  services?: ServiceSwitches;
  notificationRoutes?: NotificationRouteSwitches;
  billing?: BillingPorts<TUser>;
  notifications?: NotificationBroker;
  sessions?: AccountSessionPorts<TUser>;
  uploads?: UploadPorts<TUser>;
  operations?: OperationPorts<TUser>;
}
