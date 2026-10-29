# Working Titles

**[workingtitles.nyc](https://workingtitles.nyc)**: years of NYC film shoot notices I've photographed, put on a map. Each entry shows the codename on the sign next to what the production really was, with Letterboxd and IMDb links.

These are just my own finds, for fun.

## Adding finds

```bash
npm install
# drop photos (JPEG/PNG; export HEIC as JPEG) into photos/inbox/
npm run ingest
```

`ingest` pulls GPS and the capture date from each photo's EXIF data. It saves a resized copy with the metadata stripped to `public/photos/`, then adds a stub row to `data/notices.json` with the codename as `TBD` and the status as `unknown`. Then edit the JSON:

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
