const DATA = [
  {
    id: "disaster-resilience",
    title: "PIB issues new framework for disaster-resilient public infrastructure",
    source: "PIB",
    date: "27 Apr 2026",
    image: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=82",
    summary: "The framework asks states to map climate risk, audit critical assets and improve district-level disaster preparedness.",
    exams: ["UPSC", "PCS"],
    explanation: "Disaster management is shifting from relief after events to prevention, resilience and district planning.",
    theme: "governance-disaster",
    trend: "high"
  },
  {
    id: "rural-credit",
    title: "RBI paper flags rural credit digitisation gap among small borrowers",
    source: "The Hindu",
    date: "27 Apr 2026",
    image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=82",
    summary: "The paper highlights digital access, banking literacy and credit transparency for rural households.",
    exams: ["UPSC", "SSC", "PCS"],
    explanation: "Digital inclusion is useful only when literacy, grievance redressal and transparency improve too.",
    theme: "economy-inclusion",
    trend: "high"
  },
  {
    id: "maritime-defence",
    title: "India-France maritime logistics exercise expands Indo-Pacific focus",
    source: "Indian Express",
    date: "26 Apr 2026",
    image: "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=900&q=82",
    summary: "The exercise improves naval interoperability, supply coordination and maritime domain awareness.",
    exams: ["NDA", "CDS", "UPSC"],
    explanation: "Maritime exercises show how partnerships improve readiness and reinforce the Indo-Pacific strategy.",
    theme: "defence-strategy",
    trend: "medium"
  },
  {
    id: "preventive-detention",
    title: "Court clarifies procedural safeguards in preventive detention review",
    source: "Hindustan Times",
    date: "26 Apr 2026",
    image: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=900&q=82",
    summary: "The ruling underlines timely communication of grounds and meaningful review by advisory boards.",
    exams: ["UPSC", "PCS"],
    explanation: "Preventive detention is constitutionally sensitive because liberty and security must be balanced carefully.",
    theme: "polity-rights",
    trend: "high"
  },
  {
    id: "space-policy",
    title: "ISRO releases draft norms for satellite data access by startups",
    source: "PIB",
    date: "25 Apr 2026",
    image: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=900&q=82",
    summary: "The draft seeks easier access to remote sensing datasets while balancing national security concerns.",
    exams: ["UPSC", "SSC"],
    explanation: "Satellite data supports agriculture, urban planning, climate tracking and innovation in the startup ecosystem.",
    theme: "science-policy",
    trend: "medium"
  },
  {
    id: "nutrition-dashboard",
    title: "NITI dashboard tracks district nutrition and learning outcomes",
    source: "Dainik Bhaskar",
    date: "25 Apr 2026",
    image: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=900&q=82",
    summary: "The dashboard compares district indicators for nutrition, school attendance and early childhood services.",
    exams: ["UPSC", "SSC", "PCS"],
    explanation: "This is a useful example of data-driven governance in the social sector.",
    theme: "social-governance",
    trend: "medium-low"
  }
];

const PREDICTIONS = [
  {
    question: "Discuss how resilient public infrastructure can reduce disaster risk in Indian districts.",
    exam: "UPSC / PCS",
    probability: "High"
  },
  {
    question: "What are the benefits and risks of digital credit expansion in rural India?",
    exam: "UPSC / SSC",
    probability: "High"
  },
  {
    question: "Explain the strategic importance of maritime partnerships in the Indo-Pacific.",
    exam: "NDA / CDS / UPSC",
    probability: "Medium"
  }
];

const AUTH_KEY = "daily-current-affairs-user";
const state = { exam: "All" };
const AI_API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8010" : "";
const AI_CACHE_KEY = "daily-current-affairs-ai-cache-v2";
const NEWS_API_BASE = AI_API_BASE;
let liveArticles = null;
let teacherVoiceMode = "male";
let teacherLanguageMode = "hinglish";
let activeTeacherScripts = {
  male: { english: "", hindi: "", hinglish: "" },
  female: { english: "", hindi: "", hinglish: "" }
};
let activeTeacherAudio = null;
let availableSpeechVoices = [];

function articlePool() {
  return Array.isArray(liveArticles) && liveArticles.length ? liveArticles : DATA;
}

