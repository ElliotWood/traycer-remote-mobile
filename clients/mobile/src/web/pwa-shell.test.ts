import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  UPDATE_BANNER_ACTION,
  UPDATE_BANNER_TESTID,
  UPDATE_BANNER_TEXT,
  registerServiceWorker,
  type ServiceWorkerHost,
  type ServiceWorkerLike,
  type ServiceWorkerRegistrationLike,
} from "./pwa-shell";

/**
 * The fakes satisfy the module's own narrow collaborator types outright, so
 * nothing here is asserted past a DOM interface. An assertion is exactly what
 * would let the module's contract drift out from under this suite.
 */
interface FakeWorker extends ServiceWorkerLike {
  state: string;
  postMessage: Mock;
  /** Drives the real `statechange` -> `installed` sequence. */
  becomeInstalled(): void;
}

interface FakeRegistration extends ServiceWorkerRegistrationLike {
  waiting: ServiceWorkerLike | null;
  installing: ServiceWorkerLike | null;
  fireUpdateFound(worker: FakeWorker): void;
}

interface FakeHost extends ServiceWorkerHost {
  register: Mock;
  fireControllerChange(): void;
}

function fakeWorker(): FakeWorker {
  const listeners = new Set<() => void>();
  return {
    state: "installing",
    postMessage: vi.fn(),
    addEventListener(_type: "statechange", fn: () => void): void {
      listeners.add(fn);
    },
    becomeInstalled(): void {
      this.state = "installed";
      for (const fn of listeners) fn();
    },
  };
}

function fakeRegistration(waiting: ServiceWorkerLike | null): FakeRegistration {
  const listeners = new Set<() => void>();
  return {
    waiting,
    installing: null,
    addEventListener(_type: "updatefound", fn: () => void): void {
      listeners.add(fn);
    },
    fireUpdateFound(worker: FakeWorker): void {
      this.installing = worker;
      for (const fn of listeners) fn();
    },
  };
}

function fakeHost(options: {
  controller: ServiceWorkerLike | null;
  registration: FakeRegistration;
  registerRejects: boolean;
}): FakeHost {
  const listeners = new Set<() => void>();
  return {
    controller: options.controller,
    register: vi.fn(async () => {
      if (options.registerRejects) throw new Error("denied");
      return options.registration;
    }),
    addEventListener(_type: "controllerchange", fn: () => void): void {
      listeners.add(fn);
    },
    fireControllerChange(): void {
      for (const fn of listeners) fn();
    },
  };
}

/** A signed-in-looking host with a controller, i.e. an UPDATE rather than a first install. */
function updatingHost(registration: FakeRegistration): FakeHost {
  return fakeHost({
    controller: fakeWorker(),
    registration,
    registerRejects: false,
  });
}

function mount(): HTMLElement {
  document.body.innerHTML = `<div id="root"></div>`;
  document.documentElement.removeAttribute("data-pwa");
  const root = document.getElementById("root");
  if (root === null) throw new Error("fixture did not mount");
  return root;
}

function banner(): HTMLElement | null {
  return document.querySelector(`[data-testid="${UPDATE_BANNER_TESTID}"]`);
}

