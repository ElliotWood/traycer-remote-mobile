# Teams app package

## The tab points at `/next/`, and there is only one of it

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