function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch (_error) {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

function readAiCache() {
  try {
    return JSON.parse(localStorage.getItem(AI_CACHE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeAiCache(cache) {
  localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
}

function stopTeacherAudio() {
  if (activeTeacherAudio) {
    activeTeacherAudio.pause();
    activeTeacherAudio.src = "";
    activeTeacherAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  const playButton = qs("#teacher-play-btn");
  if (playButton) {
    playButton.textContent = "Start listening";
    playButton.dataset.state = "idle";
  }
}

function loadSpeechVoices() {
  if (!("speechSynthesis" in window)) return;
  availableSpeechVoices = window.speechSynthesis.getVoices().filter(Boolean);
}

function voiceCandidatesForLanguage() {
  const patterns = teacherLanguageMode === "hindi"
    ? [/^hi\b/i, /hindi/i, /india/i]
    : teacherLanguageMode === "english"
      ? [/^en\b/i, /english/i, /india/i]
      : [/^hi\b/i, /^en\b/i, /hindi/i, /english/i, /india/i];
  const matched = availableSpeechVoices.filter((voice) => {
    const label = `${voice.name} ${voice.lang}`;
    return patterns.some((pattern) => pattern.test(label));
  });
  return matched.length ? matched : availableSpeechVoices;
}

function pickSpeechVoice(mode) {
  const candidates = voiceCandidatesForLanguage();
  const femaleHints = ["female", "woman", "samantha", "victoria", "karen", "zira", "veena", "priya", "susan", "aria", "ava", "siri"];
  const maleHints = ["male", "man", "daniel", "alex", "aarav", "arjun", "raj", "david", "rishi", "google uk english male"];
  const hints = mode === "female" ? femaleHints : maleHints;
  const exact = candidates.find((voice) => hints.some((hint) => `${voice.name} ${voice.lang}`.toLowerCase().includes(hint)));
  if (exact) {
    return exact;
  }
  const fallbackByIndex = mode === "female"
    ? candidates.find((voice, index) => index % 2 === 0)
    : candidates.find((voice, index) => index % 2 === 1);
  return fallbackByIndex || candidates[0] || null;
}

function teacherScriptForMode() {
  const profile = teacherVoiceMode === "female" ? activeTeacherScripts.female : activeTeacherScripts.male;
  return profile?.[teacherLanguageMode] || profile?.hinglish || "";
}

function renderTeacherScript() {
  qsa("[data-teacher-voice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.teacherVoice === teacherVoiceMode);
  });
  qsa("[data-teacher-language]").forEach((button) => {
    button.classList.toggle("active", button.dataset.teacherLanguage === teacherLanguageMode);
  });
  stopTeacherAudio();
}

async function playTeacherAudio() {
  const script = teacherScriptForMode();
  const playButton = qs("#teacher-play-btn");
  if (!script) {
    if (playButton) {
      playButton.textContent = "Voice unavailable";
    }
    return;
  }
  if (playButton?.dataset.state === "playing") {
    stopTeacherAudio();
    return;
  }
  stopTeacherAudio();
  if (playButton) {
    playButton.textContent = "Loading voice...";
    playButton.dataset.state = "loading";
  }
  if (!("speechSynthesis" in window)) {
    if (playButton) {
      playButton.textContent = "Voice unavailable";
      playButton.dataset.state = "idle";
    }
    return;
  }
  loadSpeechVoices();
  const selectedVoice = pickSpeechVoice(teacherVoiceMode);
  if (!selectedVoice) {
    if (playButton) {
      playButton.textContent = "Voice unavailable";
      playButton.dataset.state = "idle";
    }
    return;
  }
  const utterance = new SpeechSynthesisUtterance(script);
  utterance.voice = selectedVoice;
  utterance.lang = selectedVoice.lang || (teacherLanguageMode === "english" ? "en-IN" : "hi-IN");
  utterance.rate = teacherLanguageMode === "english" ? 0.96 : 0.92;
  utterance.pitch = teacherVoiceMode === "female" ? 1.08 : 0.94;
  utterance.volume = 1;
  utterance.onend = () => stopTeacherAudio();
  utterance.onerror = () => {
    if (playButton) {
      playButton.textContent = "Voice unavailable";
      playButton.dataset.state = "idle";
    }
  };
  if (playButton) {
    playButton.textContent = "Stop voice";
    playButton.dataset.state = "playing";
  }
  window.speechSynthesis.speak(utterance);
}

function syncAuthUi() {
  const user = currentUser();
  qsa("[data-guest]").forEach((node) => node.classList.toggle("hidden", !!user));
  qsa("[data-user]").forEach((node) => node.classList.toggle("hidden", !user));
  qsa("[data-avatar]").forEach((node) => {
    const source = user?.name || "Daily Current";
    const initials = source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
    node.textContent = initials || "DC";
  });
}

function visibleItems() {
  const source = articlePool();
  return source.filter((item) => state.exam === "All" || item.exams.includes(state.exam));
}

function examToneClass(exam) {
  const map = {
    UPSC: "exam-upsc",
    SSC: "exam-ssc",
    NDA: "exam-nda",
    CDS: "exam-cds",
    Banking: "exam-banking",
    PCS: "exam-pcs",
    Other: "exam-other"
  };
  return map[exam] || "exam-other";
}

function primaryExamLabel(item) {
  return Array.isArray(item.exams) && item.exams.length ? item.exams.join(" / ") : "Current Affairs";
}

function relevanceLine(item) {
  const focusMap = {
    "polity-rights": "UPSC GS2 • Prelims • PCS",
    "governance-disaster": "UPSC GS2/GS3 • Prelims • PCS",
    "economy-inclusion": "UPSC GS3 • Prelims • Banking",
    "defence-strategy": "UPSC GS2/GS3 • NDA • CDS",
    "science-policy": "UPSC GS3 • Prelims • SSC",
    "social-governance": "UPSC GS2 • Prelims • PCS"
  };
  return focusMap[item.theme] || "UPSC • Prelims • Other Exams";
}

function lastAskedLine(item) {
  if (!item.pyqRef || !item.pyqRef.exam || !item.pyqRef.year) {
    return "";
  }
  return `PYQ ${item.pyqRef.exam} ${item.pyqRef.year}`;
}

function badgeLabel(probability) {
  return probability.className === "high" ? "High Probability (PYQ-backed)" : probability.label;
}

function renderNews() {
  const grid = qs("#news-grid");
  if (!grid) return;
  grid.innerHTML = visibleItems().map((item, index) => `
    <article class="news-card feed-entrance-item" data-feed-step="${index}">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">
      <div class="news-body">
        <div class="meta"><span>${escapeHtml(item.source)}</span><span>${escapeHtml(item.date)}</span></div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="muted">${escapeHtml(item.summary)}</p>
        <p class="exam-relevance">${escapeHtml(relevanceLine(item))}</p>
        ${lastAskedLine(item) ? `<p class="last-asked">${escapeHtml(lastAskedLine(item))}</p>` : ""}
        <div class="card-actions">
          <strong class="primary-exam-line">${escapeHtml(primaryExamLabel(item))}</strong>
          <div class="tab-row">
            <button class="outline-btn" data-summarize="${escapeHtml(item.id)}">Quick Brief</button>
            <button class="outline-btn" data-explain="${escapeHtml(item.id)}">🗣️ Ai teacher</button>
          </div>
        </div>
      </div>
    </article>
  `).join("");

  qsa("[data-explain]").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.explain));
  });
  qsa("[data-summarize]").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.summarize, "summary"));
  });
  bindFeedEntrance();
}

