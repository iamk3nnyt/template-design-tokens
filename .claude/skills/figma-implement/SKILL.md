---
name: figma-implement
description: Implements a Figma frame or component as code in this project. It pulls token changes first, reads the design with the Figma MCP get_design_context, translates every Figma variable or style into the project's token utilities via `tokens.mjs map`, reuses mapped components from docs/figma.md, and verifies with the tokens lint gate plus a screenshot comparison. Use when given a figma.com link or node to build, or asked to "implement/build this from Figma".
argument-hint: <figma url or node id> [target file]
---

# figma-implement

Design: $ARGUMENTS
Load Figma's `figma-design-to-code` skill before calling `get_design_context`; its rules on screenshots, sparse responses and assets apply here too.

## 1. Tokens first
If the design uses new or changed values, bring them into code before writing components:
```bash
node scripts/tokens.mjs figma-export-script > /tmp/figma-export.js
```
Run that with `use_figma` (read-only) and save the returned JSON to `/tmp/figma-state.json`. Then:
```bash
node scripts/tokens.mjs pull /tmp/figma-state.json            # review the edits
node scripts/tokens.mjs pull /tmp/figma-state.json --write && node scripts/tokens.mjs build
```
New colour keys are auto-named from the Figma name (`accent/warm` → `accent-warm`). Rename the key if the CSS name should differ. Pull never deletes; it reports code-only tokens instead.

## 2. Read the design
`get_design_context` on the node, with a screenshot. That screenshot is the visual target. Parse the URL as `figma.com/design/<fileKey>/…?node-id=1-2` → nodeId `1:2`.

## 3. Translate to tokens (never paste raw values)
```bash
node scripts/tokens.mjs map
```
This gives the Figma name → CSS variable and Tailwind utility:
- `Color` variables, e.g. `text/body` → `text-ink`, `bg-…`, `border-…`
- `radius/card` → `rounded-card`
- `Shadow/sm` → `shadow-sm`
- `Type/Body` → `type-body`, which carries size, line height, weight and tracking (don't add `text-*`/`font-*`)
- `Type/<X> Desktop` → the same `type-<x>` utility, since the md size is built in

**Unbound values** (raw hex or px in the design):
- A hex that's in `hexToColorTokens` → use that token. If several tokens share it, pick by role (text vs surface).
- A hex that isn't in the map → **stop and ask**: either it's a new token (have the designer bind it in Figma, then pull) or it's a design mistake.
- Spacing and sizes use Tailwind's default scale, rounded to the nearest step. Mention any rounding over 2px.

## 4. Build
- **Components:** check the component table in `docs/figma.md` and the component's Figma description, which names its code file. Reuse and extend those; never re-create a mapped component from raw markup.
- **Layout:** turn absolute positioning into flex/grid. Identify what's interactive (links, buttons, inputs) and wire it up.
- **Assets:** follow `figma-design-to-code`. Download them into the project and leave no temporary Figma URLs.
- **Scope:** build exactly the requested node. No extra states, sections or props.

## 5. Verify
```bash
node scripts/tokens.mjs check
```
This must pass: no hex values, palette colours or raw `text-sm`/`rounded-lg`. Then render the page in the dev server (never a production build), screenshot it at the frame's width, and compare it with the design screenshot side by side. If the `ui-audit` toolkit from claude-skills is installed, use `diff.mjs` for a pixel diff. Fix spacing, type and colour mismatches. Report the remaining differences, such as font rendering or dynamic data.

If the project keeps Figma in sync, add the component to the table in `docs/figma.md` and put its code path in the Figma component's description.

## Exit criteria
- [ ] Tokens pulled (or confirmed unchanged), and `tokens check` passes.
- [ ] Only token utilities in the new code, with every unbound value resolved or asked about.
- [ ] Mapped components reused, assets local, and interactivity wired.
- [ ] Visual comparison done. Report in one sentence with any known differences.
