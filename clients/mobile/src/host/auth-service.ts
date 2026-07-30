/**
 * Thin mobile-web `AuthService`.
 *
 * Desktop's `AuthService` is genuinely coupled to `IRunnerHost` (secureStorage /
 * onAuthCallback / beginAuthAttempt / a main-process device-flow controller /
 * the locked credentials-file token store) and is not reusable in a browser tab.
 * This service composes the already shell-agnostic shared pieces instead:
 *
 *   - `clients/shared/auth/device-auth.ts` — RFC 8628 device flow over plain
 *     `fetch`, driven here as a start + poll loop with the shared schedule
 *     helpers (`createPollSchedule` / `applySlowDown` / `isDeviceExpired`). No
 *     callback URL: the user approves in any browser tab while we poll
 *     `/device/token`.
 *   - `clients/shared/auth/auth-validation.ts` — the post-`authorized` whoami
 *     (`GET /api/v3/user`, access-only, never spends) that yields the
 *     `AuthenticatedUser` the device-flow response omits, plus the single-attempt
 *     `refreshOnceAbortable` used to spend the refresh token when the access
 *     token has gone stale.
 *   - `DefaultRequestContextProvider({ origin: "renderer" })` — the boundary that
 *     mints / rotates / aborts the live `RequestContext`. `renderer` is the
 *     type-valid origin for a browser shell (there is no mobile origin, and none
 *     is needed).
 *
 * Persistence is `localStorage` (user request 2026-07-27 — `sessionStorage`
 * died on tab close and forced re-login too often on mobile): survives tab close
 * and browser restart, accepting `localStorage`'s at-rest XSS exposure as a
 * mobile-UX tradeoff. Both the access token and the refresh token are stored,
 * because `/api/v3/auth/refresh`
 * requires the access token as its bearer AND the refresh token in the body —
 * the refresh token alone cannot be spent.
 *
 * Bearer bridge (R3): there is NO `MutableBearerLease` here. The `RequestContext`
 * path already exposes a `CredentialLease` (which structurally satisfies
 * `OpenFrameBearerSource`), so the transport `BearerSourceProvider` is simply
 * `() => current()?.credentials ?? null` — the exact same `ctx.credentials` seam
 * the unary stack reads. `MutableBearerLease` exists only for a client holding a
 * raw token string (the CLI), which mobile is not.
 */
import {
  applySlowDown,
  createPollSchedule,
  DEFAULT_DEVICE_REQUEST_TIMEOUT_MS,
  isDeviceExpired,
  pollDeviceToken,
  startDeviceAuthorization,
  type DeviceClientId,
  type DevicePollSchedule,
} from "@traycer-clients/shared/auth/device-auth";
import {
  refreshOnceAbortable,
  validateAuthTokenIdentityAccessOnly,
  type AuthIdentityValidationResult,
} from "@traycer-clients/shared/auth/auth-validation";
import { safeStorage } from "./safe-storage";
import type { AuthTokenRefreshResult } from "@traycer-clients/shared/platform/runner-host";
import {
  DefaultRequestContextProvider,
  type RequestContextListener,
  type RequestContextSubscription,
} from "@traycer-clients/shared/auth/request-context-provider";
import type {
  BearerSourceProvider,
  OpenFrameBearerSource,
} from "@traycer-clients/shared/auth/bearer-source";
import type { RevalidateOutcome } from "@traycer-clients/shared/auth/bearer-revalidator";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import type { RequestContext } from "@traycer/protocol/auth/request-context";

/**
 * Minimal `Storage` surface this service depends on. The DOM `Storage`
 * (`sessionStorage`) satisfies it structurally; tests inject an in-memory fake
 * so the suite needs no jsdom/`sessionStorage` global.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Stable error identifiers for the signed-out surface, so T4's sign-in screen
 * can render copy matching the flow the user was actually in. Deliberately
 * mirrors the desktop `AuthService`'s vocabulary.
 */
export type MobileAuthError =
  | "session-expired" // a rehydrated/live credential AuthnV3 rejected
  | "sign-in-failed" // device flow authorized but whoami/validation failed
  | "device-denied" // user denied the request in the browser
  | "device-expired" // the device_code TTL elapsed before approval
  | "launch-failed"; // /device/authorize never returned a code

/**
 * Device-flow progress projected for the UI (T4): the human-entered `userCode`,
 * the verification URIs to show/open, and the absolute expiry so the surface can
 * render a countdown. `null` whenever no attempt is in flight.
 */