function renderBrief() {
  const date = qs("#brief-date");
  const list = qs("#brief-list");
  if (date) {
    date.textContent = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date());
  }
  if (list) {
    list.innerHTML = articlePool().slice(0, 6).map((item) => `<li><strong>${escapeHtml(item.source)}:</strong> ${escapeHtml(item.summary)}</li>`).join("");
  }
}

function renderPredictor() {
  const list = qs("#predictor-list");
  if (!list) return;
  list.innerHTML = PREDICTIONS.map((item) => `
    <article class="prediction-card">
      <h3>${escapeHtml(item.question)}</h3>
      <p class="muted">${escapeHtml(item.exam)}</p>
      <span class="tag">${escapeHtml(item.probability)} probability</span>
    </article>
  `).join("");
}

function summaryPoints(item) {
  const pointMap = {
    "disaster-resilience": [
      "The new framework pushes states to move beyond post-disaster relief and focus on prevention, resilience and advance planning.",
      "Critical public infrastructure such as roads, hospitals and utilities may now be assessed through climate-risk and vulnerability mapping.",
      "District-level preparedness becomes more important because implementation will depend on local planning, coordination and timely response systems.",
      "The policy direction shows that disaster management is increasingly tied to infrastructure quality, governance capacity and long-term resilience.",
      "This development matters because future questions can connect climate adaptation with public administration and disaster governance."
    ],
    "rural-credit": [
      "The RBI paper highlights that digital credit expansion is not enough on its own unless borrowers can actually understand and use the system safely.",
      "Small rural borrowers still face barriers such as weak digital literacy, limited awareness and low transparency in loan conditions.",
      "The bigger concern is that credit access without consumer protection can increase exclusion, confusion and risky borrowing behaviour.",
      "This issue links finance with governance because inclusion must be supported by grievance redressal, fair lending practices and last-mile awareness.",
      "The topic carries weight because it reflects a real policy gap between digital expansion and meaningful financial empowerment."
    ],
    "maritime-defence": [
      "The exercise signals a deeper operational relationship rather than a symbolic diplomatic event, especially in logistics and interoperability.",
      "India's maritime focus continues to widen through partnerships that strengthen reach, preparedness and coordination in the Indo-Pacific region.",
      "Logistics cooperation matters because naval readiness depends not only on ships and personnel, but also on sustained support and supply movement.",
      "The development shows how defence partnerships are being tied to sea-lane security, regional presence and strategic balancing.",
      "This news has substance because it connects defence preparedness with larger geopolitical priorities in the Indo-Pacific."
    ],
    "preventive-detention": [
      "The court has reinforced that procedural safeguards are not optional and must be followed meaningfully in preventive detention cases.",
      "Timely communication of detention grounds remains central because a person cannot respond properly without knowing the basis of detention.",
      "Review by advisory boards gains importance when courts stress that scrutiny should be real, not mechanical or symbolic.",
      "The broader issue is the constitutional balance between state security concerns and the protection of personal liberty.",
      "This update is important because it sharpens the legal and governance discussion around misuse prevention and due process."
    ],
    "space-policy": [
      "The draft norms indicate that India wants to widen satellite data access for startups while still protecting sensitive national interests.",
      "Remote sensing data has value far beyond space science because it supports agriculture, planning, disaster response and environmental monitoring.",
      "The policy challenge is to encourage innovation without allowing unrestricted access to strategically sensitive geospatial information.",
      "This move also reflects the larger trend of opening the space ecosystem to private players under a regulated framework.",
      "The topic is strong because it joins technology, regulation and economic opportunity in one policy discussion."
    ],
    "nutrition-dashboard": [
      "The dashboard aims to turn district-level data into actionable governance by comparing nutrition, schooling and early-childhood indicators together.",
      "Such tracking can help identify weak-performing districts faster and support more targeted administrative intervention.",
      "The update is important because social-sector governance improves when data is used not just for reporting but for course correction.",
      "Nutrition and learning outcomes appearing together also show that development challenges are interlinked rather than isolated.",
      "This news stands out because it reflects a measurable and policy-oriented approach to inclusive development."
    ]
  };

  return pointMap[item.id] || [
    item.summary,
    item.explanation,
    item.angle
  ];
}

