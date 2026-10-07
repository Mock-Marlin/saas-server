/**
 * Copyright (c) 2026 MockMarlin
 *
 * SPDX-License-Identifier: MIT
 */

import { allowStripeRedirect, verifyStripeWebhook } from "@mockmarlin/saas-contract/merchants/stripe";

import type { WebhookAdapter } from "../ports.js";

export function createStripeAdapter(secret: string): WebhookAdapter {
  return {
    verify: (rawBody, headers) => verifyStripeWebhook(rawBody, headers, secret),
    allowRedirect: allowStripeRedirect,
  };
}

export { allowStripeRedirect };
