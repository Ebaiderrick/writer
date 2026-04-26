const WORD_RE = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’\-][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
const LANGUAGE_FILES = {
  en: "../assets/dictionaries/en_US.dic",
  fr: "../assets/dictionaries/fr_FR.dic",
  de: "../assets/dictionaries/de_DE.dic"
};
const LANGUAGE_LOCALES = {
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE"
};
const SCREENPLAY_WORDS = {
  en: [
    "int", "ext", "est", "contd", "continued", "pov", "vo", "os", "beat",
    "montage", "flashback", "slugline", "day", "night", "later", "dawn",
    "dusk", "morning", "evening", "close", "wide", "shot", "insert", "overhead"
  ],
  fr: [
    "int", "ext", "jour", "nuit", "plus", "tard", "aube", "crepuscule",
    "matin", "soir", "plan", "large", "insert", "voix"
  ],
  de: [
    "int", "ext", "tag", "nacht", "spater", "morgen", "abend", "aufnahme",
    "nah", "weit", "insert", "stimme"
  ]
};

const dictionaryCache = new Map();
const dictionaryPromiseCache = new Map();

function getLanguageKey(language) {
  return LANGUAGE_FILES[language] ? language : "en";
}

function getLocale(language) {
  return LANGUAGE_LOCALES[getLanguageKey(language)] || LANGUAGE_LOCALES.en;
}

function createWordIndex(language) {
  return {
    language: getLanguageKey(language),
    words: new Set(),
    byInitial: new Map(),
    byPrefix: new Map(),
    byLength: new Map()
  };
}

function pushToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

function normalizeLookupWord(word, language) {
  return String(word || "")
    .normalize("NFC")
    .replace(/[’`]/g, "'")
    .replace(/^-+|-+$/g, "")
    .replace(/^'+|'+$/g, "")
    .toLocaleLowerCase(getLocale(language));
}

function addIndexedWord(index, word) {
  const normalized = normalizeLookupWord(word, index.language);
  if (!normalized || normalized.length < 2 || /\s/.test(normalized) || index.words.has(normalized)) {
    return;
  }

  index.words.add(normalized);
  pushToMap(index.byInitial, normalized[0], normalized);
  pushToMap(index.byPrefix, normalized.slice(0, 2), normalized);
  pushToMap(index.byLength, String(normalized.length), normalized);
}

function parseHunspellDictionary(raw, language) {
  const index = createWordIndex(language);
  const lines = raw.split(/\r?\n/);
  let passedCount = false;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (!passedCount) {
      if (/^\d+$/.test(trimmed)) {
        passedCount = true;
      }
      return;
    }

    const stem = trimmed.split("/")[0].split(/\s+/)[0].trim();
    if (!stem || stem.startsWith("#")) {
      return;
    }

    if (/^\d+$/.test(stem) && lineIndex > 1) {
      return;
    }

    addIndexedWord(index, stem);
  });

  (SCREENPLAY_WORDS[index.language] || SCREENPLAY_WORDS.en).forEach((word) => addIndexedWord(index, word));
  return index;
}

function tokenizeText(text) {
  const tokens = [];
  const source = String(text || "");
  WORD_RE.lastIndex = 0;

  let match = WORD_RE.exec(source);
  while (match) {
    const value = match[0];
    const start = match.index;
    tokens.push({
      value,
      start,
      end: start + value.length
    });
    match = WORD_RE.exec(source);
  }

  return tokens;
}

function buildEnglishStemCandidates(word) {
  const stems = new Set();
  const push = (candidate) => {
    if (candidate && candidate.length > 1) {
      stems.add(candidate);
    }
  };

  if (word.endsWith("'s")) {
    push(word.slice(0, -2));
  }
  if (word.endsWith("ies")) {
    push(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("ied")) {
    push(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("ing") && word.length > 5) {
    const base = word.slice(0, -3);
    push(base);
    push(`${base}e`);
    if (/(.)\1$/.test(base)) {
      push(base.slice(0, -1));
    }
  }
  if (word.endsWith("ed") && word.length > 4) {
    const base = word.slice(0, -2);
    push(base);
    push(`${base}e`);
    if (/(.)\1$/.test(base)) {
      push(base.slice(0, -1));
    }
  }
  if (word.endsWith("es") && word.length > 4) {
    push(word.slice(0, -2));
    push(word.slice(0, -1));
  }
  if (word.endsWith("s") && word.length > 3) {
    push(word.slice(0, -1));
  }
  if (word.endsWith("ly") && word.length > 4) {
    push(word.slice(0, -2));
  }
  if (word.endsWith("er") && word.length > 4) {
    push(word.slice(0, -2));
  }
  if (word.endsWith("est") && word.length > 5) {
    push(word.slice(0, -3));
  }

  return stems;
}

function buildFrenchStemCandidates(word) {
  const stems = new Set();
  if (word.endsWith("es") && word.length > 4) {
    stems.add(word.slice(0, -2));
  }
  if ((word.endsWith("s") || word.endsWith("x")) && word.length > 3) {
    stems.add(word.slice(0, -1));
  }
  if (word.endsWith("ment") && word.length > 6) {
    stems.add(word.slice(0, -4));
  }
  return stems;
}

function buildGermanStemCandidates(word) {
  const stems = new Set();
  ["en", "er", "es", "e", "n", "s"].forEach((suffix) => {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      stems.add(word.slice(0, -suffix.length));
    }
  });
  return stems;
}

function buildStemCandidates(word, language) {
  const key = getLanguageKey(language);
  if (key === "fr") {
    return buildFrenchStemCandidates(word);
  }
  if (key === "de") {
    return buildGermanStemCandidates(word);
  }
  return buildEnglishStemCandidates(word);
}

function isIgnorableToken(word) {
  if (!word || word.length < 2) {
    return true;
  }
  if (/\d/.test(word)) {
    return true;
  }
  if (/^[A-Z]{1,4}$/.test(word)) {
    return true;
  }
  if (/^[IVXLCM]+$/i.test(word) && word.length <= 6) {
    return true;
  }
  return false;
}

function isRecognizedWord(word, dictionary, lexicon, language) {
  const normalized = normalizeLookupWord(word, language);
  if (!normalized || isIgnorableToken(word)) {
    return true;
  }
  if (dictionary.words.has(normalized) || lexicon.words.has(normalized)) {
    return true;
  }

  const stems = buildStemCandidates(normalized, language);
  for (const candidate of stems) {
    if (dictionary.words.has(candidate) || lexicon.words.has(candidate)) {
      return true;
    }
  }

  return false;
}

function collectCandidates(index, normalizedWord, target) {
  const prefix = normalizedWord.slice(0, 2);
  const initial = normalizedWord[0];

  (index.byPrefix.get(prefix) || []).forEach((candidate) => target.add(candidate));
  (index.byInitial.get(initial) || []).forEach((candidate) => target.add(candidate));

  for (let delta = -1; delta <= 1; delta += 1) {
    (index.byLength.get(String(normalizedWord.length + delta)) || []).forEach((candidate) => target.add(candidate));
  }

  if (target.size < 24) {
    [-2, 2].forEach((delta) => {
      (index.byLength.get(String(normalizedWord.length + delta)) || []).forEach((candidate) => target.add(candidate));
    });
  }
}

function damerauLevenshtein(a, b, maxDistance) {
  const lengthDiff = Math.abs(a.length - b.length);
  if (lengthDiff > maxDistance) {
    return maxDistance + 1;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    table[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    table[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    let rowMin = maxDistance + 1;
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      table[row][col] = Math.min(
        table[row - 1][col] + 1,
        table[row][col - 1] + 1,
        table[row - 1][col - 1] + cost
      );

      if (
        row > 1 &&
        col > 1 &&
        a[row - 1] === b[col - 2] &&
        a[row - 2] === b[col - 1]
      ) {
        table[row][col] = Math.min(table[row][col], table[row - 2][col - 2] + cost);
      }

      rowMin = Math.min(rowMin, table[row][col]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
  }

  return table[rows - 1][cols - 1];
}

function getMaxDistance(word) {
  if (word.length >= 9) {
    return 3;
  }
  if (word.length >= 5) {
    return 2;
  }
  return 1;
}

export function applyWordCase(suggestion, originalWord) {
  if (!suggestion) {
    return "";
  }
  if (originalWord === originalWord.toUpperCase()) {
    return suggestion.toUpperCase();
  }
  if (originalWord === originalWord.toLowerCase()) {
    return suggestion.toLowerCase();
  }
  if (
    originalWord.charAt(0) === originalWord.charAt(0).toUpperCase() &&
    originalWord.slice(1) === originalWord.slice(1).toLowerCase()
  ) {
    return suggestion.charAt(0).toUpperCase() + suggestion.slice(1).toLowerCase();
  }
  return suggestion;
}

export function buildProjectLexicon(project, language) {
  const lexicon = createWordIndex(language);
  if (!project) {
    return lexicon;
  }

  const addText = (text) => {
    tokenizeText(text).forEach(({ value }) => addIndexedWord(lexicon, value));
  };

  [project.title, project.author, project.company, project.contact, project.details]
    .filter(Boolean)
    .forEach(addText);

  (project.lines || []).forEach((line) => {
    if (["character", "scene", "image"].includes(line.type)) {
      addText(line.text);
    }
  });

  return lexicon;
}

export function hasLanguageDictionary(language) {
  return dictionaryCache.has(getLanguageKey(language));
}

export async function ensureLanguageDictionary(language) {
  const key = getLanguageKey(language);
  if (dictionaryCache.has(key)) {
    return dictionaryCache.get(key);
  }
  if (!dictionaryPromiseCache.has(key)) {
    dictionaryPromiseCache.set(
      key,
      fetch(LANGUAGE_FILES[key])
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unable to load dictionary: ${LANGUAGE_FILES[key]}`);
          }
          return response.text();
        })
        .then((raw) => {
          const dictionary = parseHunspellDictionary(raw, key);
          dictionaryCache.set(key, dictionary);
          return dictionary;
        })
    );
  }
  return dictionaryPromiseCache.get(key);
}

