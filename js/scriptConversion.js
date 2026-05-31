import { parseTextToLines } from './utils.js';
import {
  persistConversionJobRecord,
  patchConversionJobRecord,
  attachConversionJobFile,
  getConversionJobRecord
} from './conversionJobStore.js';

const ALLOWED_TYPES = new Set([
  'scene',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'shot',
  'note',
  'image'
]);

const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const CONVERSION_JOB_STORAGE_KEY = 'eyawriter.conversionJobs';

export function getConvertImportEndpoint() {
  const configured = window.EYAWRITER_AI_API_URL || localStorage.getItem('eyawriter.aiApiUrl');
  if (configured) {
    const localDevHost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const localDevPort = window.location.port && window.location.port !== '3001';
    if (localDevHost && localDevPort) {
      return `${window.location.protocol}//${window.location.hostname}:3001/api/convert-script`;
    }

    return configured
      .replace(/\/api\/ai-assist\/?$/i, '/api/convert-script')
      .replace(/\/ai-assist\/?$/i, '/convert-script');
  }

  if (window.location.protocol === 'file:') {
    return 'http://localhost:3001/api/convert-script';
  }

  if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port !== '3001') {
    return `${window.location.protocol}//${window.location.hostname}:3001/api/convert-script`;
  }

  return new URL('/api/convert-script', window.location.origin).toString();
}

export async function extractScriptTextFromFile(file, { onProgress } = {}) {
  const extension = getLowercaseExtension(file.name);

  if (['txt', 'md', 'fountain'].includes(extension)) {
    onProgress?.('Reading your script...');
    return normalizeExtractedText(await file.text());
  }

  if (extension === 'docx') {
    onProgress?.('Extracting text from DOCX...');
    if (!window.mammoth?.extractRawText) {
      throw new Error('DOCX conversion is not ready because the Mammoth parser did not load.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return normalizeExtractedText(result?.value || '');
  }

  if (extension === 'pdf') {
    onProgress?.('Extracting text from PDF...');
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib?.getDocument) {
      throw new Error('PDF conversion is not ready because the PDF parser did not load.');
    }
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.(`Reading PDF page ${pageNumber} of ${pdf.numPages}...`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(extractPdfPageText(content.items || []));
    }
    return normalizeExtractedText(pages.join('\n\n'));
  }

  if (extension === 'doc') {
    throw new Error('Legacy .doc files are not supported yet. Please save the file as .docx or PDF first.');
  }

  throw new Error('This file type is not supported for Convert & import yet.');
}

export async function convertScriptTextToLines(rawText, {
  fileName = '',
  onProgress,
  jobId = '',
  projectId = ''
} = {}) {
  const normalizedText = normalizeExtractedText(rawText);
  if (!normalizedText.trim()) {
    throw new Error('No readable text was found in that file.');
  }

  const warnings = [];
  let usedFallback = false;
  const job = jobId
    ? {
      id: jobId,
      fileName: fileName || 'script',
      projectId,
      rawText: normalizedText
    }
    : createConversionJob({
      fileName,
      rawText: normalizedText,
      projectId
    });

  if (!jobId) {
    await persistConversionJobRecord(job);
  }

  await updateConversionJob(job.id, {
    fileName: fileName || job.fileName || 'script',
    projectId,
    rawText: normalizedText,
    status: 'preparing',
    stageLabel: 'Preparing document memory',
    warnings
  });
  onProgress?.('Preparing backend memory for this script...');

  const normalizationSource = buildNormalizationPayload(normalizedText);
  const normalizationChunks = chunkScriptText(normalizationSource, 8000);
  const normalizedChunks = [];

  for (let index = 0; index < normalizationChunks.length; index += 1) {
    const chunk = normalizationChunks[index];
    const stageLabel = `Normalizing screenplay text (${index + 1}/${normalizationChunks.length})`;
    onProgress?.(stageLabel);
    await updateConversionJob(job.id, {
      status: 'normalizing',
      stageLabel,
      normalizationProgress: {
        current: index + 1,
        total: normalizationChunks.length
      }
    });
    try {
      const response = await requestConversionStage('normalize', chunk, {
        fileName,
        chunkIndex: index,
        chunkCount: normalizationChunks.length,
        jobId: job.id
      });
      if (!String(response.text || '').trim()) {
        throw new Error('The AI did not return normalized screenplay text.');
      }
      normalizedChunks.push(normalizeExtractedText(response.text));
      warnings.push(...(response.warnings || []));
    } catch (error) {
      usedFallback = true;
      warnings.push(error.message || 'Normalization failed for part of the script, so the extracted text was kept for that section.');
      normalizedChunks.push(heuristicNormalizeText(parseNormalizationChunk(chunk)));
    }
  }

  const normalizedScreenplayText = normalizeExtractedText(normalizedChunks.join('\n\n')) || heuristicNormalizeText(normalizedText);
  await updateConversionJob(job.id, {
    status: 'normalized',
    stageLabel: 'Normalized screenplay text ready',
    normalizedText: normalizedScreenplayText,
    warnings
  });

  const candidates = buildConversionCandidates(normalizedScreenplayText);
  const candidatePayload = buildCandidatePayload(candidates);
  const chunks = chunkScriptText(candidatePayload, 7000);
  const convertedLines = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const stageLabel = `Structuring screenplay blocks (${index + 1}/${chunks.length})...`;
    onProgress?.(stageLabel);
    await updateConversionJob(job.id, {
      status: 'structuring',
      stageLabel,
      structureProgress: {
        current: index + 1,
        total: chunks.length
      }
    });

    try {
      const response = await requestConversionStage('structure', chunk, {
        fileName,
        chunkIndex: index,
        chunkCount: chunks.length,
        jobId: job.id
      });
      const safeLines = sanitizeConvertedLines(response.lines);
      if (!safeLines.length) {
        throw new Error('The AI did not return any screenplay blocks.');
      }
      convertedLines.push(...safeLines);
      warnings.push(...(response.warnings || []));
    } catch (error) {
      usedFallback = true;
      warnings.push(error.message || 'AI conversion failed for part of the script, so a plain import was used instead.');
      convertedLines.push(...fallbackCandidatesToLines(parseCandidateChunk(chunk)));
    }
  }

  await updateConversionJob(job.id, {
    status: usedFallback ? 'completed-with-fallback' : 'completed',
    stageLabel: usedFallback ? 'Imported with fallback review needed' : 'Conversion complete',
    structuredLines: convertedLines,
    structuredLineCount: convertedLines.length,
    warnings
  });

  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];

  return {
    lines: convertedLines.length ? convertedLines : fallbackCandidatesToLines(candidates),
    warnings: uniqueWarnings,
    usedFallback,
    jobId: job.id
  };
}

