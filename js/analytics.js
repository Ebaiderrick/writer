import { serializeScript } from './project.js';

export function calculateAnalytics(project, filter = 'all') {
  const text = serializeScript(project);
  const words = text.match(/\b[\w'-]+\b/g) || [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  const wordFreq = {};
  words.forEach(w => {
    const val = w.toLowerCase();
    if (val.length > 3) {
      wordFreq[val] = (wordFreq[val] || 0) + 1;
    }
  });

  const sortedFreq = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;

  // Style breakdown
  let dialogueWords = 0;
  let narrationWords = 0;

  project.lines.forEach(line => {
    if (filter !== 'all' && line.type !== filter) return;
    const count = (line.text.match(/\b[\w'-]+\b/g) || []).length;
    if (line.type === 'dialogue') {
      dialogueWords += count;
    } else if (line.type === 'action' || line.type === 'scene') {
      narrationWords += count;
    }
  });

  const totalActionDialogue = dialogueWords + narrationWords || 1;

  return {
    totalWords: words.length,
    totalSentences: sentences.length,
    avgSentenceLength: avgSentenceLength.toFixed(1),
    topWords: sortedFreq,
    dialoguePercent: Math.round((dialogueWords / totalActionDialogue) * 100),
    narrationPercent: Math.round((narrationWords / totalActionDialogue) * 100),
    readability: calculateReadability(words.length, sentences.length, text)
  };
}

function calculateReadability(wordCount, sentenceCount, text) {
  if (wordCount === 0 || sentenceCount === 0) return "N/A";

  // Simple Flesch-Kincaid grade level approximation
  const syllables = text.match(/[aeiouy]{1,2}/gi)?.length || 0;
  const score = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllables / wordCount) - 15.59;

  if (score <= 6) return "Easy";
  if (score <= 10) return "Average";
  if (score <= 14) return "Professional";
  return "Complex";
}
