/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import type { CursorPage, NotificationItem } from "@mockmarlin/saas-contract";

import type { NotificationBroker, NotificationSignal } from "./ports.js";

const CAP = 100;

interface Bucket {
  items: NotificationItem[];
  listeners: Set<(signal: NotificationSignal) => void>;
}

export function createMemoryBroker(): NotificationBroker {
  const buckets = new Map<string, Bucket>();

  function bucket(userId: string): Bucket {
    const existing = buckets.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const created: Bucket = { items: [], listeners: new Set() };
    buckets.set(userId, created);
    return created;
  }

  return {
    publish(userId, item) {
      const current = bucket(userId);
      current.items = [item, ...current.items.filter((entry) => entry.id !== item.id)].slice(0, CAP);
      for (const listener of current.listeners) {
        listener({ kind: "item", id: item.id, item });
      }
    },
    list(userId, cursor) {
      const items = bucket(userId).items.filter((item) => cursor === null || item.createdAt < cursor);
      const page: CursorPage<NotificationItem> = { items, nextCursor: null };
      return Promise.resolve(page);
    },
    markSeen(userId, id) {
      const current = bucket(userId);
      const item = current.items.find((entry) => entry.id === id);
      if (item === undefined) {
        return Promise.reject(new Error("missing"));
      }
      item.seenAt = new Date().toISOString();
      return Promise.resolve(item);
    },
    remove(userId, id) {
      const current = bucket(userId);
      current.items = current.items.filter((entry) => entry.id !== id);
      for (const listener of current.listeners) {
        listener({ kind: "removed", id });
      }
      return Promise.resolve();
    },
    subscribe(userId, since, signal) {
      const current = bucket(userId);
      return {
        async *[Symbol.asyncIterator]() {
          const pending: NotificationSignal[] = [];
          let waiting: (() => void) | undefined;
          const listener = (signalEvent: NotificationSignal): void => {
            pending.push(signalEvent);
            waiting?.();
          };
          current.listeners.add(listener);
          const history = [...current.items].reverse();
          let passed = since === null;
          try {
            for (const item of history) {
              if (!passed) {
                if (item.id === since) {
                  passed = true;
                }
                continue;
              }
              yield { kind: "item" as const, id: item.id, item };
            }
            while (!signal.aborted) {
              const next = pending.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                waiting = resolve;
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            }
          } finally {
            current.listeners.delete(listener);
          }
        },
      };
    },
  };
}