export async function beginConversionUpload({ fileName = '', projectId = '' } = {}) {
  const job = createConversionJob({
    fileName,
    rawText: '',
    projectId
  });
  await persistConversionJobRecord(job);
  await updateConversionJob(job.id, {
    projectId,
    status: 'uploading',
    stageLabel: 'Uploading source file',
    sourceFile: {
      name: fileName || 'script'
    }
  });
  return job.id;
}

export function attachSourceFileToConversionJob(jobId, file) {
  if (!jobId || !file) return;
  return attachConversionJobFile(jobId, file);
}

export function markConversionExtractionStarted(jobId) {
  return updateConversionJob(jobId, {
    status: 'extracting',
    stageLabel: 'Extracting readable text'
  });
}

export function attachRawTextToConversionJob(jobId, rawText) {
  return updateConversionJob(jobId, {
    rawText: normalizeExtractedText(rawText),
    extractedAt: new Date().toISOString()
  });
}

export function markConversionImporting(jobId, lineCount = 0) {
  return updateConversionJob(jobId, {
    status: 'importing',
    stageLabel: 'Importing screenplay into project',
    structuredLineCount: lineCount
  });
}

export function finalizeConversionImport(jobId, { usedFallback = false, warnings = [], lineCount = 0 } = {}) {
  return updateConversionJob(jobId, {
    status: usedFallback ? 'imported-with-fallback' : 'imported',
    stageLabel: usedFallback ? 'Imported with fallback review needed' : 'Imported into project',
    warnings,
    structuredLineCount: lineCount,
    completedAt: new Date().toISOString()
  });
}

export function failConversionJob(jobId, message) {
  return updateConversionJob(jobId, {
    status: 'failed',
    stageLabel: 'Conversion failed',
    warnings: message ? [String(message)] : [],
    failedAt: new Date().toISOString()
  });
}

