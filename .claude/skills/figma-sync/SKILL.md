---
name: figma-sync
description: Syncs design-tokens.json with the project's Figma file. It generates a Plugin API script from the tokens, dry-runs it through the Figma MCP use_figma tool to diff variables, effect styles and text styles, then applies the agreed direction, keeping the WEB code syntax equal to the CSS variables. Use after editing design-tokens.json, when Figma variables were changed by a designer, or when asked to "sync tokens/Figma".
argument-hint: [to-figma | from-figma]
---

# figma-sync

Direction: $ARGUMENTS (default: to-figma, since code is the source of truth)
Figma file: read the link from `docs/figma.md`.

Load the Figma `figma-use` skill before any `use_figma` call, plus `figma-generate-library`, because this writes variables and styles.

## 1. Validate and build
```bash
node scripts/tokens.mjs build && node scripts/tokens.mjs check
```
Fix validation errors first. Stale outputs and lint failures are code problems, not Figma problems.

## 2. Dry run (read-only)
```bash
node scripts/tokens.mjs figma-script > /tmp/figma-sync-dry.js
```
Run the file's contents with `use_figma` exactly as generated (it's top-level await + return, so don't wrap it). It returns `{ applied: false, changes: [...] }`:
- `+` exists in the tokens, missing in Figma;
- `~` value, code syntax or style properties differ;
- `!` a font weight isn't available in Figma (install the font, or fix the token).

Also list Figma variables that **aren't** in the tokens with a short read-only script (`figma.variables.getLocalVariablesAsync()`, names per collection). Those are designer additions or leftovers.

## 3. Decide direction
- **to-figma:** the tokens win. Show the change list in one line per group and apply.
- **from-figma:** a designer changed values in Figma. Run `node scripts/tokens.mjs figma-export-script` with `use_figma` (read-only), save the returned JSON to `/tmp/figma-state.json`, then run `node scripts/tokens.mjs pull /tmp/figma-state.json`. Review the edits, re-run with `--write`, then `build` + `check`, and show the git diff. A second pull must report "already matches".
- **Mixed:** ask which side wins for each conflicting token. Never delete Figma variables or styles unasked; just report extras.

## 4. Apply
```bash
node scripts/tokens.mjs figma-script --apply > /tmp/figma-sync-apply.js
```
Run it with `use_figma`, then dry-run again. It must return `changes: []`.

## Gotchas
- Tested end to end on a scratch file: the first apply creates 3 collections, 38 variables, 2 effect styles and 9 text styles. The second dry run returns `changes: []`.
- Colour tokens with `alpha` can't alias a primitive, so they hold the resolved RGBA value. Re-sync after changing that primitive.
- If you bind a paint with `setBoundVariableForPaint`, also write the resolved colour into the paint. Otherwise the component renders black outside instances.
- Text styles: mobile size is the default style. `md` overrides become `<Name> Desktop`.
- The Figma MCP read tools are rate-limited on Pro plans, so batch the reads.

## Exit criteria
- [ ] `tokens check` passes, and a second dry run returns no changes.
- [ ] No Figma variables or styles deleted without the user's OK. Extras reported.
- [ ] One-sentence summary: N created, M updated, plus anything skipped.
