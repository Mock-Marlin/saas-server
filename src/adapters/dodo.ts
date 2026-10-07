/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import { allowDodoRedirect, verifyDodoWebhook } from "@mockmarlin/saas-contract/merchants/dodo";

import type { WebhookAdapter } from "../ports.js";

export function createDodoAdapter(secret: string): WebhookAdapter {
  return {
    verify: (rawBody, headers) => verifyDodoWebhook(rawBody, headers, secret),
    allowRedirect: allowDodoRedirect,
  };
}

export { allowDodoRedirect };
