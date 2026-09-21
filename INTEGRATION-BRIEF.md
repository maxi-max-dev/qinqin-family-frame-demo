# UNSEEN Frame: independent family account prototype

User direction, 2026-09-21: UNSEEN remains the main product. Develop Frame in a separate worktree and at `unseenframe.maxxam.xyz`, reuse the same account system, and exercise a dedicated demo family with multiple logged-in demo accounts.

## Scope

- Worktree: `/Users/max/Documents/Codex/2026-09-21/unseen-frame-family-accounts`
- Branch: `codex/unseen-frame-family-accounts-20260921`
- Start from the static Frame demo at `902d75683816a662f671bc763596d05f64569dcd`.
- Keep the existing Frame visual language and direct elder/family interaction.
- Reuse current UNSEEN authentication and private-space membership APIs if they satisfy the workflow. Prefer a dedicated private Space presented as a family group over a new group database.
- Distinguish shared account identity from cross-domain automatic sign-in. Do not broaden cookie scope or change main-product authentication for this prototype.
- Keep existing UNSEEN production code, deployed releases, users' spaces, and backend schema intact. Any test writes must be restricted to explicitly identified synthetic accounts and their dedicated demo family.
- No real outgoing calls, email invitations, paid generation, or messages to real people. Existing mocked calls must stay visibly simulated.
- Do not embed credentials or private fixture data in published static files, screenshots, reports, commits, or browser URLs.

## Acceptance

1. Each of at least two demo accounts signs in through the actual login flow in independent browser contexts.
2. A dedicated demo family has explicit membership; a user outside that family cannot read or mutate its photos/messages.
3. A family account uploads an ordinary demo image; a separately authenticated elder account sees it through the shared server.
4. A family message and an elder reply are persisted and visible to the other account after reload; they are associated with the intended photo where supported.
5. The elder view shows new-content reminders and a usable read/reply flow. Browser-only demo state must not be mistaken for server-synced state.
6. Logout/account switching clears private UI state and stops authenticated polling.
7. The existing UNSEEN entry and backend health remain unchanged by the new frontend rollout.

## Publication prerequisite

The last verified DNS state for `unseenframe.maxxam.xyz` had no A record. Recheck before publication. Intended record is `A unseenframe -> 43.132.167.200`. A localhost preview or a Host-header override is not public-domain acceptance.
