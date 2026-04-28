import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let createCanvas = null;
let createWorker = null;
let pdfjs = null;
let pyqRuntimeAvailable = true;

try {
  ({ createCanvas } = require("/Users/keshavchauhan18/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas"));
  ({ createWorker } = require("/Users/keshavchauhan18/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/tesseract.js"));
  pdfjs = await import("/Users/keshavchauhan18/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
} catch {
  pyqRuntimeAvailable = false;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(currentDir, "..");
const env = loadEnv(join(appDir, ".env"));
const geminiApiKey = String(env.GEMINI_API_KEY || "").trim();
const geminiModel = String(env.GEMINI_MODEL || "gemini-3-flash-preview").trim();

const cacheDir = join(appDir, "data", "pyq-cache");
const ocrCachePath = join(cacheDir, "ocr-cache.json");
const matchCachePath = join(cacheDir, "match-cache.json");

const OFFICIAL_DOCS = [
  {
    id: "upsc-gs2-2025",
    exam: "UPSC",
    year: 2025,
    paper: "GS2",
    url: "https://upsc.gov.in/sites/default/files/GENERAL-STUDIES-PAPER-II-QP-CSM-25-010925.pdf",
    maxPages: 4
  },
  {
    id: "upsc-gs3-2025",
    exam: "UPSC",
    year: 2025,
    paper: "GS3",
    url: "https://upsc.gov.in/sites/default/files/GENERAL-STUDIES-PAPER-III-QP-CSM-25-010925.pdf",
    maxPages: 6
  },
  {
    id: "nda-gat-2025",
    exam: "NDA",
    year: 2025,
    paper: "GAT",
    url: "https://upsc.gov.in/sites/default/files/QP-NDA-NA-I-25-GENERAL-ABILITY-TEST-150425.pdf",
    maxPages: 6
  },
  {
    id: "cds-gk-2025",
    exam: "CDS",
    year: 2025,
    paper: "GK",
    url: "https://upsc.gov.in/sites/default/files/QP-CDSE-I-25-GENERAL-KNOWLEDGE-150425.pdf",
    maxPages: 6
  }
];

const THEME_KEYWORDS = {
  "polity-rights": ["constitution", "rights", "detention", "liberty", "law", "procedure"],
  "governance-disaster": ["disaster", "resilience", "infrastructure", "governance", "preparedness", "climate"],
  "economy-inclusion": ["bank", "credit", "financial", "digital", "economy", "trade", "inclusion", "liquidity"],
  "defence-strategy": ["defence", "security", "maritime", "coastal", "air", "navy", "radar", "surveillance", "indo-pacific"],
  "science-policy": ["technology", "remote", "sensing", "satellite", "digital", "wifi", "innovation", "science"],
  "social-governance": ["nutrition", "school", "district", "welfare", "dashboard", "governance"]
};

function loadEnv(filePath) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const index = trimmed.indexOf("=");
      if (index === -1) return acc;
      acc[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function ensurePdf(doc) {
  await mkdir(cacheDir, { recursive: true });
  const pdfPath = join(cacheDir, `${doc.id}.pdf`);
  if (existsSync(pdfPath)) {
    return pdfPath;
  }
  const response = await fetch(doc.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${doc.id}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(pdfPath, buffer);
  return pdfPath;
}

async function getTesseractWorker() {
  const worker = await createWorker("eng");
  return worker;
}

async function renderPdfPages(pdfPath, maxPages) {
  const bytes = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  const stop = Math.min(doc.numPages, maxPages);
  for (let pageNumber = 2; pageNumber <= stop; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
      const value = gray > 180 ? 255 : 0;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }
    ctx.putImageData(imageData, 0, 0);
    pages.push({
      pageNumber,
      image: await canvas.encode("png")
    });
  }
  return pages;
}

async function ocrOfficialDoc(doc, worker, ocrCache) {
  if (ocrCache[doc.id]?.pages?.length) {
    return ocrCache[doc.id];
  }
  console.log(`PYQ OCR: ${doc.id}`);
  const pdfPath = await ensurePdf(doc);
  const renderedPages = await renderPdfPages(pdfPath, doc.maxPages);
  const pages = [];
  for (const rendered of renderedPages) {
    console.log(`PYQ OCR page ${doc.id}#${rendered.pageNumber}`);
    const result = await worker.recognize(rendered.image);
    pages.push({
      pageNumber: rendered.pageNumber,
      text: String(result?.data?.text || "").replace(/\s+/g, " ").trim()
    });
  }
  const payload = {
    updatedAt: new Date().toISOString(),
    pages
  };
  ocrCache[doc.id] = payload;
  return payload;
}

function relevantDocsForArticle(article) {
  if (article.theme === "defence-strategy") {
    return OFFICIAL_DOCS.filter((doc) => ["upsc-gs3-2025", "nda-gat-2025", "cds-gk-2025"].includes(doc.id));
  }
  if (article.theme === "polity-rights" || article.theme === "social-governance") {
    return OFFICIAL_DOCS.filter((doc) => doc.id === "upsc-gs2-2025");
  }
  return OFFICIAL_DOCS.filter((doc) => doc.id === "upsc-gs3-2025");
}

function keywordHits(article, docText) {
  const keywords = THEME_KEYWORDS[article.theme] || [];
  const haystack = docText.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

function snippetForKeywords(pages, keywords) {
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  const matchedPages = pages.filter((page) => lowered.some((keyword) => page.text.toLowerCase().includes(keyword)));
  return (matchedPages.length ? matchedPages : pages.slice(0, 3)).map((page) => `Page ${page.pageNumber}: ${page.text.slice(0, 2200)}`).join("\n\n");
}

async function geminiMatch(article, doc, snippet, hits) {
  if (!geminiApiKey) {
    return null;
  }
  const prompt = [
    "You are validating whether a current-affairs article has a genuine previous-year-question match in an official UPSC paper.",
    "Use only the provided OCR text from the official paper. Do not guess.",
    "Return strict JSON with keys: matched (boolean), reason (string), evidence (string).",
    "Mark matched=true only if a question in the OCR text is clearly related to the article topic/theme.",
    `Article title: ${article.title}`,
    `Article summary: ${article.summary}`,
    `Article theme: ${article.theme}`,
    `Candidate exam: ${doc.exam} ${doc.paper} ${doc.year}`,
    `Keyword hits found in OCR: ${hits.join(", ") || "none"}`,
    "Official OCR excerpt:",
    snippet
  ].join("\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  const parsed = JSON.parse(text || "{}");
  return parsed?.matched ? parsed : null;
}

function highConfidenceMatch(article, doc, pages) {
  const text = pages.map((page) => page.text.toLowerCase()).join("\n");
  if (article.theme === "defence-strategy") {
    if (text.includes("maritime security") || text.includes("coastal security")) {
      return {
        exam: "UPSC",
        year: 2025,
        paper: "GS3",
        evidence: "Official GS3 OCR includes a question on maritime and coastal security."
      };
    }
    if ((text.includes("air") && text.includes("security")) || text.includes("surveillance")) {
      return {
        exam: doc.exam,
        year: doc.year,
        paper: doc.paper,
        evidence: "Official defence-paper OCR includes a security/surveillance question cluster related to the topic."
      };
    }
  }
  if (article.theme === "science-policy" && text.includes("technology")) {
    return {
      exam: doc.exam,
      year: doc.year,
      paper: doc.paper,
      evidence: "Official OCR includes technology-focused questions aligned with the article theme."
    };
  }
  return null;
}

function articleCacheKey(article, doc) {
  return `${article.id}:${doc.id}:${article.title}:${article.summary}`;
}

export async function annotatePyqMatches(articles) {
  if (!Array.isArray(articles) || !articles.length) {
    return articles;
  }
  if (!pyqRuntimeAvailable || !createCanvas || !createWorker || !pdfjs) {
    return articles;
  }

  await mkdir(cacheDir, { recursive: true });
  const ocrCache = await readJson(ocrCachePath, {});
  const matchCache = await readJson(matchCachePath, {});
  const worker = await getTesseractWorker();

  try {
    for (const doc of OFFICIAL_DOCS) {
      try {
        await ocrOfficialDoc(doc, worker, ocrCache);
      } catch {
        // Keep going; we only annotate when official OCR is available.
      }
    }
  } finally {
    await worker.terminate();
  }

  const enriched = [];
  for (const article of articles) {
    let pyqRef = null;
    for (const doc of relevantDocsForArticle(article)) {
      const ocr = ocrCache[doc.id];
      if (!ocr?.pages?.length) {
        continue;
      }
      const docText = ocr.pages.map((page) => page.text).join("\n");
      const hits = keywordHits(article, docText);
      if (!hits.length) {
        continue;
      }

      const heuristic = highConfidenceMatch(article, doc, ocr.pages);
      if (heuristic) {
        pyqRef = heuristic;
        matchCache[articleCacheKey(article, doc)] = {
          matched: true,
          pyqRef,
          verifiedAt: new Date().toISOString()
        };
        break;
      }

      const cacheKey = articleCacheKey(article, doc);
      if (matchCache[cacheKey]?.matched) {
        pyqRef = matchCache[cacheKey].pyqRef;
        break;
      }

      const snippet = snippetForKeywords(ocr.pages, hits);
      const match = await geminiMatch(article, doc, snippet, hits);
      if (match?.matched) {
        pyqRef = {
          exam: doc.exam,
          year: doc.year,
          paper: doc.paper,
          evidence: String(match.evidence || "").slice(0, 220)
        };
        matchCache[cacheKey] = {
          matched: true,
          pyqRef,
          verifiedAt: new Date().toISOString()
        };
        break;
      }
      matchCache[cacheKey] = {
        matched: false,
        verifiedAt: new Date().toISOString()
      };
    }

    enriched.push(pyqRef ? { ...article, pyqRef } : article);
  }

  await writeJson(ocrCachePath, ocrCache);
  await writeJson(matchCachePath, matchCache);
  return enriched;
}
