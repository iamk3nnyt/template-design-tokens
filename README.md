# template-design-tokens

A drop-in design-system foundation for Next.js + Tailwind v4 projects that keep a Figma file in sync with code.

- **`design-tokens.json`** is the single source of truth: primitives, semantic colours, radii, shadows, the type scale and fonts. Each token names its Figma counterpart.
- **`scripts/tokens.mjs`** has no dependencies:
  - `build` → `@theme` CSS + `type-*` utilities + a TS colour map;
  - `check` → validation, a stale-output check, and a lint gate that rejects hex, palette colours, `rounded-lg`, `text-sm`, `font-bold` and similar in components;
  - `figma-script` → a Figma Plugin API script that diffs (dry run) or upserts (`--apply`) variables, effect styles and text styles, with WEB code syntax = the CSS variable.
- **`figma-capture/`** re-captures running screens into Figma at desktop width and in a 390px mobile wrapper.
- **`.claude/skills/`** contains `figma-sync` and `figma-capture`, which Claude Code drives through the Figma MCP.
- **`docs/figma.md`** is a mapping doc to fill in: token ↔ Figma ↔ Tailwind, and component ↔ file.

## Adopt in a project
```bash
cp -R design-tokens.json design-tokens.schema.json scripts figma-capture docs .claude <your-project>/
```
1. Edit `$config` (output paths, the dirs to scan) and replace the example brand.
2. Add scripts: `"tokens": "node scripts/tokens.mjs build"` and `"tokens:check": "node scripts/tokens.mjs check"`. Append `&& npm run tokens:check` to `lint`.
3. Import the generated CSS after Tailwind: `@import "tailwindcss"; @import "./tokens.css";`.
4. Put the Figma link in `docs/figma.md`, then ask Claude to "sync tokens to Figma".

Silence a single deliberate exception with a `// tokens-ignore-line` comment.

## Requirements
- Node ≥ 20.11
- Tailwind CSS v4
- For the Figma parts: Claude Code with the Figma MCP connected, and edit access to the file.

## Licence
MIT