export interface DeviceFlowProgress {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresAtMs: number;
}

/**
 * Public auth status for the UI. Distinct from the `RequestContext` boundary
 * (`current()` / `onChange()`), which host/transport consumers thread; the UI
 * keys on this projection instead.
 */
export type MobileAuthStatus =
  | { readonly kind: "signed-out"; readonly error: MobileAuthError | null }
  | {
      readonly kind: "signing-in";
      readonly progress: DeviceFlowProgress | null;
    }
  | { readonly kind: "signed-in"; readonly user: AuthenticatedUser };

export type MobileAuthStatusListener = (status: MobileAuthStatus) => void;

export interface MobileAuthServiceOptions {
  readonly authnBaseUrl: string;
  /** Defaults to `globalThis.localStorage`; injected in tests. */
  readonly storage?: StorageLike;
  /** Device-flow client id. Defaults to `"mobile"`. */
  readonly clientId?: DeviceClientId;
  /** Human label sent to `/device/authorize`. */
  readonly hostLabel?: string;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable inter-poll delay (tests). Defaults to an abortable timer. */
  readonly sleep?: (
    ms: number,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
}

/** `localStorage` key holding the `{ token, refreshToken }` JSON blob. */
const STORAGE_KEY = "traycer.mobile.auth";
const DEFAULT_HOST_LABEL = "Traycer Remote (mobile)";

type StoredTokens = { readonly token: string; readonly refreshToken: string };

/**
 * Terminal outcome of one full device-authorization drive. `authorized` carries
 * the minted pair; every other variant is a terminal reason the caller maps to a
 * `MobileAuthError` (or, for `cancelled`, silently drops).
 */
export type DeviceFlowOutcome =
  | {
      readonly kind: "authorized";
      readonly token: string;
      readonly refreshToken: string;
    }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | { readonly kind: "invalid" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "launch-failed" };

export interface RunDeviceAuthorizationDeps {
  readonly authnBaseUrl: string;
  readonly clientId: DeviceClientId;
  readonly hostLabel: string;
  readonly now: () => number;
  readonly sleep: (
    ms: number,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: (progress: DeviceFlowProgress) => void;
}

/**
 * Drives one device authorization end-to-end: `/device/authorize`, then the
 * `/device/token` poll loop, mapping every shared `DevicePollResult` variant to
 * a loop action. This is the load-bearing state machine (unit-tested directly):
 *
 *   - `authorized`            → terminal success with the minted pair;
 *   - `authorization-pending` → keep polling on the current interval;
 *   - `slow-down`             → widen the interval (`applySlowDown`) and keep polling;
 *   - `access-denied`         → terminal `denied`;
 *   - `expired`               → terminal `expired`;
 *   - `invalid`               → terminal `invalid`;
 *   - `network-error`         → transient; keep polling until the device_code TTL
 *                               (`isDeviceExpired`) turns it into `expired`.
 *
 * A caller abort (`signal`) short-circuits to `cancelled`. The clock and the
 * inter-poll delay are injected so the loop runs identically in a browser and in
 * a fake-timer test.
 */
/**
 * Reads the signal's abort state through a function boundary so control-flow
 * narrowing from an earlier `=== true` check cannot make a later re-check (after
 * an `await`, during which `aborted` may have flipped) look statically
 * impossible. `AbortSignal.aborted` is `readonly`, so TS otherwise keeps the
 * post-check `false | undefined` narrowing across the await.
 */
function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function runDeviceAuthorization(
  deps: RunDeviceAuthorizationDeps,
): Promise<DeviceFlowOutcome> {
  const started = await startDeviceAuthorization(
    deps.authnBaseUrl,
    { clientId: deps.clientId, hostLabel: deps.hostLabel },
    { signal: deps.signal, timeoutMs: DEFAULT_DEVICE_REQUEST_TIMEOUT_MS },
  );
  if (started.kind === "network-error") {
    return { kind: "launch-failed" };
  }

  const startedAtMs = deps.now();
  deps.onProgress({
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    verificationUriComplete: started.verificationUriComplete,
    expiresAtMs: startedAtMs + started.expiresInSeconds * 1000,
  });

  let schedule: DevicePollSchedule = createPollSchedule({
    intervalSeconds: started.intervalSeconds,
    expiresInSeconds: started.expiresInSeconds,
    startedAtMs,
  });

  for (;;) {
    if (isSignalAborted(deps.signal)) {
      return { kind: "cancelled" };
    }
    if (isDeviceExpired(schedule, deps.now())) {
      return { kind: "expired" };
    }
    try {
      await deps.sleep(schedule.intervalMs, deps.signal);
    } catch {
      // The only rejection the injected sleep raises is an abort.
      return { kind: "cancelled" };
    }
    if (isSignalAborted(deps.signal)) {
      return { kind: "cancelled" };
    }
    if (isDeviceExpired(schedule, deps.now())) {
      return { kind: "expired" };
    }

    const poll = await pollDeviceToken(
      deps.authnBaseUrl,
      started.deviceCode,
      deps.clientId,
      { signal: deps.signal, timeoutMs: DEFAULT_DEVICE_REQUEST_TIMEOUT_MS },
    );
    switch (poll.kind) {
      case "authorized":
        return {
          kind: "authorized",
          token: poll.token,
          refreshToken: poll.refreshToken,
        };
      case "authorization-pending":
        break;
      case "slow-down":
        schedule = applySlowDown(schedule, poll.retryAfterSeconds);
        break;
      case "access-denied":
        return { kind: "denied" };
      case "expired":
        return { kind: "expired" };
      case "invalid":
        return { kind: "invalid" };
      case "network-error":
        // Transient: keep polling; the expiry check above ends the loop if the
        // device_code TTL elapses while the network is down.
        break;
    }
  }
}

export class MobileAuthService {
  private readonly authnBaseUrl: string;
  private readonly storage: StorageLike;
  private readonly clientId: DeviceClientId;
  private readonly hostLabel: string;
  private readonly now: () => number;
  private readonly sleep: (
    ms: number,
    signal: AbortSignal | undefined,
  ) => Promise<void>;

