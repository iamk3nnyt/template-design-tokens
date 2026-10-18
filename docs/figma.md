# Figma ↔ code

Figma file: <link>. A change to the code or to the file isn't done until the other one matches.

## Source of truth
`design-tokens.json` is the design system. Never hand-edit the generated CSS or TS.

1. Change a value, or add a token, in `design-tokens.json`.
2. `npm run tokens` regenerates the CSS (`@theme` + `type-*` utilities) and TS.
3. Ask Claude to **sync Figma tokens** (the `figma-sync` skill). It diffs and updates the variables and styles named by each token's `figma` field, with the WEB code syntax set to the CSS variable.
4. If screens changed, ask Claude to **re-capture** them (the `figma-capture` skill).

| design-tokens.json | Figma | Tailwind |
|---|---|---|
| `primitives` | `Primitives` collection (hidden from publishing) | not used directly |
| `color.<name>` | `Color` collection, e.g. `text/body`, aliased to a primitive | `text-ink`, `bg-surface`, … |
| `radius.<name>` | `Radius` collection, `radius/<name>` | `rounded-<name>` |
| `shadow.<name>` | effect styles `Shadow/<figma>` | `shadow-<name>` |
| `type.<name>` | text styles `Type/<figma>` (+ `… Desktop` when `md` is set) | `type-<name>` |

## Rules for components
- No hex values, palette colours (`bg-blue-500`), `/opacity` on colours, `rounded-[..]`, `text-sm` or `font-bold`: use the token utility. `npm run tokens:check` enforces this, so wire it into lint.
- Each Figma component's description names its code file, e.g. `components/ui/button.tsx`. Code Connect needs an Org plan; this replaces it.

## Components
| Figma component | Code | Variants → props |
|---|---|---|
| Button | `components/ui/button.tsx` | Variant=Primary/Secondary/Ghost → `variant` |