async function fetchAiInsights(item) {
  const cacheKey = `${item.id}:${item.date}`;
  const localCache = readAiCache();
  if (localCache[cacheKey]) {
    return localCache[cacheKey];
  }

  const response = await fetch(`${AI_API_BASE}/api/ai/article-insights`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article: item })
  });

  if (!response.ok) {
    throw new Error("AI insights request failed.");
  }

  const payload = await response.json();
  localCache[cacheKey] = payload.result;
  writeAiCache(localCache);
  return payload.result;
}

async function fetchLiveNews() {
  const response = await fetch(`${NEWS_API_BASE}/api/news`);
  if (!response.ok) {
    throw new Error("News fetch failed.");
  }
  const payload = await response.json();
  return Array.isArray(payload.articles) ? payload.articles : [];
}

function probabilityMeta(score) {
  if (score >= 80) {
    return { className: "high", label: "High Probability (PYQ-backed)" };
  }
  if (score >= 70) {
    return { className: "high-medium", label: "High-Medium Probability" };
  }
  if (score >= 50) {
    return { className: "medium", label: "Medium Probability" };
  }
  if (score >= 30) {
    return { className: "medium-low", label: "Medium-Low Probability" };
  }
  return { className: "low", label: "Low Probability" };
}

function trendWeight(trend) {
  const map = {
    high: 20,
    medium: 10,
    "medium-low": 4,
    low: 0
  };
  return map[trend] || 0;
}