async function requestConversionStage(stage, text, metadata) {
  const jobRecord = metadata?.jobId ? await getConversionJobRecord(metadata.jobId) : null;
  const operatorGuidance = String(jobRecord?.operatorGuidance || '').trim();
  const response = await fetch(getConvertImportEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stage,
      text,
      operatorGuidance,
      ...metadata
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Conversion failed with status ${response.status}.`);
  }

  const lines = Array.isArray(data?.lines) ? data.lines : [];
  return {
    text: typeof data?.text === 'string' ? data.text : '',
    lines,
    warnings: Array.isArray(data?.warnings) ? data.warnings : []
  };
}

function sanitizeConvertedLines(lines) {
  return (lines || []).reduce((accumulator, line) => {
    const text = String(line?.text || '').replace(/\r/g, '').trim();
    let type = String(line?.type || 'action').trim().toLowerCase();
    if (!text) {
      return accumulator;
    }
    const previousType = accumulator[accumulator.length - 1]?.type || '';
    if (
      type === 'action'
      && (previousType === 'character' || previousType === 'parenthetical')
      && looksLikeDialogueText(text)
    ) {
      type = 'dialogue';
    }

    if (type === 'dialogue' && previousType === 'dialogue') {
      accumulator[accumulator.length - 1].text = `${accumulator[accumulator.length - 1].text} ${text}`.replace(/\s+/g, ' ').trim();
      return accumulator;
    }

    accumulator.push({
      type: ALLOWED_TYPES.has(type) ? type : 'action',
      text
    });
    return accumulator;
  }, []);
}

function fallbackCandidatesToLines(candidates) {
  return (candidates || []).reduce((accumulator, candidate) => {
    const text = String(candidate?.text || '').trim();
    if (!text) return accumulator;

    if (candidate?.kind === 'dialogue-block' && Array.isArray(candidate.parts)) {
      candidate.parts.forEach((part) => {
        if (part.type && part.text) {
          accumulator.push({
            type: part.type,
            text: part.text
          });
        }
      });
      return accumulator;
    }

    accumulator.push({
      type: normalizeCandidateKind(candidate?.kind),
      text
    });
    return accumulator;
  }, []);
}

function chunkScriptText(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/).map((part) => part.replace(/\s+$/g, '')).filter((part) => part.trim());
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    const slices = paragraph.match(new RegExp(`[\\s\\S]{1,${Math.max(1000, maxChars - 200)}}`, 'g')) || [paragraph];
    chunks.push(...slices);
    current = '';
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [text];
}

function extractPdfPageText(items) {
  let currentY = null;
  let currentLine = [];
  const lines = [];

  for (const item of items) {
    const value = String(item?.str || '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const y = item?.transform?.[5] ?? currentY;
    const x = item?.transform?.[4] ?? 0;

    if (currentY !== null && y !== null && Math.abs(y - currentY) > 2.5) {
      lines.push(finalizePdfLine(currentLine));
      currentLine = [];
    }

    currentLine.push({ text: value, x });
    currentY = y;
  }

  if (currentLine.length) {
    lines.push(finalizePdfLine(currentLine));
  }

  return lines.filter(Boolean).join('\n');
}

function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function heuristicNormalizeText(value) {
  const text = normalizeExtractedText(value);
  if (!text) return '';
  const candidates = buildConversionCandidates(text);
  return candidates.map((candidate) => candidateToNormalizedBlock(candidate)).filter(Boolean).join('\n\n');
}

function getLowercaseExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || '';
}

function looksLikeDialogueText(text) {
  if (!text) return false;
  if (/^(INT\.|EXT\.|CUT TO:|DISSOLVE TO:|SMASH CUT TO:|FADE OUT\.|CLOSE ON|WIDE SHOT|INSERT|POV)/i.test(text)) {
    return false;
  }
  if (/^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) {
    return false;
  }
  return !/^[A-Z0-9 .'\-()]+$/.test(text);
}

function finalizePdfLine(parts) {
  if (!parts.length) return '';
  const averageX = parts.reduce((sum, part) => sum + (Number(part.x) || 0), 0) / parts.length;
  const indent = buildIndentFromX(averageX);
  const joined = parts.map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim();
  return `${indent}${joined}`.replace(/\s+$/g, '');
}

function buildIndentFromX(x) {
  if (x >= 330) return '            ';
  if (x >= 270) return '        ';
  if (x >= 220) return '      ';
  if (x >= 170) return '   ';
  return '';
}

function buildAnnotatedConversionText(text) {
  const lines = String(text || '').split('\n');
  const annotated = [];

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const trimmed = original.trim();
    if (!trimmed) {
      annotated.push('');
      continue;
    }

    const next = (lines[index + 1] || '').trim();
    const prev = (lines[index - 1] || '').trim();
    const indent = original.match(/^\s*/)?.[0]?.length || 0;
    const hints = [];

    if (/^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(trimmed)) hints.push('scene');
    if (/^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.)/i.test(trimmed)) hints.push('transition');
    if (/^\(.*\)$/.test(trimmed)) hints.push('parenthetical');
    if (trimmed === trimmed.toUpperCase() && trimmed.length <= 32 && !/[.:]/.test(trimmed)) hints.push('character-cue');
    if (indent >= 8) hints.push('indented');
    if (indent <= 3) hints.push('left-margin');
    if (prev && prev === prev.toUpperCase() && prev.length <= 32 && !/[.:]/.test(prev)) hints.push('follows-character');
    if (next && next === next.toUpperCase() && next.length <= 32 && !/[.:]/.test(next)) hints.push('before-character');

    annotated.push(`[line ${index + 1}${hints.length ? ` | ${hints.join(', ')}` : ''}] ${trimmed}`);
  }

  return annotated.join('\n');
}

function buildNormalizationPayload(text) {
  return String(text || '')
    .split('\n')
    .map((rawLine, index) => {
      const indent = rawLine.match(/^\s*/)?.[0]?.length || 0;
      const trimmed = rawLine.trim();
      if (!trimmed) {
        return `[source break ${index + 1}]`;
      }
      return `[source line ${index + 1} | indent=${indent}] ${trimmed}`;
    })
    .join('\n');
}

function buildConversionCandidates(text) {
  const physicalLines = String(text || '').split('\n').map((raw, index) => {
    const indent = raw.match(/^\s*/)?.[0]?.length || 0;
    return {
      raw,
      text: raw.trim(),
      indent,
      index
    };
  });

  const candidates = [];
  let cursor = 0;

  while (cursor < physicalLines.length) {
    const line = physicalLines[cursor];
    if (!line.text) {
      cursor += 1;
      continue;
    }

    if (isSceneLike(line.text)) {
      candidates.push(makeCandidate('scene', [line]));
      cursor += 1;
      continue;
    }

    if (isTransitionLike(line.text)) {
      candidates.push(makeCandidate('transition', [line]));
      cursor += 1;
      continue;
    }

    if (isShotLike(line.text)) {
      candidates.push(makeCandidate('shot', [line]));
      cursor += 1;
      continue;
    }

    if (isCharacterCueLike(line.text)) {
      const parts = [{ type: 'character', text: line.text }];
      cursor += 1;

      while (cursor < physicalLines.length && !physicalLines[cursor].text) {
        cursor += 1;
      }

      if (cursor < physicalLines.length && isParentheticalLike(physicalLines[cursor].text)) {
        parts.push({ type: 'parenthetical', text: physicalLines[cursor].text });
        cursor += 1;
      }

      const dialogueLines = [];
      while (cursor < physicalLines.length) {
        const next = physicalLines[cursor];
        if (!next.text) break;
        if (isSceneLike(next.text) || isTransitionLike(next.text) || isShotLike(next.text) || isCharacterCueLike(next.text)) {
          break;
        }
        dialogueLines.push(next.text);
        cursor += 1;
      }

      if (dialogueLines.length) {
        parts.push({ type: 'dialogue', text: joinWrappedLines(dialogueLines) });
      }

      candidates.push({
        kind: 'dialogue-block',
        text: parts.map((part) => part.text).join('\n'),
        parts
      });
      continue;
    }

    const blockLines = [line.text];
    cursor += 1;

    while (cursor < physicalLines.length) {
      const next = physicalLines[cursor];
      if (!next.text) break;
      if (isSceneLike(next.text) || isTransitionLike(next.text) || isShotLike(next.text) || isCharacterCueLike(next.text)) {
        break;
      }
      if (next.indent >= 6 && blockLines.length) {
        break;
      }
      blockLines.push(next.text);
      cursor += 1;
    }

    candidates.push({
      kind: 'action',
      text: joinWrappedLines(blockLines)
    });
  }

  return candidates;
}

function buildCandidatePayload(candidates) {
  return candidates.map((candidate, index) => {
    const hints = [];
    if (candidate.kind === 'dialogue-block') hints.push('locked-dialogue-sequence');
    if (candidate.kind === 'scene') hints.push('scene-heading');
    if (candidate.kind === 'transition') hints.push('transition');
    if (candidate.kind === 'shot') hints.push('shot');
    return `[candidate ${index + 1}${hints.length ? ` | ${hints.join(', ')}` : ''}] ${candidate.text}`;
  }).join('\n\n');
}

function parseCandidateChunk(chunkText) {
  return String(chunkText || '')
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const cleaned = entry.replace(/^\[candidate[^\]]+\]\s*/i, '').trim();
      const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!lines.length) {
        return null;
      }
      if (lines.length >= 2 && isCharacterCueLike(lines[0])) {
        const parts = [{ type: 'character', text: lines[0] }];
        let startIndex = 1;
        if (lines[1] && isParentheticalLike(lines[1])) {
          parts.push({ type: 'parenthetical', text: lines[1] });
          startIndex = 2;
        }
        if (lines[startIndex]) {
          parts.push({ type: 'dialogue', text: joinWrappedLines(lines.slice(startIndex)) });
        }
        return {
          kind: 'dialogue-block',
          text: lines.join('\n'),
          parts
        };
      }
      const text = joinWrappedLines(lines);
      if (isSceneLike(text)) return { kind: 'scene', text };
      if (isTransitionLike(text)) return { kind: 'transition', text };
      if (isShotLike(text)) return { kind: 'shot', text };
      return { kind: 'action', text };
    })
    .filter(Boolean);
}

function parseNormalizationChunk(chunkText) {
  return String(chunkText || '')
    .split('\n')
    .map((entry) => {
      if (/^\[source break/i.test(entry.trim())) {
        return '';
      }
      return entry.replace(/^\[source (?:line|break)[^\]]*\]\s*/i, '').trim();
    })
    .join('\n');
}

function makeCandidate(kind, sourceLines) {
  return {
    kind,
    text: joinWrappedLines(sourceLines.map((line) => line.text))
  };
}

function joinWrappedLines(lines) {
  return (lines || [])
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateToNormalizedBlock(candidate) {
  if (!candidate) return '';
  if (candidate.kind === 'dialogue-block' && Array.isArray(candidate.parts)) {
    return candidate.parts.map((part) => part.text).filter(Boolean).join('\n');
  }
  return String(candidate.text || '').trim();
}

function isSceneLike(text) {
  return /^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(text);
}

function isTransitionLike(text) {
  return /^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.|FADE TO BLACK\.)/i.test(text);
}

function isShotLike(text) {
  return /^(CLOSE ON|WIDE SHOT|INSERT|POV|OVERHEAD SHOT|ANGLE ON|TRACKING SHOT)/i.test(text);
}

function isParentheticalLike(text) {
  return /^\(.*\)$/.test(text);
}

function isCharacterCueLike(text) {
  if (!text || text.length > 32 || /:/.test(text) || /\.$/.test(text)) return false;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized === normalized.toUpperCase();
}

function normalizeCandidateKind(kind) {
  if (['scene', 'transition', 'shot', 'note', 'image', 'action', 'character', 'dialogue', 'parenthetical'].includes(kind)) {
    return kind;
  }
  return 'action';
}

function createConversionJob({ fileName, rawText, projectId = '' }) {
  const job = {
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName: fileName || 'script',
    projectId,
    createdAt: new Date().toISOString(),
    status: 'queued',
    stageLabel: 'Queued',
    rawText,
    normalizedText: '',
    structuredLines: [],
    warnings: []
  };
  updateStoredJobs((jobs) => [job, ...jobs].slice(0, 4));
  return job;
}

function updateConversionJob(jobId, patch) {
  if (!jobId) return Promise.resolve(null);
  let nextJob = null;
  updateStoredJobs((jobs) => {
    let found = false;
    const updatedAt = new Date().toISOString();
    const nextJobs = jobs.map((job) => {
      if (job.id !== jobId) return job;
      found = true;
      nextJob = { ...job, ...patch, updatedAt };
      return nextJob;
    });
    if (!found) {
      nextJob = { id: jobId, ...patch, updatedAt };
      return [nextJob, ...nextJobs].slice(0, 8);
    }
    return nextJobs;
  });
  const payload = nextJob || { id: jobId, ...patch };
  try {
    window.dispatchEvent(new CustomEvent('eyawriter:conversion-job-updated', {
      detail: {
        jobId,
        record: payload
      }
    }));
  } catch {
    // Ignore event dispatch issues and keep the conversion pipeline moving.
  }
  return patchConversionJobRecord(jobId, payload);
}

export async function waitForConversionJobRecord(jobId, { timeoutMs = 4000, requireStructuredData = false } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = await getConversionJobRecord(jobId);
    if (record && (!requireStructuredData || Array.isArray(record.structuredLines) && record.structuredLines.length)) {
      return record;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return getConversionJobRecord(jobId);
}

function updateStoredJobs(mutator) {
  try {
    const current = JSON.parse(localStorage.getItem(CONVERSION_JOB_STORAGE_KEY) || '[]');
    const next = mutator(Array.isArray(current) ? current : []);
    localStorage.setItem(CONVERSION_JOB_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage issues; conversion should still continue.
  }
}
