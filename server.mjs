import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { updateNewsStore } from "./scripts/update-news.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const env = loadEnv(join(rootDir, ".env"));
const port = Number(process.env.PORT || env.PORT || 8010);
const geminiApiKey = String(process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || "").trim();
const geminiModel = String(process.env.GEMINI_MODEL || env.GEMINI_MODEL || "gemini-3-pro-preview").trim();
const elevenLabsApiKey = String(process.env.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY || "").trim();
const elevenLabsModel = String(process.env.ELEVENLABS_MODEL || env.ELEVENLABS_MODEL || "eleven_multilingual_v2").trim();
const elevenLabsVoiceMale = String(process.env.ELEVENLABS_VOICE_MALE || env.ELEVENLABS_VOICE_MALE || "").trim();
const elevenLabsVoiceFemale = String(process.env.ELEVENLABS_VOICE_FEMALE || env.ELEVENLABS_VOICE_FEMALE || "").trim();
const aiCache = new Map();
const newsDataPath = join(rootDir, "data", "news-data.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function loadEnv(filePath) {
  try {
    const raw = requireText(filePath);
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return acc;
      }
      const index = trimmed.indexOf("=");
      if (index === -1) {
        return acc;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function requireText(filePath) {
  return readFileSync(filePath, "utf8");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function ensureNewsData() {
  try {
    await stat(newsDataPath);
  } catch {
    await mkdir(join(rootDir, "data"), { recursive: true });
    await writeFile(newsDataPath, JSON.stringify({ updatedAt: "", articles: [] }, null, 2));
  }
}

async function readNewsData() {
  await ensureNewsData();
  const raw = await readFile(newsDataPath, "utf8");
  return JSON.parse(raw || "{\"updatedAt\":\"\",\"articles\":[]}");
}

function indiaDateStamp(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function isNewsStale(payload) {
  if (!payload?.updatedAt) {
    return true;
  }
  const parsed = new Date(payload.updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  return indiaDateStamp(parsed) !== indiaDateStamp(new Date());
}

function nextSixAmDelay() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(6, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleDailyUpdate() {
  const delay = nextSixAmDelay();
  setTimeout(async () => {
    try {
      await updateNewsStore();
      console.log("Daily weekly-top-news update completed.");
    } catch (error) {
      console.error("Daily news update failed:", error.message || error);
    }
    scheduleDailyUpdate();
  }, delay);
}

function articleFallback(article) {
  const score = fallbackScore(article);
  const probability = probabilityMeta(score);
  const reasonMap = {
    "governance-disaster": "Reason: Frequently asked theme in Governance + Disaster Management (PYQ trend).",
    "economy-inclusion": "Reason: Frequently asked theme in Economy + Governance (PYQ trend).",
    "defence-strategy": "Reason: Repeated theme in Defence + International Relations questions (PYQ trend).",
    "polity-rights": "Reason: Frequently asked theme in Polity + Fundamental Rights (PYQ trend).",
    "science-policy": "Reason: Recurring theme in Science-Tech + Policy linkage (PYQ trend).",
    "social-governance": "Reason: Seen in Social Issues + Welfare Governance themes (PYQ trend)."
  };
  const summaryPoints = [
    article.summary,
    `${article.source} update dated ${article.date} focuses on ${article.title.toLowerCase()}.`,
    `This topic connects with ${article.exams.join(", ")} preparation because it touches ${String(article.theme || "current affairs").replaceAll("-", " ")}.`,
    "Revise the governing idea, the policy shift, and why the issue matters in administration or public affairs."
  ];
  return {
    explanation: article.explanation,
    summaryPoints,
    predictionScore: score,
    probabilityLabel: probability.label,
    probabilityClass: probability.className,
    reason: reasonMap[article.theme] || "Reason: Topic has visible relevance in recurring PYQ-linked themes.",
    predictionText: `AI prediction: (based on topic relevance, current trend analysis, and PYQ pattern reference) ${probability.label}. This topic has visible exam value because it connects directly with recurring current-affairs themes.`,
    suggestedExams: Array.isArray(article.exams) ? article.exams : [],
    teacherScriptMaleEnglish: buildTeacherFallback(article, summaryPoints, probability.label, "english"),
    teacherScriptMaleHindi: buildTeacherFallback(article, summaryPoints, probability.label, "hindi"),
    teacherScriptMaleHinglish: buildTeacherFallback(article, summaryPoints, probability.label, "hinglish"),
    teacherScriptFemaleEnglish: buildTeacherFallback(article, summaryPoints, probability.label, "english"),
    teacherScriptFemaleHindi: buildTeacherFallback(article, summaryPoints, probability.label, "hindi"),
    teacherScriptFemaleHinglish: buildTeacherFallback(article, summaryPoints, probability.label, "hinglish")
  };
}

function buildTeacherFallback(article, summaryPoints, probabilityLabel, language) {
  const exams = Array.isArray(article.exams) && article.exams.length ? article.exams.join(", ") : "government exams";
  const points = Array.isArray(summaryPoints) ? summaryPoints.filter(Boolean).slice(0, 4) : [];
  if (language === "english") {
    return [
      "Okay, let us understand this news in very simple terms.",
      points[0] || `${article.summary}`,
      points[1] || `The important point here is that ${String(article.explanation || article.summary).replace(/\.$/, "")}.`,
      points[2] || "This matters because the policy impact and practical outcome are more important than just the headline.",
      points[3] || "The wider meaning of this topic is in its policy relevance and exam utility.",
      `And here comes the interesting part, AI prediction suggests that this topic falls in the ${probabilityLabel.toLowerCase()} category because of current trend strength and PYQ-style relevance.`,
      `From the exam point of view, this topic has strong value for ${exams}.`,
      "So revise it once properly."
    ].join(" ");
  }
  if (language === "hindi") {
    return [
      "Theek hai, ab is news ko bahut simple shabdon me samajhte hain.",
      points[0] || `${article.summary}`,
      points[1] || `Sabse important baat ye hai ki ${String(article.explanation || article.summary).replace(/\.$/, "")}.`,
      points[2] || "Iska matlab sirf headline ya update nahi, balki uska practical impact aur policy meaning bhi samajhna zaroori hai.",
      points[3] || "Is issue ka broader value uske policy aur exam connection me hai.",
      `Aur yahan interesting part ye hai ki AI prediction ke hisaab se ye topic ${probabilityLabel.toLowerCase()} category me aata hai, kyunki current trend aur PYQ pattern dono isse support karte hain.`,
      `Exam ke point of view se, ${exams} me is topic se sawal aane ke achhe chances hain.`,
      "Isliye isse ek baar dhang se revise zaroor kar lena."
    ].join(" ");
  }
  return [
    "Okay, toh is news ko simple terms me samajhte hain.",
    points[0] ? `Simple terms me, ${points[0]}` : `Simple terms me, ${article.summary}`,
    points[1] || `Ab important baat ye hai ki ${String(article.explanation || article.summary).replace(/\.$/, "")}.`,
    points[2] || "Samjho, yahan focus policy impact, practical effect aur exam value par hai.",
    points[3] || "Ye topic sirf current update nahi, exam preparation ke liye bhi kaafi useful hai.",
    `Aur yahan interesting part aata hai, AI prediction ke hisaab se ye topic ${probabilityLabel.toLowerCase()} category me aata hai, kyunki PYQ pattern aur current trend dono is side signal dete hain.`,
    `Exam point of view se, ${exams} me is topic se questions aane ke strong chances hain.`,
    "Toh isse ek baar revise zaroor kar lena."
  ].join(" ");
}

function fallbackScore(article) {
  const trendMap = { high: 22, medium: 12, "medium-low": 6, low: 0 };
  const themeMap = {
    "polity-rights": 30,
    "governance-disaster": 28,
    "economy-inclusion": 26,
    "defence-strategy": 18,
    "science-policy": 12,
    "social-governance": 8
  };
  const sourceMap = { PIB: 14, "The Hindu": 12, "Indian Express": 11, "Hindustan Times": 8, "Dainik Bhaskar": 7 };
  const examsWeight = Math.min((article.exams || []).length * 6, 18);
  return Math.max(12, Math.min(95, (trendMap[article.trend] || 0) + (themeMap[article.theme] || 6) + (sourceMap[article.source] || 6) + examsWeight));
}

function probabilityMeta(score) {
  if (score >= 80) return { className: "high", label: "High Probability" };
  if (score >= 70) return { className: "high-medium", label: "High-Medium Probability" };
  if (score >= 50) return { className: "medium", label: "Medium Probability" };
  if (score >= 30) return { className: "medium-low", label: "Medium-Low Probability" };
  return { className: "low", label: "Low Probability" };
}

async function geminiInsights(article) {
  if (!geminiApiKey) {
    return articleFallback(article);
  }

  const cacheKey = JSON.stringify({
    title: article.title,
    source: article.source,
    date: article.date,
    summary: article.summary,
    exams: article.exams,
    theme: article.theme,
    trend: article.trend
  });

  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  const prompt = [
    "You are an expert current affairs mentor for Indian government exams.",
    "Analyze this news item using topic importance, current trend intensity, and PYQ-style recurrence.",
    "Return strict JSON only with keys:",
    "explanation (string), summaryPoints (array of 5 to 7 strong bullet strings), predictionScore (integer 0-95), reason (string), predictionText (string), suggestedExams (array of exam tags), teacherScriptMaleEnglish (string), teacherScriptMaleHindi (string), teacherScriptMaleHinglish (string), teacherScriptFemaleEnglish (string), teacherScriptFemaleHindi (string), teacherScriptFemaleHinglish (string).",
    "Rules:",
    "- Keep summaryPoints substantial, clear, and exam-useful, but concise enough for fast reading.",
    "- predictionText must start with: AI prediction: (based on topic relevance, current trend analysis, and PYQ pattern reference)",
    "- reason must start with: Reason:",
    "- suggestedExams must be chosen from the article exams only.",
    "- Do not mention uncertainty or that you are guessing.",
    "- Generate six teacher scripts: male/female each in English, Hindi, and Hinglish.",
    "- Male scripts must feel calm, confident, clear, and pleasant.",
    "- Female scripts must feel warm, soft, sweet, clear, and pleasant.",
    "- English scripts must be easy spoken English.",
    "- Hindi scripts must be natural spoken Hindi in Devanagari script.",
    "- Hinglish scripts must be natural spoken Hinglish in Roman script.",
    "- All six scripts must sound human and conversational, around 40 to 50 seconds when spoken, with no bullet points and no headings.",
    "- All six scripts should follow this spoken flow: opening, simple explanation, importance, AI prediction mention, exam connection, closing.",
    "- Base the teacher scripts on the article summary, explanation, and the same key points used in the quick brief and AI prediction.",
    "- Use only the provided summary and explanation. Do not add unrelated facts, external news, or assumptions.",
    "",
    `Title: ${article.title}`,
    `Source: ${article.source}`,
    `Date: ${article.date}`,
    `Summary: ${article.summary}`,
    `Exams: ${(article.exams || []).join(", ")}`,
    `Theme: ${article.theme || ""}`,
    `Trend: ${article.trend || ""}`,
    `Existing explanation: ${article.explanation || ""}`
  ].join("\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  const parsed = JSON.parse(text || "{}");
  const safeScore = Math.max(0, Math.min(95, Number(parsed.predictionScore || 0)));
  const probability = probabilityMeta(safeScore);

  const result = {
    explanation: String(parsed.explanation || article.explanation || ""),
    summaryPoints: Array.isArray(parsed.summaryPoints) ? parsed.summaryPoints.slice(0, 7).map((item) => String(item)) : articleFallback(article).summaryPoints,
    predictionScore: safeScore,
    probabilityLabel: probability.label,
    probabilityClass: probability.className,
    reason: String(parsed.reason || articleFallback(article).reason),
    predictionText: String(parsed.predictionText || articleFallback(article).predictionText),
    suggestedExams: Array.isArray(parsed.suggestedExams) && parsed.suggestedExams.length ? parsed.suggestedExams.map((item) => String(item)) : (article.exams || []),
    teacherScriptMaleEnglish: String(parsed.teacherScriptMaleEnglish || articleFallback(article).teacherScriptMaleEnglish),
    teacherScriptMaleHindi: String(parsed.teacherScriptMaleHindi || articleFallback(article).teacherScriptMaleHindi),
    teacherScriptMaleHinglish: String(parsed.teacherScriptMaleHinglish || articleFallback(article).teacherScriptMaleHinglish),
    teacherScriptFemaleEnglish: String(parsed.teacherScriptFemaleEnglish || articleFallback(article).teacherScriptFemaleEnglish),
    teacherScriptFemaleHindi: String(parsed.teacherScriptFemaleHindi || articleFallback(article).teacherScriptFemaleHindi),
    teacherScriptFemaleHinglish: String(parsed.teacherScriptFemaleHinglish || articleFallback(article).teacherScriptFemaleHinglish)
  };

  aiCache.set(cacheKey, result);
  return result;
}

async function handleApi(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const article = payload.article;
      if (!article || !article.title) {
        json(res, 400, { error: "Article payload is required." });
        return;
      }
      try {
        const result = await geminiInsights(article);
        json(res, 200, { ok: true, result, model: geminiModel, fallback: false });
      } catch (error) {
        const result = articleFallback(article);
        json(res, 200, {
          ok: true,
          result,
          model: geminiModel,
          fallback: true,
          fallbackReason: error.message || "Gemini unavailable"
        });
      }
    } catch (error) {
      json(res, 500, { error: error.message || "Failed to generate insights." });
    }
  });
}

async function handleNewsApi(req, res) {
  try {
    const payload = await readNewsData();
    json(res, 200, { ok: true, ...payload });
  } catch (error) {
    json(res, 500, { error: error.message || "Failed to load news data." });
  }
}

async function synthesizeTeacherVoice({ text, voiceMode }) {
  if (!elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }
  const voiceId = voiceMode === "female" ? elevenLabsVoiceFemale : elevenLabsVoiceMale;
  if (!voiceId) {
    throw new Error(`ELEVENLABS_VOICE_${voiceMode === "female" ? "FEMALE" : "MALE"} is not configured.`);
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": elevenLabsApiKey
    },
    body: JSON.stringify({
      text,
      model_id: elevenLabsModel,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.82,
        style: 0.35,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ElevenLabs request failed: ${response.status} ${message}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function handleTtsApi(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const text = String(payload.text || "").trim();
      const voiceMode = payload.voiceMode === "female" ? "female" : "male";
      if (!text) {
        json(res, 400, { error: "Text is required." });
        return;
      }
      const audio = await synthesizeTeacherVoice({ text, voiceMode });
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store"
      });
      res.end(audio);
    } catch (error) {
      json(res, 503, { error: error.message || "Failed to synthesize speech." });
    }
  });
}

async function serveFile(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(rootDir, cleanPath));
  if (!resolved.startsWith(normalize(rootDir))) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const fileStat = await stat(resolved);
    const filePath = fileStat.isDirectory() ? join(resolved, "index.html") : resolved;
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);
  if (req.method === "POST" && url.pathname === "/api/ai/article-insights") {
    await handleApi(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/news") {
    await handleNewsApi(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/tts") {
    await handleTtsApi(req, res);
    return;
  }
  await serveFile(req, res, url.pathname);
});

ensureNewsData()
  .then(async () => {
    const current = await readNewsData();
    if (isNewsStale(current)) {
      try {
        await updateNewsStore();
      } catch (error) {
        console.error("Initial news update failed:", error.message || error);
      }
    }
    scheduleDailyUpdate();
  })
  .catch((error) => {
    console.error("News store init failed:", error.message || error);
  });

server.listen(port, () => {
  console.log(`Daily current affairs server running on http://127.0.0.1:${port}`);
  console.log(`Gemini model: ${geminiModel}`);
  console.log(`ElevenLabs ready: ${elevenLabsApiKey ? "yes" : "no"}`);
});