  private readonly contextProvider: DefaultRequestContextProvider;
  private readonly statusListeners = new Set<MobileAuthStatusListener>();
  private statusValue: MobileAuthStatus = { kind: "signed-out", error: null };

  /**
   * Persistence-only mirror of the live bearer / refresh token. Held so the
   * refresh path (`/api/v3/auth/refresh`, which needs BOTH) can spend without
   * reaching through `ctx.credentials`. Host/transport consumers must NEVER read
   * these — they thread the `RequestContext`.
   */
  private currentBearer: string | null = null;
  private currentRefreshToken: string | null = null;

  /**
   * Monotonic transition fence. Bumped by every externally-initiated transition
   * (`signIn` / `signOut` / `start`); async tails capture it before their first
   * await and re-check after each so a newer transition always wins over an
   * already-started rehydration/sign-in/revalidation.
   */
  private generation = 0;

  /** Single in-flight device-flow attempt's aborter, or null. */
  private signInController: AbortController | null = null;

  /**
   * Single-flight revalidation. Both the unary (`revalidateExpectedBearer`) and
   * stream (`revalidateCurrentContext`) recovery paths funnel through one promise
   * so a concurrent 401 storm can never double-spend the single-use refresh token.
   */
  private currentRevalidation: Promise<AuthIdentityValidationResult | null> | null =
    null;

  /** The `BearerSourceProvider` the transport reads (R3: over `ctx.credentials`). */
  readonly bearerSource: BearerSourceProvider = () =>
    this.contextProvider.current()?.credentials ?? null;

  constructor(options: MobileAuthServiceOptions) {
    this.authnBaseUrl = options.authnBaseUrl;
    this.storage = options.storage ?? defaultLocalStorage();
    this.clientId = options.clientId ?? "mobile";
    this.hostLabel = options.hostLabel ?? DEFAULT_HOST_LABEL;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? abortableDelay;
    this.contextProvider = new DefaultRequestContextProvider({
      origin: "renderer",
    });
  }

  // --- RequestContext boundary (host/transport consumers) ------------------

  /** The live `RequestContext`, or `null` when signed out. */
  current(): RequestContext | null {
    return this.contextProvider.current();
  }

  /** Fires on every identity transition (sign-in / sign-out / cross-user). */
  onChange(listener: RequestContextListener): RequestContextSubscription {
    return this.contextProvider.onChange(listener);
  }

  /**
   * Fires when the active context's bearer is rotated in place (same-user
   * refresh) — the transition `onChange` is deliberately silent about. The
   * stream transport's in-place `credentialUpdate` listens here.
   */
  onBearerRotated(listener: () => void): RequestContextSubscription {
    return this.contextProvider.onBearerRotated(listener);
  }

