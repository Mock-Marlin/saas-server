/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import { allowPaddleRedirect, verifyPaddleWebhook } from "@mockmarlin/saas-contract/merchants/paddle";

import type { WebhookAdapter } from "../ports.js";

export function createPaddleAdapter(secret: string): WebhookAdapter {
  return {
    verify: (rawBody, headers) => verifyPaddleWebhook(rawBody, headers, secret),
    allowRedirect: allowPaddleRedirect,
  };
}

export { allowPaddleRedirect };
