// Prefixed, sortable-ish identifiers. The prefixes match the JSON Schemas in
// /schemas (req_, dec_, sess_, act_, rec_) so persisted objects stay readable.
import { randomBytes } from "node:crypto";

function token(): string {
  // 8 bytes of base36-ish randomness, alphanumeric to satisfy the schema patterns.
  return randomBytes(8).toString("hex");
}

export const newRequestId = () => `req_${token()}`;
export const newDecisionId = () => `dec_${token()}`;
export const newSessionId = () => `sess_${token()}`;
export const newActionId = () => `act_${token()}`;
export const newReceiptId = () => `rec_${token()}`;
export const newEventId = () => `evt_${token()}`;
export const newKeyId = () => `key_${token()}`;
export const newAdminEventId = () => `aev_${token()}`;

// A bearer secret for a freshly issued API key. High-entropy and random (unlike
// the deterministic seed tokens), shown to the caller exactly once.
export const newSecret = () => `sk_${randomBytes(24).toString("base64url")}`;

export const now = () => new Date().toISOString();
