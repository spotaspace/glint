// Glint daily content generator.
// Produces content/daily.json for the core channels. Run by the GitHub
// Action every morning, or locally: ANTHROPIC_API_KEY=... node generate.mjs
//
// Optional voice: set ELEVENLABS_API_KEY and VOICE_ID to also render each
// fact as an MP3 in content/audio/ and reference it via audioUrl.

import { readFileSync, writeFileSync, mkdirSync } from "fs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const AUDIO_BASE_URL = process.env.AUDIO_BASE_URL || ""; // where content/audio will be served from

if (!API_KEY) { console.error("Set ANTHROPIC_API_KEY"); process.exit(1); }

const channels = JSON.parse(readFileSync(new URL("./channels.json", import.meta.url)));

async function generateFacts(key, meta) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content:
`You write for Glint, a browser extension that shows one exquisite fact at a time to people while they work. Channel: "${meta.label}" — ${meta.brief}.

Write 5 facts. Rules:
- Each must be true, verifiable, and genuinely surprising to a smart adult.
- One or two sentences, maximum 220 characters. Written to be read in 8 seconds.
- Editorial, confident voice. No hedging, no "did you know", no exclamation marks.
- Today's date is ${new Date().toISOString().slice(0, 10)} — for "Today in history", anchor at least 2 facts to this calendar date.

Respond with ONLY a JSON array of 5 strings. No preamble, no markdown fences.`
      }]
    })
  });
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean).map(t => ({ text: t }));
}

async function renderAudio(text, filename) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": ELEVEN_KEY },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    }
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`content/audio/${filename}`, buf);
  return AUDIO_BASE_URL ? `${AUDIO_BASE_URL.replace(/\/$/, "")}/audio/${filename}` : null;
}

const out = { generatedAt: new Date().toISOString(), channels: {} };
mkdirSync("content/audio", { recursive: true });

for (const [key, meta] of Object.entries(channels)) {
  console.log("Generating:", meta.label);
  const facts = await generateFacts(key, meta);

  if (ELEVEN_KEY && AUDIO_BASE_URL) {
    for (let i = 0; i < facts.length; i++) {
      const url = await renderAudio(facts[i].text, `${key}-${i}.mp3`);
      if (url) facts[i].audioUrl = url;
    }
  }
  out.channels[key] = { label: meta.label, facts };
}

writeFileSync("content/daily.json", JSON.stringify(out, null, 2));
console.log("Wrote content/daily.json");
