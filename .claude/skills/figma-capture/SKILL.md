---
name: figma-capture
description: Re-captures changed app screens into the project's Figma file, at desktop width and in a 390px mobile wrapper, from a dev server running against seeded fake data, replacing the old frames in place. Use after a UI commit in a project that keeps Figma in sync with code, or when asked to "update Figma screens" or "capture pages to Figma".
argument-hint: [routes…]
---

# figma-capture

Routes: $ARGUMENTS (default: routes touched since the last capture, from `git diff --name-only` mapped to `app/**/page.tsx`)
Kit: `figma-capture/README.md`. Figma file: `docs/figma.md`.

## Safety (non-negotiable)
- **Never capture production data.** Check the app's env: if the database URL isn't localhost, stop and set up the seeded local DB from the kit README.
- Dev-login routes and the injected capture script are temporary and never committed. Finish with a clean `git status`.

## Steps
1. Inject `capture.js` (plus the reveal override if the site animates on scroll) into the root layout, as in the kit README. Start `next dev`.
2. Find the target frames in Figma (read-only `use_figma`: the page's sections/frames by route name) and note their ids and positions.
3. For each route, get a capture id from the Figma MCP (`generate_figma_design` capture flow; load `figma-generate-design` first). Then run:
   - desktop: `./figma-capture/open.sh <base> <route> <captureId> [delayMs]`;
   - mobile: `BASE=<base> ./figma-capture/mobcap.sh <route>=<captureId>` (wrapper served on :3200).

   Do one route at a time and wait for each submit. Use about 9000 ms delay for client-rendered pages.
4. Swap each new frame into the old one's place, with the same name, parent section and x/y. Delete the old frame only after the new one has arrived.
5. Check every new frame:
   - a mobile frame wider than 390 is a real overflow bug, so report it;
   - blank areas mean the reveal override is missing;
   - wrong data means the wrong DB.
6. Clean up as described in the kit README.

## Exit criteria
- [ ] Every requested route has been captured at both widths and swapped in place.
- [ ] No production data was used, and `git status` is clean, with no capture script or dev-login left behind.
- [ ] One sentence: N frames updated, plus any overflow bugs found.
