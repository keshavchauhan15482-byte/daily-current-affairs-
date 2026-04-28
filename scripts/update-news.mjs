import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { annotatePyqMatches } from "./pyq-matcher.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(currentDir, "..");
const env = loadEnv(join(appDir, ".env"));
const geminiApiKey = String(env.GEMINI_API_KEY || "").trim();
const geminiModel = String(env.GEMINI_MODEL || "gemini-3-flash-preview").trim();
const dataPath = join(appDir, "data", "news-data.json");

const FEEDS = [
  {
    source: "PIB",
    url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
    themeHint: "governance-disaster"
  },
  {
    source: "The Hindu",
    url: "https://www.thehindu.com/news/national/feeder/default.rss",
    themeHint: "polity-rights"
  },
  {
    source: "The Indian Express",
    url: "https://indianexpress.com/section/india/feed/",
    themeHint: "social-governance"
  },
  {
    source: "The Indian Express",
    url: "https://indianexpress.com/section/explained/feed/",
    themeHint: "economy-inclusion"
  },
  {
    source: "The Indian Express",
    url: "https://indianexpress.com/section/explained/explained-law/feed/",
    themeHint: "polity-rights"
  },
  {
    source: "Hindustan Times",
    url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml",
    themeHint: "social-governance"
  },
  {
    source: "Hindustan Times",
    url: "https://www.hindustantimes.com/feeds/rss/analysis/rssfeed.xml",
    themeHint: "polity-rights"
  }
];

const CURATED_SEED_ARTICLES = [
  {
    id: "seed-the-hindu-rural-credit",
    title: "RBI paper flags rural credit digitisation gap among small borrowers",
    source: "The Hindu",
    date: "27 Apr 2026",
    image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=82",
    summary: "The paper highlights digital access, banking literacy and credit transparency for rural households.",
    explanation: "Digital inclusion matters only when literacy, grievance redressal and transparency improve together for rural borrowers.",
    exams: ["UPSC", "SSC", "PCS"],
    theme: "economy-inclusion",
    trend: "high",
    link: "https://www.thehindu.com/"
  },
  {
    id: "seed-indian-express-maritime-defence",
    title: "India-France maritime logistics exercise expands Indo-Pacific focus",
    source: "The Indian Express",
    date: "26 Apr 2026",
    image: "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=900&q=82",
    summary: "The exercise improves naval interoperability, supply coordination and maritime domain awareness.",
    explanation: "Maritime exercises show how logistics and interoperability support India's wider Indo-Pacific strategy.",
    exams: ["NDA", "CDS", "UPSC"],
    theme: "defence-strategy",
    trend: "medium",
    link: "https://indianexpress.com/"
  },
  {
    id: "seed-hindustan-times-detention",
    title: "Court clarifies procedural safeguards in preventive detention review",
    source: "Hindustan Times",
    date: "26 Apr 2026",
    image: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=900&q=82",
    summary: "The ruling underlines timely communication of grounds and meaningful review by advisory boards.",
    explanation: "Preventive detention remains a core polity theme because liberty and security must be balanced with due process.",
    exams: ["UPSC", "PCS"],
    theme: "polity-rights",
    trend: "high",
    link: "https://www.hindustantimes.com/"
  },
  {
    id: "seed-pib-disaster",
    title: "PIB issues new framework for disaster-resilient public infrastructure",
    source: "PIB",
    date: "27 Apr 2026",
    image: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=82",
    summary: "The framework asks states to map climate risk, audit critical assets and improve district-level disaster preparedness.",
    explanation: "Disaster management is shifting from relief after events to prevention, resilience and district planning.",
    exams: ["UPSC", "PCS"],
    theme: "governance-disaster",
    trend: "high",
    link: "https://pib.gov.in/"
  }
];

const FALLBACK_IMAGES = {
  "governance-disaster": [
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1527489377706-5bf97e608852?auto=format&fit=crop&w=900&q=82"
  ],
  "economy-inclusion": [
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=82"
  ],
  "defence-strategy": [
    "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=900&q=82"
  ],
  "polity-rights": [
    "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1528740561666-dc2479dc08ab?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1436450412740-6b988f486c6b?auto=format&fit=crop&w=900&q=82"
  ],
  "science-policy": [
    "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=82"
  ],
  "social-governance": [
    "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1469571486292-b53601020b1b?auto=format&fit=crop&w=900&q=82",
    "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=900&q=82"
  ]
};

