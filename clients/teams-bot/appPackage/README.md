# Teams app package

## Two tabs: the app at `/next/`, and Help at `/help/`

The section below argues for exactly one tab, and that argument still holds
**for entries into the app**. The Help tab is not one: it is a static
explainer served from our own origin at `/help/`, with no auth, no host
access and no router. It does not boot the SPA, so it is not "a second entry
to somewhere the first one can already reach".

Source: `clients/teams-help/`. It is hand-written HTML/CSS/SVG with no build
step and no dependencies, deployed by `clients/teams-help/deploy/vm-install-help.sh`.

**`contentUrl` carries `?theme={theme}` and `websiteUrl` does not.** Teams
substitutes `{theme}` (the TeamsJS **v1** placeholder name — mobile Teams
supports only the v1 names, so `{app.theme}` would silently fail there) with
`default`, `dark`, `glass` or `contrast` before requesting the page. That
gives the help page a correct theme on its very first paint without a
teams-js handshake, which matters because the page must render even when the
handshake never completes. `websiteUrl` is the "open in a browser" target,
where there is no Teams to ask, so it is left plain and the page falls back
to the OS colour-scheme preference.

`make-package.mjs` needed **no change** — its substitution loop already
iterates every entry in `staticTabs`, and `validDomains` is derived from the
same `tabHost`, so one host covers both tabs.

## The app tab points at `/next/`, and there is only one of it

`staticTabs` used to declare two tabs, `Waiting on you` and `Epics`, both under
`/tab/` — the hand-built `clients/teams-tab` surface. **That package was deleted
from the trunk on 2026-08-05** (`cb1edae3`) when the epic converged on one UI:
upstream's responsive `gui-app`, served at `/next/`, behind thin shells. The
manifest kept pointing at the retired surface, so anyone who packaged and
installed this would have got the dead tab.

**Why one tab and not two.** The two-tab split came from the Fluent plan, where
the tab was a purpose-built two-screen surface and Teams' top-level nav was the
only navigation it had. `/next/` is the whole app and brings its own navigation,
so a second Teams entry would boot the same SPA again to land somewhere the
first one can already reach. There is also no `waiting` route in upstream's
router to point a second entry at.

**Deep links are a `#` fragment, not a path.** `/next/` is a subpath deploy, and
gui-app switches to hash history there (`clients/gui-app/src/router.tsx`) —
browser history plus a router `basepath` puts router-core and the history
subscriber set into a feedback loop that never converges. So a future
epic-specific tab is `…/next/#/epics/<id>`, never `…/next/epics/<id>`.

## T1 skeleton notes


Schema `manifestVersion` **1.25** (required for channel-enabled apps from July
2026 — see the epic brief). This is the manifest shape for the bot skeleton
only; assembling the installable `.zip` (icons, admin submission, install
scoped to one user) is ticket T0c's scope ("App package + admin approval"),
not this ticket's.

**Placeholders, replace before packaging:**

- `id`, `bots[0].botId` — the bot's real Azure App ID (all-zero GUID here, not a real one)
- `developer.*` — real developer name and URLs
- `color.png` (192×192) / `outline.png` (32×32, transparent) — not included; no brand asset exists yet, and generating a placeholder image isn't this ticket's job either

**Deliberately absent, not "forgotten":**

- No `copilotAgents` section — the M365 Copilot channel doesn't support
  `Action.Execute`, which the entire action surface depends on (rubric §3).
  Channel selection itself happens at Azure Bot Service registration, not in
  this file; this manifest just doesn't declare Copilot-agent behavior.
- `scopes: ["personal"]` only — matches the admin-request's ask ("Specific
  users: me"), not team/group scope. Widen only if the user's install target changes.
- ~~`validDomains: []` — nothing to add until a tab or message-extension link exists (T5/T6, out of this round's scope).~~ **Superseded:** `validDomains` now carries the tab host, substituted from `local-ids.json` by `make-package.mjs` like every other deployment fact.