function pyqThemeWeight(theme) {
  const map = {
    "polity-rights": 32,
    "governance-disaster": 30,
    "economy-inclusion": 28,
    "defence-strategy": 18,
    "science-policy": 12,
    "social-governance": 8
  };
  return map[theme] || 6;
}

function examCoverageWeight(exams) {
  if (!Array.isArray(exams)) {
    return 0;
  }
  return Math.min(exams.length * 6, 18);
}

function sourceCredibilityWeight(source) {
  const map = {
    PIB: 14,
    "The Hindu": 12,
    "Indian Express": 11,
    "Hindustan Times": 8,
    "Dainik Bhaskar": 7
  };
  return map[source] || 6;
}

function topicSignalWeight(item) {
  const text = `${item.title} ${item.summary} ${item.explanation}`.toLowerCase();
  let score = 0;
  const strongSignals = [
    "constitutional",
    "rights",
    "disaster",
    "infrastructure",
    "governance",
    "credit",
    "financial inclusion",
    "security",
    "indo-pacific"
  ];
  const moderateSignals = [
    "dashboard",
    "district",
    "remote sensing",
    "startups",
    "nutrition",
    "learning outcomes"
  ];
  strongSignals.forEach((signal) => {
    if (text.includes(signal)) {
      score += 6;
    }
  });
  moderateSignals.forEach((signal) => {
    if (text.includes(signal)) {
      score += 3;
    }
  });
  return Math.min(score, 24);
}

function buildPrediction(item, score) {
  const probability = probabilityMeta(score);
  const themeReasonMap = {
    "polity-rights": "constitutional safeguards and liberty-state balance are repeatedly tested in PYQ-style polity questions",
    "governance-disaster": "disaster governance, resilience and public infrastructure keep showing up in policy-heavy current affairs",
    "economy-inclusion": "financial inclusion and rural economy themes often return in conceptual as well as policy-based questions",
    "defence-strategy": "defence partnerships and Indo-Pacific strategy remain recurring but slightly narrower exam themes",
    "science-policy": "science-policy stories become important when technology is linked with regulation and public use",
    "social-governance": "social-sector governance matters, but narrower administrative updates usually get lower direct question weightage"
  };
  const trendReasonMap = {
    high: "The current trend strength for this topic is high.",
    medium: "The topic is active in current affairs, but not at top-tier intensity.",
    "medium-low": "The topic is relevant, though its current momentum is moderate.",
    low: "The topic is comparatively less active in the present cycle."
  };
  const shortReasonMap = {
    "polity-rights": "Reason: Frequently asked theme in Polity + Fundamental Rights (PYQ trend).",
    "governance-disaster": "Reason: Frequently asked theme in Governance + Disaster Management (PYQ trend).",
    "economy-inclusion": "Reason: Frequently asked theme in Economy + Governance (PYQ trend).",
    "defence-strategy": "Reason: Repeated theme in Defence + International Relations questions (PYQ trend).",
    "science-policy": "Reason: Recurring theme in Science-Tech + Policy linkage (PYQ trend).",
    "social-governance": "Reason: Seen in Social Issues + Welfare Governance themes (PYQ trend)."
  };

  return {
    score,
    badge: probability,
    reason: shortReasonMap[item.theme] || "Reason: Topic has visible relevance in recurring PYQ-linked themes.",
    text: `AI prediction: (based on topic relevance, current trend analysis, and PYQ pattern reference) ${badgeLabel(probability)}. ${themeReasonMap[item.theme] || "This topic has noticeable exam value."} ${trendReasonMap[item.trend] || ""}`
  };
}

function predictionForItem(item) {
  const score = Math.max(
    12,
    Math.min(
      95,
      pyqThemeWeight(item.theme)
      + trendWeight(item.trend)
      + examCoverageWeight(item.exams)
      + sourceCredibilityWeight(item.source)
      + topicSignalWeight(item)
    )
  );
  return buildPrediction(item, score);
}