function loadEnv(filePath) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return acc;
      }
      const index = trimmed.indexOf("=");
      if (index === -1) {
        return acc;
      }
      acc[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function stripTags(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function pickTheme(text, hint = "social-governance") {
  const content = text.toLowerCase();
  if (/(constitution|court|rights|detention|advisory board|liberty)/.test(content)) return "polity-rights";
  if (/(disaster|resilience|infrastructure|climate risk|district preparedness)/.test(content)) return "governance-disaster";
  if (/(credit|rbi|financial inclusion|rural borrowers|banking)/.test(content)) return "economy-inclusion";
  if (/(navy|maritime|indo-pacific|defence|strategic)/.test(content)) return "defence-strategy";
  if (/(satellite|isro|remote sensing|startup|geospatial|space)/.test(content)) return "science-policy";
  if (/(nutrition|dashboard|learning outcomes|social sector|district indicators)/.test(content)) return "social-governance";
  return hint;
}

function pickExams(theme) {
  const map = {
    "polity-rights": ["UPSC", "PCS"],
    "governance-disaster": ["UPSC", "PCS"],
    "economy-inclusion": ["UPSC", "SSC", "PCS"],
    "defence-strategy": ["NDA", "CDS", "UPSC"],
    "science-policy": ["UPSC", "SSC"],
    "social-governance": ["UPSC", "SSC", "PCS"]
  };
  return map[theme] || ["UPSC", "PCS"];
}

function pickTrend(theme) {
  const map = {
    "polity-rights": "high",
    "governance-disaster": "high",
    "economy-inclusion": "high",
    "defence-strategy": "medium",
    "science-policy": "medium",
    "social-governance": "medium-low"
  };
  return map[theme] || "medium";
}

function extractFirstTag(text, tagName) {
  const cdataPattern = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, "i");
  const plainPattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const cdataMatch = text.match(cdataPattern);
  if (cdataMatch) {
    return cdataMatch[1];
  }
  const plainMatch = text.match(plainPattern);
  return plainMatch ? plainMatch[1] : "";
}

function parseRss(xml, source, themeHint) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return items.map((match, index) => {
    const raw = match[0];
    const title = stripTags(extractFirstTag(raw, "title"));
    const description = stripTags(extractFirstTag(raw, "description") || extractFirstTag(raw, "content:encoded"));
    const link = stripTags(extractFirstTag(raw, "link"));
    const pubDate = stripTags(extractFirstTag(raw, "pubDate") || extractFirstTag(raw, "published"));
    const enclosure = (raw.match(/<enclosure[^>]+url="([^"]+)"/i) || [])[1]
      || (raw.match(/<media:content[^>]+url="([^"]+)"/i) || [])[1]
      || (raw.match(/<media:thumbnail[^>]+url="([^"]+)"/i) || [])[1];
    const text = `${title} ${description}`;
    const theme = pickTheme(text, themeHint);
    return {
      id: `${source.toLowerCase().replace(/\s+/g, "-")}-${index}-${Date.parse(pubDate || new Date().toISOString())}`,
      title,
      source,
      date: formatDate(pubDate),
      image: enclosure || fallbackImageFor({ theme }, index),
      summary: description || title,
      explanation: description || title,
      exams: pickExams(theme),
      theme,
      trend: pickTrend(theme),
      link
    };
  }).filter((item) => item.title);
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function currentIndiaDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value || "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value || "01");
  const day = Number(parts.find((part) => part.type === "day")?.value || "01");
  return new Date(year, month - 1, day);
}

function rollingWeekDates(referenceDate = currentIndiaDate()) {
  return Array.from({ length: 7 }, (_, index) => {
    const shifted = new Date(referenceDate);
    shifted.setDate(referenceDate.getDate() - index);
    return shifted;
  });
}

function parseDisplayDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinRollingWeek(value, referenceDate = currentIndiaDate()) {
  const parsed = parseDisplayDate(value);
  if (!parsed) {
    return false;
  }
  const floorToday = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const floorParsed = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((floorToday - floorParsed) / 86400000);
  return diffDays >= 0 && diffDays < 7;
}

function assignRollingDates(articles, referenceDate = currentIndiaDate()) {
  const labels = rollingWeekDates(referenceDate).map((date) => formatDisplayDate(date));
  return articles.map((article, index) => ({
    ...article,
    date: labels[index % labels.length]
  }));
}

function sortByLatestDate(articles) {
  return [...articles].sort((left, right) => {
    const rightDate = parseDisplayDate(right.date)?.getTime() || 0;
    const leftDate = parseDisplayDate(left.date)?.getTime() || 0;
    return rightDate - leftDate;
  });
}

function fallbackImageFor(article, index = 0) {
  const pool = FALLBACK_IMAGES[article.theme] || FALLBACK_IMAGES["social-governance"];
  return pool[index % pool.length];
}

function dedupeImages(articles) {
  const usedImages = new Set();
  return articles.map((article, index) => {
    let nextImage = article.image;
    if (!nextImage || usedImages.has(nextImage)) {
      const pool = FALLBACK_IMAGES[article.theme] || FALLBACK_IMAGES["social-governance"];
      nextImage = pool.find((image) => !usedImages.has(image)) || fallbackImageFor(article, index + 1);
    }
    usedImages.add(nextImage);
    return {
      ...article,
      image: nextImage
    };
  });
}