  // --- UI status projection (T4) -------------------------------------------

  status(): MobileAuthStatus {
    return this.statusValue;
  }

  onStatusChange(listener: MobileAuthStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.statusValue);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // --- Lifecycle ------------------------------------------------------------

  /**
   * Rehydrate from `sessionStorage`: if a stored pair validates, mint a context
   * and go signed-in; if the access token is stale, spend the refresh token once
   * and retry; otherwise stay signed-out. A transient network failure keeps the
   * stored pair (a later reload retries) but projects signed-out because no
   * validated context can be minted yet.
   */
  async start(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;

    const stored = this.readStored();
    if (stored === null) {
      this.setStatus({ kind: "signed-out", error: null });
      return;
    }

    const outcome = await validateAuthTokenIdentityAccessOnly(
      this.authnBaseUrl,
      stored.token,
    );
    if (!this.isCurrent(generation)) {
      return;
    }
    if (outcome.kind === "valid") {
      this.applySignedIn(stored.token, stored.refreshToken, outcome.user);
      return;
    }
    if (outcome.kind === "network-error") {
      // Transient: cannot mint a context from an unvalidated bearer, but do not
      // discard the stored pair — a later reload re-validates.
      this.setStatus({ kind: "signed-out", error: null });
      return;
    }
    // `rejected`: the stored access token is stale. Spend the refresh token once.
    await this.rehydrateViaRefresh(stored, generation);
  }