async function openModal(id, mode = "explain") {
  const item = articlePool().find((entry) => entry.id === id);
  const modal = qs("#explain-modal");
  if (!item || !modal) return;
  const localPrediction = predictionForItem(item);
  qs("#modal-source").textContent = `${item.source} • ${item.date}`;
  qs("#modal-title").textContent = mode === "summary" ? `${item.title} - AI Summary` : item.title;
  qs("#modal-summary").textContent = item.summary;
  qs("#modal-explain").textContent = mode === "summary"
    ? (item.explanation || item.summary)
    : (item.explanation || item.summary);
  activeTeacherScripts = {
    male: {
      english: "Generating AI teacher explanation...",
      hindi: "AI teacher explanation taiyar ho raha hai...",
      hinglish: "Generating AI teacher explanation..."
    },
    female: {
      english: "Generating AI teacher explanation...",
      hindi: "AI teacher explanation taiyar ho raha hai...",
      hinglish: "Generating AI teacher explanation..."
    }
  };
  renderTeacherScript();
  qs("#modal-angle").textContent = "Generating Gemini prediction...";
  const reasonNode = qs("#modal-probability-reason");
  if (reasonNode) {
    reasonNode.textContent = "Reason: Analyzing topic trend and PYQ pattern...";
  }
  const examTagsNode = qs("#modal-exam-tags");
  if (examTagsNode) {
    examTagsNode.innerHTML = [
      '<span class="glow-tag glow-tag-label">For Which Exams</span>',
      ...item.exams.map((exam) => `<span class="glow-tag ${examToneClass(exam)}">${escapeHtml(exam)}</span>`)
    ].join("");
  }
  const badge = qs("#modal-probability-badge");
  if (badge) {
    badge.className = `probability-badge ${localPrediction.badge.className}`;
    badge.textContent = "Analyzing...";
  }
  const points = qs("#modal-points");
  if (points) {
    points.innerHTML = summaryPoints(item)
      .filter(Boolean)
      .map((point) => `<li>${escapeHtml(point)}</li>`)
      .join("");
  }
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  try {
    const ai = await fetchAiInsights(item);
    activeTeacherScripts = {
      male: {
        english: String(ai.teacherScriptMaleEnglish || ai.explanation || item.explanation || ""),
        hindi: String(ai.teacherScriptMaleHindi || ai.explanation || item.explanation || ""),
        hinglish: String(ai.teacherScriptMaleHinglish || ai.explanation || item.explanation || "")
      },
      female: {
        english: String(ai.teacherScriptFemaleEnglish || ai.explanation || item.explanation || ""),
        hindi: String(ai.teacherScriptFemaleHindi || ai.explanation || item.explanation || ""),
        hinglish: String(ai.teacherScriptFemaleHinglish || ai.explanation || item.explanation || "")
      }
    };
    renderTeacherScript();
    qs("#modal-explain").textContent = String(ai.explanation || item.explanation || item.summary || "");
    qs("#modal-angle").textContent = String(ai.predictionText || localPrediction.text);
    if (reasonNode) {
      reasonNode.textContent = String(ai.reason || localPrediction.reason);
    }
    if (badge) {
      const probability = probabilityMeta(Number(ai.predictionScore || localPrediction.score));
      badge.className = `probability-badge ${probability.className}`;
      badge.textContent = badgeLabel(probability);
    }
    if (points) {
      const aiPoints = Array.isArray(ai.summaryPoints) && ai.summaryPoints.length ? ai.summaryPoints : summaryPoints(item);
      points.innerHTML = aiPoints
        .filter(Boolean)
        .map((point) => `<li>${escapeHtml(point)}</li>`)
        .join("");
    }
    if (examTagsNode) {
      const exams = Array.isArray(ai.suggestedExams) && ai.suggestedExams.length ? ai.suggestedExams : item.exams;
      examTagsNode.innerHTML = [
        '<span class="glow-tag glow-tag-label">For Which Exams</span>',
        ...exams.map((exam) => `<span class="glow-tag ${examToneClass(exam)}">${escapeHtml(exam)}</span>`)
      ].join("");
    }
  } catch (_error) {
    activeTeacherScripts = {
      male: {
        english: item.explanation,
        hindi: item.explanation,
        hinglish: item.explanation
      },
      female: {
        english: item.explanation,
        hindi: item.explanation,
        hinglish: item.explanation
      }
    };
    renderTeacherScript();
    qs("#modal-explain").textContent = item.explanation || item.summary || "";
    qs("#modal-angle").textContent = localPrediction.text;
    if (reasonNode) {
      reasonNode.textContent = localPrediction.reason;
    }
    if (badge) {
      badge.className = `probability-badge ${localPrediction.badge.className}`;
      badge.textContent = badgeLabel(localPrediction.badge);
    }
  }
}