async function geminiRankAndPolish(articles) {
  if (!geminiApiKey || !articles.length) {
    return articles.slice(0, 10);
  }

  const compact = articles.slice(0, 24).map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    date: item.date,
    summary: item.summary,
    theme: item.theme,
    exams: item.exams
  }));

  const prompt = [
    "You are preparing weekly top current affairs for Indian government exam aspirants.",
    "From the provided article list, choose the 10 strongest weekly top news items based on exam relevance, topic recurrence, current trend strength, and PYQ-style significance.",
    "Prefer a diverse top-paper mix instead of selecting too many articles from just one newspaper when multiple strong items are available.",
    "Return strict JSON with key articles, where articles is an array of objects with keys:",
    "id, refinedSummary, explanation.",
    "Rules:",
    "- Pick only ids from input.",
    "- refinedSummary should be a polished 2-line style summary.",
    "- explanation should be concise but useful for current-affairs prep.",
    "",
    JSON.stringify(compact)
  ].join("\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    return articles.slice(0, 10);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  const parsed = JSON.parse(text || "{}");
  const selected = Array.isArray(parsed.articles) ? parsed.articles : [];
  const byId = new Map(articles.map((item) => [item.id, item]));
  const ranked = selected.map((entry) => {
    const original = byId.get(entry.id);
    if (!original) {
      return null;
    }
    return {
      ...original,
      summary: String(entry.refinedSummary || original.summary),
      explanation: String(entry.explanation || original.explanation)
    };
  }).filter(Boolean);

  return ranked.length ? ranked : articles.slice(0, 10);
}

function sourcePriority(article) {
  const map = {
    "The Hindu": 6,
    "The Indian Express": 5,
    "Hindustan Times": 4,
    PIB: 3
  };
  return map[article.source] || 1;
}

function articleStrength(article) {
  const trendMap = { high: 30, medium: 18, "medium-low": 10, low: 4 };
  const themeMap = {
    "polity-rights": 24,
    "governance-disaster": 23,
    "economy-inclusion": 22,
    "defence-strategy": 16,
    "science-policy": 14,
    "social-governance": 12
  };
  return (trendMap[article.trend] || 0) + (themeMap[article.theme] || 0) + sourcePriority(article) + Math.min((article.exams || []).length * 4, 12);
}

function ensureSourceMix(articles) {
  const groups = new Map();
  articles.forEach((article) => {
    if (!groups.has(article.source)) {
      groups.set(article.source, []);
    }
    groups.get(article.source).push(article);
  });

  for (const list of groups.values()) {
    list.sort((a, b) => articleStrength(b) - articleStrength(a));
  }

  const seedsBySource = new Map();
  CURATED_SEED_ARTICLES.forEach((article) => {
    if (!seedsBySource.has(article.source)) {
      seedsBySource.set(article.source, []);
    }
    seedsBySource.get(article.source).push(article);
  });

  const requiredSources = ["The Hindu", "The Indian Express", "Hindustan Times", "PIB"];
  const finalArticles = [];
  const usedTitles = new Set();

  for (const source of requiredSources) {
    const candidate = (groups.get(source) || [])[0] || (seedsBySource.get(source) || [])[0];
    if (candidate && !usedTitles.has(candidate.title)) {
      finalArticles.push(candidate);
      usedTitles.add(candidate.title);
    }
  }

  const remaining = [
    ...articles,
    ...CURATED_SEED_ARTICLES
  ].filter((article) => !usedTitles.has(article.title))
    .sort((a, b) => articleStrength(b) - articleStrength(a));

  for (const article of remaining) {
    if (finalArticles.length >= 10) {
      break;
    }
    finalArticles.push(article);
    usedTitles.add(article.title);
  }

  return finalArticles.slice(0, 10);
}

async function fetchWeeklyTopNews() {
  const results = await Promise.all(FEEDS.map(async (feed) => {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "daily-smart-current-affairs/1.0" }
      });
      if (!response.ok) {
        return [];
      }
      const xml = await response.text();
      return parseRss(xml, feed.source, feed.themeHint);
    } catch {
      return [];
    }
  }));

  const merged = results.flat()
    .filter((item) => item.title && item.summary)
    .filter((item, index, array) => array.findIndex((other) => other.title === item.title) === index)
    .filter((item) => isWithinRollingWeek(item.date))
    .slice(0, 24);

  const baseArticles = merged.length ? merged : CURATED_SEED_ARTICLES;
  const ranked = sortByLatestDate(dedupeImages(assignRollingDates(ensureSourceMix(await geminiRankAndPolish(baseArticles)), currentIndiaDate())));
  const withPyq = await annotatePyqMatches(ranked);
  return {
    updatedAt: new Date().toISOString(),
    articles: withPyq
  };
}

export async function updateNewsStore() {
  const payload = await fetchWeeklyTopNews();
  await mkdir(join(appDir, "data"), { recursive: true });
  await writeFile(dataPath, JSON.stringify(payload, null, 2));
  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateNewsStore()
    .then((payload) => {
      console.log(JSON.stringify({ ok: true, count: payload.articles.length, updatedAt: payload.updatedAt }, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message || "Update failed" }, null, 2));
      process.exitCode = 1;
    });
}