  /**
   * Interactive sign-in via the RFC 8628 device flow. Supersedes any in-flight
   * attempt, drives `runDeviceAuthorization`, and on `authorized` runs the whoami
   * to mint the context. UI copy for a terminal failure is carried on the
   * signed-out status. T4 owns the actual screen; this owns the machinery.
   */
  async signIn(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;

    this.signInController?.abort();
    const controller = new AbortController();
    this.signInController = controller;
    this.setStatus({ kind: "signing-in", progress: null });

    try {
      const outcome = await runDeviceAuthorization({
        authnBaseUrl: this.authnBaseUrl,
        clientId: this.clientId,
        hostLabel: this.hostLabel,
        now: this.now,
        sleep: this.sleep,
        signal: controller.signal,
        onProgress: (progress) => {
          if (this.isCurrent(generation)) {
            this.setStatus({ kind: "signing-in", progress });
          }
        },
      });
      if (!this.isCurrent(generation)) {
        return;
      }
      if (this.signInController === controller) {
        this.signInController = null;
      }

      if (outcome.kind === "cancelled") {
        // A newer signIn/signOut already re-projected; nothing to do.
        return;
      }
      if (outcome.kind !== "authorized") {
        this.setStatus({
          kind: "signed-out",
          error: deviceOutcomeError(outcome),
        });
        return;
      }

      // Whoami: the device-flow response returns tokens only, so validate
      // (access-only) to obtain the `AuthenticatedUser` the context needs.
      const validated = await validateAuthTokenIdentityAccessOnly(
        this.authnBaseUrl,
        outcome.token,
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      if (validated.kind === "valid") {
        this.applySignedIn(outcome.token, outcome.refreshToken, validated.user);
        return;
      }
      // A freshly minted token that AuthnV3 rejects, or a whoami network blip:
      // both surface as a sign-in failure with a retry CTA.
      this.setStatus({ kind: "signed-out", error: "sign-in-failed" });
    } catch {
      // The typed-outcome paths above never throw; this only catches an
      // UNEXPECTED failure (a bug or a synchronous throw from the device-flow /
      // whoami helpers). Without it the status would stay stuck on
      // "signing-in". A newer transition still wins (generation fence).
      if (!this.isCurrent(generation)) {
        return;
      }
      if (this.signInController === controller) {
        this.signInController = null;
      }
      this.setStatus({ kind: "signed-out", error: "sign-in-failed" });
    }
  }

  /** Cancels an in-flight device-flow attempt and returns to signed-out. */
  cancelSignIn(): void {
    if (this.signInController === null) {
      return;
    }
    this.generation += 1;
    this.signInController.abort();
    this.signInController = null;
    this.setStatus({ kind: "signed-out", error: null });
  }

  /** Explicit sign-out: abort the context, clear persisted tokens, emit null. */
  signOut(): void {
    this.generation += 1;
    this.signInController?.abort();
    this.signInController = null;
    this.applySignedOut(null);
  }

  // --- Auth recovery (transport contracts) ---------------------------------

  /**
   * Stream-side recovery contract (`StreamAuthRevalidator` reads the outcome
   * kind) and the source of truth the unary path funnels through. Returns:
   *
   *   - `null`                    → no live signed-in context to revalidate;
   *   - `{ kind: "valid", user }` → the credential is current (still valid, or
   *                                 refreshed + rotated in place);
   *   - `{ kind: "network-error" }` → transient; the session is left untouched;
   *   - `{ kind: "rejected" }`    → the credential is dead and this call has
   *                                 ALREADY signed out.
   *
   * Single-flighted so concurrent 401s share one refresh spend.
   */
  revalidateCurrentContext(): Promise<AuthIdentityValidationResult | null> {
    const ctx = this.contextProvider.current();
    if (ctx === null || this.currentBearer === null) {
      return Promise.resolve(null);
    }
    if (this.currentRevalidation !== null) {
      return this.currentRevalidation;
    }
    const op = this.revalidateOnce().finally(() => {
      if (this.currentRevalidation === op) {
        this.currentRevalidation = null;
      }
    });
    this.currentRevalidation = op;
    return op;
  }

  /**
   * Unary-transport recovery contract (`AuthorityBoundAuthRevalidator`). Only
   * revalidates when `expected` is still the live credential object that produced
   * the rejected open frame; a session replacement returns `superseded` so the
   * auth-aware messenger never rotates a stale bearer. The caller decides whether
   * to retry by observing whether `expected.getBearerToken()` actually changed.
   */
  async revalidateExpectedBearer(
    expected: OpenFrameBearerSource,
  ): Promise<RevalidateOutcome | "superseded"> {
    const generation = this.generation;
    if (!this.isExpectedBearerLive(expected)) {
      return "superseded";
    }
    const outcome = await this.revalidateCurrentContext();
    if (!this.isCurrent(generation) || outcome === null) {
      return "superseded";
    }
    if (outcome.kind === "rejected" || outcome.kind === "network-error") {
      return outcome.kind;
    }
    return this.isExpectedBearerLive(expected) ? "rotated" : "superseded";
  }

  private async revalidateOnce(): Promise<AuthIdentityValidationResult | null> {
    const generation = this.generation;
    const ctx = this.contextProvider.current();
    if (ctx === null || this.currentBearer === null) {
      return null;
    }
    const userId = ctx.identity.userId;
    const token = this.currentBearer;

    // Access-only: validate the live bearer without spending. A stale bearer
    // comes back `rejected`, and the spend routes through the refresh below.
    const outcome = await validateAuthTokenIdentityAccessOnly(
      this.authnBaseUrl,
      token,
    );
    if (!this.isCurrent(generation)) {
      return null;
    }
    if (outcome.kind === "valid" || outcome.kind === "network-error") {
      return outcome;
    }
    return this.refreshLiveSession(userId, token, generation);
  }

  /**
   * Same-user refresh of the LIVE session on a `rejected` access token: spend the
   * refresh token once, and on success rotate the credential lease in place
   * (observably silent on `onChange`), persist the new pair, and hand back the
   * fresh identity. A `rejected` refresh is a dead credential → sign out; a
   * `network-error` is transient → leave the session intact.
   */
  private async refreshLiveSession(
    userId: string,
    token: string,
    generation: number,
  ): Promise<AuthIdentityValidationResult | null> {
    const refreshToken = this.currentRefreshToken;
    if (refreshToken === null) {
      this.applySignedOut("session-expired");
      return { kind: "rejected" };
    }
    const refreshed: AuthTokenRefreshResult = await refreshOnceAbortable({
      authnBaseUrl: this.authnBaseUrl,
      token,
      refreshToken,
      signal: null,
    });
    if (!this.isCurrent(generation)) {
      return null;
    }
    if (refreshed.kind === "network-error") {
      return { kind: "network-error" };
    }
    if (refreshed.kind === "rejected") {
      this.applySignedOut("session-expired");
      return { kind: "rejected" };
    }

    // Re-validate the rotated bearer (access-only) to mint the full identity.
    const revalidated = await validateAuthTokenIdentityAccessOnly(
      this.authnBaseUrl,
      refreshed.token,
    );
    if (!this.isCurrent(generation)) {
      return null;
    }
    if (revalidated.kind !== "valid") {
      if (revalidated.kind === "rejected") {
        this.applySignedOut("session-expired");
        return { kind: "rejected" };
      }
      return { kind: "network-error" };
    }
    if (revalidated.user.user.id !== userId) {
      // A refresh minting a different user is a server anomaly for a same-user
      // rotation; fail closed rather than silently swap identity mid-session.
      this.applySignedOut("session-expired");
      return { kind: "rejected" };
    }

    this.contextProvider.rotateCurrentBearer({
      userId,
      bearerToken: refreshed.token,
    });
    this.currentBearer = refreshed.token;
    this.currentRefreshToken = refreshed.refreshToken;
    this.persist();
    return revalidated;
  }

  private async rehydrateViaRefresh(
    stored: StoredTokens,
    generation: number,
  ): Promise<void> {
    const refreshed: AuthTokenRefreshResult = await refreshOnceAbortable({
      authnBaseUrl: this.authnBaseUrl,
      token: stored.token,
      refreshToken: stored.refreshToken,
      signal: null,
    });
    if (!this.isCurrent(generation)) {
      return;
    }
    if (refreshed.kind === "refreshed") {
      const validated = await validateAuthTokenIdentityAccessOnly(
        this.authnBaseUrl,
        refreshed.token,
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      if (validated.kind === "valid") {
        this.applySignedIn(
          refreshed.token,
          refreshed.refreshToken,
          validated.user,
        );
        return;
      }
    }
    // `network-error` is transient — keep the stored pair for a later reload.
    // A definitive `rejected` (dead refresh token) or a rejected re-validation
    // clears it and surfaces "session expired".
    if (refreshed.kind === "rejected") {
      this.clearStorage();
      this.setStatus({ kind: "signed-out", error: "session-expired" });
      return;
    }
    this.setStatus({ kind: "signed-out", error: null });
  }

  // --- Transitions ----------------------------------------------------------

  private applySignedIn(
    token: string,
    refreshToken: string,
    user: AuthenticatedUser,
  ): void {
    this.currentBearer = token;
    this.currentRefreshToken = refreshToken;
    this.contextProvider.setSignedIn({
      user,
      bearerToken: token,
      operationId: undefined,
      externalAbortSignal: undefined,
    });
    this.persist();
    this.setStatus({ kind: "signed-in", user });
  }

  private applySignedOut(error: MobileAuthError | null): void {
    this.currentBearer = null;
    this.currentRefreshToken = null;
    this.clearStorage();
    this.contextProvider.signOut();
    this.setStatus({ kind: "signed-out", error });
  }

  private isExpectedBearerLive(expected: OpenFrameBearerSource): boolean {
    const ctx = this.contextProvider.current();
    return (
      ctx !== null &&
      ctx.credentials === expected &&
      !ctx.credentials.isReleased
    );
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private setStatus(status: MobileAuthStatus): void {
    this.statusValue = status;
    for (const listener of [...this.statusListeners]) {
      listener(status);
    }
  }

  // --- sessionStorage -------------------------------------------------------

  private persist(): void {
    if (this.currentBearer === null || this.currentRefreshToken === null) {
      return;
    }
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          token: this.currentBearer,
          refreshToken: this.currentRefreshToken,
        }),
      );
    } catch {
      // A quota/unavailable storage failure is non-fatal: the in-memory session
      // is still live; only cross-reload durability is lost.
    }
  }