/** Lets the `register().then(...)` chain settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("registerServiceWorker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("registers a URL relative to the deployment base, not the origin root", async () => {
    // `/next/sw.js` and `/sw.js` are different registrations with different
    // SCOPES, and this origin serves three surfaces. An origin-root scope
    // would put this worker in front of `/` and `/tab/` as well - two apps
    // whose assets it has never heard of.
    const host = updatingHost(fakeRegistration(null));
    registerServiceWorker({ container: mount(), serviceWorker: host });
    await settle();

    expect(host.register).toHaveBeenCalledTimes(1);
    // Asserted as the RESOLUTION rather than a literal: jsdom's document base
    // is the origin root, so a hardcoded "/sw.js" would pass a literal check
    // here and still register at the wrong scope on a `/next/` deployment.
    expect(host.register).toHaveBeenCalledWith(
      new URL("sw.js", document.baseURI).href,
      { scope: "./" },
    );
  });

  it("says so on the document when there is no service worker at all", () => {
    registerServiceWorker({ container: mount(), serviceWorker: undefined });
    expect(document.documentElement.dataset.pwa).toBe("unsupported");
    expect(banner()).toBeNull();
  });

  it("does not throw when registration is REJECTED", async () => {
    // The real path in a storage-denied third-party frame - which is the Teams
    // tab configuration this bundle already handles elsewhere. No offline
    // support is a degradation; an exception out of bootstrap is an outage.
    const host = fakeHost({
      controller: null,
      registration: fakeRegistration(null),
      registerRejects: true,
    });
    registerServiceWorker({ container: mount(), serviceWorker: host });
    await settle();

    expect(document.documentElement.dataset.pwa).toBe("unavailable");
    expect(banner()).toBeNull();
  });

  it("does NOT offer an update on a first install", async () => {
    // `controller === null` means nothing was controlling this page, so there
    // is no old version to move off. Offering one would be a banner every new
    // user sees on their first visit, about the version they are already on.
    const registration = fakeRegistration(null);
    const host = fakeHost({
      controller: null,
      registration,
      registerRejects: false,
    });

    registerServiceWorker({ container: mount(), serviceWorker: host });
    await settle();
    const worker = fakeWorker();
    registration.fireUpdateFound(worker);
    worker.becomeInstalled();

    expect(banner()).toBeNull();
  });

  it("offers the update once a NEW worker finishes installing", async () => {
    const registration = fakeRegistration(null);
    const host = updatingHost(registration);

    registerServiceWorker({ container: mount(), serviceWorker: host });
    await settle();
    const worker = fakeWorker();
    registration.fireUpdateFound(worker);

    // Still installing: nothing to activate yet, so nothing to offer.
    expect(banner()).toBeNull();

    worker.becomeInstalled();

    const shown = banner();
    expect(shown?.textContent).toContain(UPDATE_BANNER_TEXT);
    expect(shown?.querySelector("button")?.textContent).toBe(
      UPDATE_BANNER_ACTION,
    );
  });

  it("offers an update that was already waiting when the page loaded", async () => {
    // A worker that installed during a previous visit and was never activated
    // fires no `updatefound` this time round. Without this branch the user is
    // stuck on the old build until they close every tab.
    registerServiceWorker({
      container: mount(),
      serviceWorker: updatingHost(fakeRegistration(fakeWorker())),
    });
    await settle();

    expect(banner()).not.toBeNull();
  });

  it("asks the worker to activate, then reloads once it takes control", async () => {
    const waiting = fakeWorker();
    const host = updatingHost(fakeRegistration(waiting));
    const reload = vi.fn();

    registerServiceWorker({ container: mount(), serviceWorker: host, reload });
    await settle();

    banner()?.querySelector("button")?.click();

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled(); // not until the worker takes over

    host.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload on a controller change the user never asked for", async () => {
    // The retired client shipped this bug: its worker called `clients.claim()`
    // on first install, which fires `controllerchange` with no previous worker
    // to update from, and an unconditional handler reloaded the page once for
    // every user with nothing to show them. `sw.ts` no longer claims - this is
    // the second, independent guard, because "nothing else fires this event"
    // is the kind of premise that quietly stops being true.
    const host = updatingHost(fakeRegistration(null));
    const reload = vi.fn();

    registerServiceWorker({ container: mount(), serviceWorker: host, reload });
    await settle();

    host.fireControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it("shows only one banner however many times an update is offered", async () => {
    const registration = fakeRegistration(fakeWorker());
    const host = updatingHost(registration);

    registerServiceWorker({ container: mount(), serviceWorker: host });
    await settle();
    const second = fakeWorker();
    registration.fireUpdateFound(second);
    second.becomeInstalled();

    expect(
      document.querySelectorAll(`[data-testid="${UPDATE_BANNER_TESTID}"]`),
    ).toHaveLength(1);
  });
});
