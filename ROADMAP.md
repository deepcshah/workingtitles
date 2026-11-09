# Roadmap

_Last updated: Nov 8, 2026_

## Where it stands
- [x] Name chosen (**Working Titles**) and domain bought (**workingtitles.nyc**). Repo is connected to Vercel and auto-deploys on push.
- [x] Map, list with search and status filters, and a detail panel (sign → real title, confidence, reasoning, sources, links)
- [x] Ingest script: EXIF GPS and date → resized webp with metadata stripped → JSON entry
- [x] Claude decode at ingest. Step 1 reads the sign (vision); step 2 matches it with web search. The result is stored once.
- [x] `ANTHROPIC_API_KEY` added to Vercel project settings, but nothing on Vercel uses it yet (see Option B)
- [ ] **No real photos ingested yet.** The decode pipeline has never run against a real sign.

## Next up (in order)

### 1. Get real data in, locally
1. Put the key in `.env.local`. Either use `npx vercel link`, then `npx vercel env pull .env.local` (if the key is marked Sensitive in Vercel it pulls down blank), or paste `ANTHROPIC_API_KEY=sk-ant-…` in by hand.
2. Export a first batch of about 10 sign photos as JPEG. iPhone HEIC isn't supported by sharp's prebuilt binary. Drop them in `photos/inbox/` and run `npm run ingest`.
3. **Check the output against reality:**
   - Is the sign text read correctly, especially the title and production company?
   - Are the confidence scores calibrated? Look for high scores that are wrong, and correct matches that were scored low.
   - Do the sources actually support the match?
   - Adjust the prompts in `scripts/decode.mjs` and the thresholds in `statusFor()` based on what you find.
4. Fix entries by hand in `notices.json` where needed: lat/lng for photos without GPS, `place`, and `borough`.
5. Delete the three `example` rows and push.

### 2. Decide: keep it local, or move decoding onto Vercel (Option B)
**Option A (current):** photos come in via `npm run ingest` on the laptop, and the repo's JSON file is the database. It's simple and free, and it's fine for batch-adding the backlog.

**Option B:** upload from your phone and decode on Vercel. This is what makes the Vercel API key useful. It needs:
- Upload page `/add`: pick or take a photo, then add a location. iOS often strips GPS on browser upload, so offer "use my current location" plus dropping a pin on the map as fallbacks. Read EXIF on the client with `exifr` before upload when it's there.
- **A lock, so strangers can't spend API credits.** Start with a single upload passcode stored in a Vercel env var (for example `UPLOAD_PASSCODE`), set as an httpOnly cookie. Full auth (Auth.js with GitHub, allowing only Deep) can come later if wanted.
- Storage: **Vercel Blob** for photos and **Postgres** (Neon via the Vercel Marketplace) for entries. Migrate `notices.json` into it.
- Server route that resizes the image (sharp), stores it in Blob, runs `readSign()` and `matchTitle()` from `scripts/decode.mjs` (move them into `lib/`), and writes a **draft**.
- `/review` page behind the same passcode: edit fields, confirm or override the match, publish.
- Note: web search makes `matchTitle()` slow (tens of seconds). Run it in the background with `after()` or a queue, and show "decoding…" on the draft.
- Optional: route Claude calls through **Vercel AI Gateway**, with your own Anthropic key, for usage tracking.

## Ideas / later
- **Clue boost for decoding:** the production company or LLC name is usually the strongest clue. Consider a lookup table of LLC → show that grows from confirmed decodes, so repeat productions are free and certain.
- "Same production, multiple sightings": group entries by real title and draw them as a cluster or connected path on the map.
- Filters by year, borough, and kind (film, TV, commercial); a timeline scrubber.
- Stats: % decoded, most-spotted production, busiest blocks.
- Pin clustering once there are hundreds of pins.
- Mark crew parking arrow signs (the cryptic arrow signs with initials) as a second sign type linked to the main notice.
- Share cards: OG image per notice showing "sign → real title".
- Mobile polish: bottom sheet instead of the stacked panel.
- Letterboxd: link to Deep's own review if he's logged the film.

## Open questions
- Option A or B, and when?
- Public from day one, or keep the domain quiet until the backlog is in?
- Should hunches be shown publicly, or only decoded entries plus "unknown"?