  private clearStorage(): void {
    try {
      this.storage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal — see `persist`.
    }
  }

  private readStored(): StoredTokens | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (raw === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const token = record.token;
    const refreshToken = record.refreshToken;
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      typeof refreshToken !== "string" ||
      refreshToken.length === 0
    ) {
      return null;
    }
    return { token, refreshToken };
  }
}

function deviceOutcomeError(
  outcome: Exclude<
    DeviceFlowOutcome,
    { kind: "authorized" } | { kind: "cancelled" }
  >,
): MobileAuthError {
  switch (outcome.kind) {
    case "denied":
      return "device-denied";
    case "expired":
      return "device-expired";
    case "invalid":
      return "sign-in-failed";
    case "launch-failed":
      return "launch-failed";
  }
}

/**
 * The property ACCESS is what throws when storage is denied — not
 * `getItem`. `persist`/`readStored` below each wrap their calls in
 * try/catch and it made no difference: obtaining the object threw first,
 * during construction, before any of them ran.
 */
function defaultLocalStorage(): StorageLike {
  return safeStorage();
}

/**
 * Default inter-poll delay: a timer that rejects with an `AbortError` when
 * `signal` fires, so the poll loop can cancel a superseded/abandoned attempt
 * without waiting out the interval.
 */
function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}