export function getSpellingSuggestions(word, options = {}) {
  const language = getLanguageKey(options.language);
  const dictionary = dictionaryCache.get(language);
  if (!dictionary) {
    return [];
  }

  const lexicon = options.lexicon || buildProjectLexicon(options.project, language);
  const normalized = normalizeLookupWord(word, language);
  if (!normalized || isRecognizedWord(word, dictionary, lexicon, language)) {
    return [];
  }

  const candidates = new Set();
  collectCandidates(dictionary, normalized, candidates);
  collectCandidates(lexicon, normalized, candidates);

  const maxDistance = getMaxDistance(normalized);
  const ranked = [];

  candidates.forEach((candidate) => {
    if (candidate === normalized) {
      return;
    }

    const distance = damerauLevenshtein(normalized, candidate, maxDistance);
    if (distance > maxDistance) {
      return;
    }

    const prefixWeight = candidate.startsWith(normalized.slice(0, 2))
      ? 0
      : (candidate.startsWith(normalized[0]) ? 0.25 : 0.75);
    const lengthWeight = Math.abs(candidate.length - normalized.length) * 0.15;
    const lexiconWeight = lexicon.words.has(candidate) ? 0.3 : 0;

    ranked.push({
      value: candidate,
      score: distance + prefixWeight + lengthWeight + lexiconWeight
    });
  });

  return ranked
    .sort((left, right) => left.score - right.score || left.value.localeCompare(right.value, getLocale(language)))
    .map((item) => applyWordCase(item.value, word))
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 6);
}

