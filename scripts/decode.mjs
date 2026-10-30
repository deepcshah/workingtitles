/**
 * Two-step decode, run once per photo at ingest time:
 *   1. readSign()   — Claude vision reads the notice: title, company, dates, streets…
 *   2. matchTitle() — Claude + web search decides whether that title is a codename
 *                     and, if so, what the production really is. Returns a confidence
 *                     and 1–3 sources, filtered to URLs the search actually returned.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.WT_MODEL ?? "claude-sonnet-5-5";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// ---------- 1. read the sign ----------

const SIGN_TOOL = {
  name: "record_sign",
  description: "Record what is printed on the film shoot notice in the photo.",
  input_schema: {
    type: "object",
    properties: {
      is_shoot_notice: { type: "boolean", description: "Is this actually a film/TV/commercial shoot notice?" },
      sign_title: { type: "string", description: "Production title as printed on the sign, verbatim. Empty if none." },
      production_company: { type: "string", description: "Production company / LLC named on the sign, if any." },
      shoot_dates: { type: "string", description: "Dates/times of shooting or parking restrictions, as printed." },
      location_text: { type: "string", description: "Streets / cross streets / addresses printed on the sign." },
      contact: { type: "string", description: "Phone number, email or location manager name, if printed." },
      other_text: { type: "string", description: "Any other notable text (permit number, network, crew codes)." },
      legibility: { type: "number", description: "0–1, how confidently the title text was read." },
    },
    required: ["is_shoot_notice", "sign_title", "legibility"],
  },
};

export async function readSign(imageBuffer, mediaType = "image/webp") {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [SIGN_TOOL],
    tool_choice: { type: "tool", name: "record_sign" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBuffer.toString("base64") } },
          {
            type: "text",
            text:
              "This is a photo of a notice posted on a New York City street, usually announcing a film/TV shoot and parking restrictions. " +
              "Transcribe exactly what it says. Don't guess at text you can't read; leave fields empty instead.",
          },
        ],
      },
    ],
  });
  const call = res.content.find((b) => b.type === "tool_use");
  return call?.input ?? null;
}

// ---------- 2. match the title ----------

const MATCH_TOOL = {
  name: "record_match",
  description: "Record your conclusion about what production this shoot notice was for. Call exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      is_codename: {
        type: "boolean",
        description: "true if the sign title is a working/fake title different from the released title; false if the sign shows the real title.",
      },
      real_title: { type: "string", description: "The production's actual (released or announced) title. Empty if unknown." },
      kind: { type: "string", enum: ["film", "tv", "commercial", "music-video", "other"] },
      year: { type: "integer", description: "Release (or expected release) year, if known." },
      confidence: {
        type: "number",
        description:
          "0–1 probability that real_title is correct. 0.9+ only when a source explicitly ties the sign title or company to the production.",
      },
      reasoning: { type: "string", description: "One or two sentences on what linked them." },
      sources: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: { title: { type: "string" }, url: { type: "string" } },
          required: ["url"],
        },
        description: "1–3 URLs from your search results that best support the match.",
      },
      imdb_url: { type: "string", description: "IMDb title URL, only if it appeared in search results." },
      letterboxd_url: { type: "string", description: "Letterboxd film URL, only if it appeared in search results." },
    },
    required: ["is_codename", "confidence", "reasoning", "sources"],
  },
};

export async function matchTitle(sign, { spottedAt, place } = {}) {
  const facts = [
    `Title on sign: ${sign.sign_title || "(unreadable)"}`,
    sign.production_company && `Production company: ${sign.production_company}`,
    sign.shoot_dates && `Dates on sign: ${sign.shoot_dates}`,
    spottedAt && `Photo taken: ${spottedAt}`,
    (sign.location_text || place) && `Location: ${sign.location_text || place}, New York City`,
    sign.contact && `Contact: ${sign.contact}`,
    sign.other_text && `Other text: ${sign.other_text}`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    {
      role: "user",
      content:
        "A film shoot notice was photographed in New York City. Productions often film under a fake working title " +
        "(e.g. Return of the Jedi shot as \"Blue Harvest\"), but sometimes the sign shows the real title.\n\n" +
        facts +
        "\n\nSearch the web to work out which production this was. Useful angles: the title + 'working title' or 'filming NYC'; " +
        "the production company/LLC name (single-purpose LLCs often map to one show); local filming coverage around those dates " +
        "(e.g. On Location Vacations, Patch, Gothamist, fan sites, trade press). Then call record_match once. " +
        "Be calibrated: a plausible guess with no source tying it to this sign should be below 0.5.",
    },
  ];

  const seenUrls = new Set();
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }, MATCH_TOOL],
      messages,
    });

    for (const block of res.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        block.content.forEach((r) => r.url && seenUrls.add(r.url));
      }
    }

    const call = res.content.find((b) => b.type === "tool_use" && b.name === "record_match");
    if (call) return sanitize(call.input, seenUrls, sign);

    // server-side search paused or model stopped without recording — keep going
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    messages.push({ role: "user", content: "Now call record_match with your conclusion." });
  }
  return null;
}

/** Drop any link the search didn't actually return, so we never store an invented URL. */
function sanitize(m, seenUrls, sign) {
  const real = (u) => typeof u === "string" && seenUrls.has(u);
  const sources = (m.sources ?? []).filter((s) => real(s.url)).slice(0, 3);
  const confidence = Math.max(0, Math.min(1, Number(m.confidence) || 0));
  const title = m.real_title || (!m.is_codename ? sign.sign_title : "");
  const q = encodeURIComponent(title);
  return {
    isCodename: !!m.is_codename,
    realTitle: title || undefined,
    kind: m.kind,
    year: m.year,
    confidence,
    reasoning: m.reasoning,
    sources,
    // verified link if search returned one, otherwise a search link (never a guessed ID)
    imdb: real(m.imdb_url) ? m.imdb_url : title ? `https://www.imdb.com/find/?q=${q}` : undefined,
    letterboxd: real(m.letterboxd_url) ? m.letterboxd_url : title ? `https://letterboxd.com/search/${q}/` : undefined,
  };
}

export function statusFor(match) {
  if (!match?.realTitle) return "unknown";
  if (match.confidence >= 0.8 && match.sources.length) return "decoded";
  if (match.confidence >= 0.35) return "hunch";
  return "unknown";
}
