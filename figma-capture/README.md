# Figma capture kit

This kit re-captures real, running screens into the Figma file through the Figma MCP's html-to-design capture. The `figma-capture` skill drives it.

## Rules
- **Never capture against production data.** Point the app at a local database seeded with fake data, especially anything with personal or health data.
- **Dev-login routes are temporary.** If you need authenticated screens, add a route that mints a session for a seeded user and refuses to run unless `NODE_ENV !== "production"` **and** the database URL is localhost. Delete it after capturing, and don't commit it.
- **One browser tab at a time.** Background tabs are throttled and never submit.

## Steps
1. **Inject the capture script** temporarily in the root layout's `<head>`:
   ```tsx
   <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
   ```
   If the site animates content in on scroll (reveal/fade-in), add an override too, or everything below the fold captures blank:
   ```tsx
   <style>{`[data-reveal]{opacity:1!important;transform:none!important;transition:none!important}`}</style>
   ```
2. **Run the dev server** (`next dev`). Never a production build.
3. **Desktop:** run `./open.sh http://localhost:3000 /pricing <captureId> [delayMs]` once per route, with a capture id from the Figma MCP. Client-rendered pages need a longer delay (around 9000).
4. **Mobile:** run `python3 -m http.server 3200` here, then `BASE=http://localhost:3000 ./mobcap.sh /pricing=<id> /about=<id>`. A frame that comes out wider than 390 means the page really does overflow on phones.
5. **Replace frames:** the new frame replaces the old one, keeping the same name and position.
6. **Clean up:** remove the script tag and override, the dev-login route and the seeded `.env.local`, so the repo is back to a clean `git status`.