export function buildSpellingIssues(text, options = {}) {
  const language = getLanguageKey(options.language);
  if (!dictionaryCache.has(language)) {
    return [];
  }

  const lexicon = options.lexicon || buildProjectLexicon(options.project, language);
  return tokenizeText(text)
    .map((token) => {
      const suggestions = getSpellingSuggestions(token.value, {
        ...options,
        language,
        lexicon
      });
      return suggestions.length
        ? { ...token, suggestions }
        : null;
    })
    .filter(Boolean);
}

export function getSpellingContextAtOffset(text, offset, options = {}) {
  const tokens = tokenizeText(text);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const token = tokens.find(({ start, end }) => (
    (safeOffset >= start && safeOffset <= end) ||
    (safeOffset > 0 && safeOffset - 1 >= start && safeOffset - 1 < end)
  ));

  if (!token) {
    return null;
  }

  const suggestions = getSpellingSuggestions(token.value, options);
  if (!suggestions.length) {
    return null;
  }

  return {
    mode: "spelling",
    lineId: options.lineId || "",
    start: token.start,
    end: token.end,
    word: token.value,
    suggestions
  };
}

const GRAMMAR_REPEAT_RE = /\b([a-zA-ZÀ-ÖØ-öø-ÿ]{2,})(?:[\s ]+)\1\b/gi;
const GRAMMAR_MODAL_OF_RE = /\b(should|could|would|must|might)[\s ]+of\b/gi;

export function buildGrammarIssues(text, options = {}) {
  const language = options.language || "en";
  if (language !== "en") return [];

  const issues = [];
  let m;

  GRAMMAR_REPEAT_RE.lastIndex = 0;
  while ((m = GRAMMAR_REPEAT_RE.exec(text)) !== null) {
    issues.push({
      start: m.index,
      end: m.index + m[0].length,
      word: m[0],
      type: "grammar",
      suggestions: [m[1]]
    });
  }

  GRAMMAR_MODAL_OF_RE.lastIndex = 0;
  while ((m = GRAMMAR_MODAL_OF_RE.exec(text)) !== null) {
    const verb = m[1].toLowerCase();
    issues.push({
      start: m.index,
      end: m.index + m[0].length,
      word: m[0],
      type: "grammar",
      suggestions: [`${verb} have`]
    });
  }

  return issues;
}

export function renderSpellingIssues(block, text, issues) {
  block.replaceChildren();
  let cursor = 0;

  issues.forEach((issue) => {
    if (issue.start > cursor) {
      block.append(document.createTextNode(text.slice(cursor, issue.start)));
    }

    const mark = document.createElement("span");
    mark.className = issue.type === "grammar" ? "spelling-error grammar-error" : "spelling-error";
    mark.dataset.spellingStart = String(issue.start);
    mark.dataset.spellingEnd = String(issue.end);
    mark.dataset.spellingWord = issue.word;
    if (issue.type === "grammar" && issue.suggestions?.length) {
      mark.dataset.grammarSuggestions = JSON.stringify(issue.suggestions);
    }
    mark.textContent = text.slice(issue.start, issue.end);
    block.append(mark);
    cursor = issue.end;
  });

  if (cursor < text.length) {
    block.append(document.createTextNode(text.slice(cursor)));
  }
}

export function clearSpellingHighlights(scope = document) {
  scope.querySelectorAll(".spelling-error.is-selected").forEach((node) => node.classList.remove("is-selected"));
}

export function highlightSpellingIssue(block, context) {
  clearSpellingHighlights(block);
  const selector = `.spelling-error[data-spelling-start="${context.start}"][data-spelling-end="${context.end}"]`;
  block.querySelector(selector)?.classList.add("is-selected");
}
