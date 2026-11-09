# Working Titles — notes for Claude Code

A personal, just-for-fun site: NYC film shoot notices I've photographed over the years, put on a map. Each entry shows the **codename on the sign** next to **what it really was**, with a confidence score, sources, and Letterboxd/IMDb links.

- Live: https://workingtitles.nyc (Vercel project `workingtitles`, account `deepcshahs-projects`)
- Repo: github.com/deepcshah/workingtitles, public. Every push to `main` deploys to production.
- Plans and next steps: **[ROADMAP.md](./ROADMAP.md)**. Read it before starting work.

## Stack
- Next.js 16 (App Router), React 19, TypeScript, plain CSS (`app/globals.css`), no Tailwind
- MapLibre GL with CARTO Positron tiles (no API key)
- Data: `data/notices.json`, read at build time. No database yet.
- Photos: `public/photos/<id>.webp`, resized and with metadata stripped by the ingest script
- Claude: `@anthropic-ai/sdk`, used only in `scripts/` (local), not at runtime

## Map of the code
| Path | What |
|---|---|
| `app/page.tsx` | Loads `notices.json`, sorts newest first, renders `<Explorer>` |
| `components/Explorer.tsx` | Client component: map, search and filter list, detail panel (confidence meter, sources) |
| `lib/types.ts` | `Notice` type: the source of truth for the data shape |
| `scripts/ingest.mjs` | `photos/inbox/` → EXIF (GPS and date) → webp → Claude decode → append to JSON |
| `scripts/decode.mjs` | `readSign()` (vision, forced tool call) and `matchTitle()` (web search, then the `record_match` tool), plus `statusFor()` |

## Commands
```bash
npm run dev               # local site
npm run build             # must pass before pushing: Vercel runs the same build
npm run ingest            # process photos/inbox/* (needs ANTHROPIC_API_KEY in .env.local to decode)
npm run decode-missing    # decode entries that have a photo but no `match` yet
node --env-file=.env.local scripts/ingest.mjs --redecode <id>
```

## Conventions and decisions (keep these unless Deep says otherwise)
- **The decode runs once per photo** and its result is stored. Never re-run it automatically on build or page view.
- **Never store an invented URL.** Sources are filtered to URLs the web search actually returned. If no real IMDb or Letterboxd page was found, fall back to a *search* link, never a guessed title ID.
- **Status comes from confidence:** `decoded` means at least 0.8 confidence and at least one source; `hunch` means at least 0.35; anything lower is `unknown`. See `statusFor()`.
- `match.isCodename === false` means the sign showed the real title. The UI then says "Not a codename: filmed under its real title".
- Strip all EXIF from published photos (sharp does this by default). The GPS goes into the JSON, not the image.
- Three `"example": true` rows in `notices.json` are placeholders. Delete them once real data is in.
- Visual style: a paper and ink "posted notice" look. Off-white `#f5f2ea`, black, highlighter yellow `#ffd400`, amber for hunches, condensed uppercase headings. Keep it.
- `.env*.local` is gitignored. Never commit keys.
