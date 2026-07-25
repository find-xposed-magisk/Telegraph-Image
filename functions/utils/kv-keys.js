// Internal bookkeeping entries in the img_url namespace are named
// "<namespace>:<rest>" (short:AbC123, moderation:live-models, ...) so the
// dashboard file list can tell them apart from real files. File ids never
// contain a colon: Telegram ids are base64url, R2 ids are "r2-" + hex, and both
// carry a file extension.
const INTERNAL_KEY_PATTERN = /^[a-z][a-z0-9-]*:/i;

export function isInternalKey(name) {
  return typeof name === 'string' && INTERNAL_KEY_PATTERN.test(name);
}
