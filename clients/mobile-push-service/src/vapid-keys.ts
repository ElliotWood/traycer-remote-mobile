import webPush from "web-push";
import { readJsonFileOrNull, writeJsonFileAtomic } from "./storage/fs-atomic";
import { vapidKeysPath } from "./storage/paths";

/**
 * The VAPID identity this service signs pushes with. `privateKey` never
 * leaves this module's callers except to hand it to `web-push`'s sender —
 * never serialized into an HTTP response, never logged.
 */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

const VAPID_SUBJECT = "mailto:push@traycer.ai";

interface StoredVapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/**
 * Loads the persisted VAPID keypair from `~/.traycer/push-service/vapid.json`,
 * generating and persisting one exactly once on first run. Every subsequent
 * call across process restarts loads the same keypair — a regenerated
 * keypair would invalidate every subscription already registered against the
 * old public key.
 *
 * `path` defaults to the real file; tests inject a temp path so a test run
 * never generates/reads the operator's actual VAPID identity.
 */
export async function loadOrCreateVapidKeys(
  path: string = vapidKeysPath(),
): Promise<VapidKeys> {
  const stored = await readJsonFileOrNull<StoredVapidKeys>(path);
  if (
    stored !== null &&
    typeof stored.publicKey === "string" &&
    stored.publicKey.length > 0 &&
    typeof stored.privateKey === "string" &&
    stored.privateKey.length > 0 &&
    typeof stored.subject === "string" &&
    stored.subject.length > 0
  ) {
    return stored;
  }

  const generated = webPush.generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: VAPID_SUBJECT,
  };
  await writeJsonFileAtomic(path, keys);
  return keys;
}
