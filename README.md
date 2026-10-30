# Working Titles

**[workingtitles.nyc](https://workingtitles.nyc)**: years of NYC film shoot notices I've photographed, put on a map. Each entry shows the codename on the sign next to what the production really was, with Letterboxd and IMDb links.

These are just my own finds, for fun.

## Adding finds

```bash
npm install
# drop photos (JPEG/PNG; export HEIC as JPEG) into photos/inbox/
npm run ingest
```

To have Claude read and decode the signs, put `ANTHROPIC_API_KEY=sk-ant-...` in `.env.local`. Ingest then does two passes per new photo, once only:

1. **Read the sign** (vision): the title as printed, production company, dates, streets and contact.
2. **Match** (web search): decides whether the title is a codename, finds the real production, and stores a confidence plus 1–3 sources. Only URLs the search actually returned are kept. 80%+ confidence with a source becomes `decoded`, 35%+ becomes `hunch`, and anything lower is `unknown`.

`npm run decode-missing` decodes entries added before the key was set. `node --env-file=.env.local scripts/ingest.mjs --redecode <id>` re-runs one entry.

`ingest` also pulls GPS and the capture date from each photo's EXIF data. It saves a resized copy with the metadata stripped to `public/photos/`, then adds a stub row to `data/notices.json` with the codename as `TBD` and the status as `unknown`. Then edit the JSON:

| field | |
|---|---|
| `codename` | the name on the sign |
| `realTitle`, `kind`, `year` | what it turned out to be |
| `status` | `decoded` · `hunch` · `unknown` |
| `letterboxd`, `imdb` | links |
| `place`, `borough` | cross streets etc. |
| `notes` | anything |

Delete the three `"example": true` rows once real data is in.

## Stack

Next.js · MapLibre GL with CARTO Positron tiles (no API key) · data is a JSON file in the repo · deployed on Vercel.

```bash
npm run dev
```