function closeModal() {
  stopTeacherAudio();
  qs("#explain-modal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindTeacherControls() {
  qsa("[data-teacher-voice]").forEach((button) => {
    button.addEventListener("click", () => {
      teacherVoiceMode = button.dataset.teacherVoice || "male";
      renderTeacherScript();
    });
  });
  qsa("[data-teacher-language]").forEach((button) => {
    button.addEventListener("click", () => {
      teacherLanguageMode = button.dataset.teacherLanguage || "hinglish";
      renderTeacherScript();
    });
  });
  qs("#teacher-play-btn")?.addEventListener("click", () => {
    playTeacherAudio();
  });
  if ("speechSynthesis" in window) {
    loadSpeechVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      loadSpeechVoices();
    };
  }
}

function protectPage() {
  const page = document.body.dataset.page;
  if (!["feed", "predictor"].includes(page)) return;
  const gate = qs("#gate");
  const protectedArea = qs("#protected");
  if (currentUser()) {
    gate?.classList.add("hidden");
    protectedArea?.classList.remove("hidden");
  } else {
    gate?.classList.remove("hidden");
    protectedArea?.classList.add("hidden");
  }
}

function bindTabs() {
  qsa(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.exam = button.dataset.exam;
      qsa(".tab").forEach((node) => node.classList.toggle("active", node === button));
      renderNews();
    });
  });
}

function bindAuthForms() {
  qs("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setUser({ name: String(form.get("name") || "Aspirant"), exam: "UPSC" });
    window.location.href = "index.html";
  });

  qs("#signup-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setUser({
      name: String(form.get("name") || "Aspirant"),
      exam: String(form.get("exam") || "UPSC")
    });
    window.location.href = "index.html";
  });
}

function renderDashboard() {
  if (document.body.dataset.page !== "dashboard") return;
  const user = currentUser();
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  const node = qs("#dashboard-name");
  if (node) node.textContent = user.name || "Aspirant";
}

function bindHeroMotion() {
  const heroFigure = qs("[data-hero-figure]");
  if (!heroFigure || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const maxScroll = window.innerWidth <= 960 ? 220 : 320;
  const startScale = window.innerWidth <= 960 ? 1.02 : 1.035;
  const endScale = 1;

  function updateHeroMotion() {
    const progress = Math.min(window.scrollY / maxScroll, 1);
    const scale = startScale - (startScale - endScale) * progress;
    const translateY = progress * 12;
    heroFigure.style.transform = `scale(${scale}) translateY(${translateY}px)`;
  }

  updateHeroMotion();
  window.addEventListener("scroll", updateHeroMotion, { passive: true });
  window.addEventListener("resize", updateHeroMotion);
}

function bindExamEntrance() {
  const section = qs("[data-exam-entrance]");
  if (!section) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    section.classList.add("is-visible");
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        section.classList.remove("is-visible");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            section.classList.add("is-visible");
          });
        });
      } else {
        section.classList.remove("is-visible");
      }
    });
  }, {
    threshold: 0.2
  });
  observer.observe(section);
}

function bindTextEntrances() {
  const sections = qsa("[data-text-entrance]");
  if (!sections.length) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const section = entry.target;
      if (entry.isIntersecting) {
        section.classList.remove("is-visible");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            section.classList.add("is-visible");
          });
        });
      } else {
        section.classList.remove("is-visible");
      }
    });
  }, {
    threshold: 0.18
  });
  sections.forEach((section) => observer.observe(section));
}

function bindFeedEntrance() {
  const grid = qs("#news-grid");
  if (!grid) {
    return;
  }
  const cards = qsa(".feed-entrance-item", grid);
  if (!cards.length) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      } else {
        entry.target.classList.remove("is-visible");
      }
    });
  }, {
    threshold: 0.18
  });
  cards.forEach((card) => observer.observe(card));
}

document.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) {
    closeModal();
  }
});

(async function initializeApp() {
  syncAuthUi();
  try {
    const news = await fetchLiveNews();
    if (news.length) {
      liveArticles = news;
    }
  } catch (_error) {
    // keep local fallback dataset
  }
  renderNews();
  renderBrief();
  renderPredictor();
  protectPage();
  bindTabs();
  bindAuthForms();
  bindTeacherControls();
  renderDashboard();
  bindHeroMotion();
  bindExamEntrance();
  bindTextEntrances();
})();
