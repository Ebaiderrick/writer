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
const OCR_MIN_TEXT_CHARS_PER_PAGE = 140;
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
    const extracted = normalizeExtractedText(pages.join('\n\n'));
    const readability = assessPdfTextExtraction(pages);
    if (readability.needsOcr) {
      if (!window.Tesseract?.recognize) {
        throw new Error('This PDF looks scanned or image-based. OCR is not available in this browser, so please try a text-searchable PDF or DOCX.');
      }
      onProgress?.('Readable PDF text was too weak. Running OCR on the scanned pages...');
      const ocrText = await ocrPdfWithTesseract(pdf, {
        onProgress: (message) => onProgress?.(message)
      });
      const normalizedOcr = normalizeExtractedText(ocrText);
      if (!normalizedOcr.trim()) {
        throw new Error('OCR could not recover enough readable text from this PDF. Try a cleaner scan or a DOCX export.');
      }
      return normalizedOcr;
    }
    return extracted;
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
  projectId = '',
  preparedNormalizedText = '',
  preparedCoverPage = null
} = {}) {
  const extractedText = normalizeExtractedText(rawText);
  if (!extractedText.trim()) {
    throw new Error('No readable text was found in that file.');
  }

  const warnings = [];
  let usedFallback = false;
  const job = jobId
    ? {
      id: jobId,
      fileName: fileName || 'script',
      projectId,
      rawText: extractedText
    }
    : createConversionJob({
      fileName,
      rawText: extractedText,
      projectId
    });

  if (!jobId) {
    await persistConversionJobRecord(job);
  }

  await updateConversionJob(job.id, {
    fileName: fileName || job.fileName || 'script',
    projectId,
    rawText: extractedText,
    status: 'preparing',
    stageLabel: 'Preparing document memory',
    warnings
  });
  onProgress?.('Preparing backend memory for this script...');

  const separatedCover = separateCoverPageFromScript(extractedText);
  const screenplayBodyText = preparePreStructureText(separatedCover.bodyText || extractedText);
  let coverPage = normalizeCoverPageCandidate(preparedCoverPage) || normalizeCoverPageCandidate(separatedCover.coverPage);
  let normalizedScreenplayText = normalizeExtractedText(preparedNormalizedText);

  await updateConversionJob(job.id, {
    status: 'cover',
    stageLabel: 'Separating cover page',
    coverPageCandidate: coverPage,
    coverPageSourceText: separatedCover.coverText || ''
  });
  onProgress?.('Separating cover page from screenplay body...');

  if (!normalizeCoverPageCandidate(preparedCoverPage) && separatedCover.coverText) {
    try {
      const coverResponse = await requestConversionStage('cover', separatedCover.coverText, {
        fileName,
        chunkIndex: 0,
        chunkCount: 1,
        jobId: job.id
      });
      coverPage = normalizeCoverPageCandidate(coverResponse.coverPage) || coverPage;
      warnings.push(...(coverResponse.warnings || []));
      await updateConversionJob(job.id, {
        coverPageCandidate: coverPage,
        warnings
      });
    } catch (error) {
      warnings.push(error.message || 'Cover page extraction failed, so the title page fields need a manual review.');
    }
  }

  if (!normalizedScreenplayText) {
    const normalizationSource = buildNormalizationPayload(screenplayBodyText);
    const normalizationChunks = chunkScriptText(normalizationSource, 8000);
    const normalizedChunks = [];
    let normalizationMemory = {
      lastScene: '',
      recentSpeakers: []
    };

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
          continuity: normalizationMemory,
          jobId: job.id
        });
        if (!String(response.text || '').trim()) {
          throw new Error('The AI did not return normalized screenplay text.');
        }
        normalizedChunks.push(normalizeExtractedText(response.text));
        normalizationMemory = updateChunkContinuityMemory(normalizationMemory, response.text);
        if (!coverPage) {
          coverPage = normalizeCoverPageCandidate(response.coverPage);
        }
        warnings.push(...(response.warnings || []));
      } catch (error) {
        usedFallback = true;
        warnings.push(error.message || 'Normalization failed for part of the script, so the extracted text was kept for that section.');
        normalizedChunks.push(heuristicNormalizeText(parseNormalizationChunk(chunk)));
      }
    }

    normalizedScreenplayText = normalizeExtractedText(normalizedChunks.join('\n\n')) || heuristicNormalizeText(screenplayBodyText);
  } else {
    onProgress?.('Using your saved normalized screenplay text...');
  }

  if (!coverPage) {
    coverPage = detectCoverPageCandidate(extractedText);
  }
  await updateConversionJob(job.id, {
    status: 'normalized',
    stageLabel: 'Normalized screenplay text ready',
    rawText: screenplayBodyText,
    normalizedText: normalizedScreenplayText,
    coverPageCandidate: coverPage,
    coverPageSourceText: separatedCover.coverText || '',
    warnings
  });

  const candidates = buildConversionCandidates(normalizedScreenplayText);
  const candidatePayload = buildCandidatePayload(candidates);
  const chunks = chunkScriptText(candidatePayload, 7000);
  const convertedLines = [];
  let structureMemory = {
    lastScene: '',
    recentSpeakers: []
  };

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
        continuity: structureMemory,
        jobId: job.id
      });
      const safeLines = sanitizeConvertedLines(response.lines);
      if (!safeLines.length) {
        throw new Error('The AI did not return any screenplay blocks.');
      }
      convertedLines.push(...safeLines);
      structureMemory = updateChunkContinuityMemoryFromLines(structureMemory, safeLines);
      warnings.push(...(response.warnings || []));
    } catch (error) {
      usedFallback = true;
      warnings.push(error.message || 'AI conversion failed for part of the script, so a plain import was used instead.');
      convertedLines.push(...fallbackCandidatesToLines(parseCandidateChunk(chunk)));
    }
  }

  const latestRecord = await getConversionJobRecord(job.id);
  const savedRawText = String(latestRecord?.rawText || '').trim();
  const savedNormalizedText = String(latestRecord?.normalizedText || '').trim();
  const savedCoverPage = normalizeCoverPageCandidate(latestRecord?.coverPageCandidate);
  const hasEditedRawText = Boolean(latestRecord?.rawTextEditedAt && savedRawText);
  const hasEditedNormalizedText = Boolean(latestRecord?.normalizedTextEditedAt && savedNormalizedText);
  const finalRawText = hasEditedRawText ? savedRawText : screenplayBodyText;
  const finalNormalizedText = hasEditedNormalizedText ? savedNormalizedText : normalizedScreenplayText;
  const finalCoverPage = savedCoverPage || coverPage;
  const finalLines = hasEditedNormalizedText
    ? buildLocalStructuredPreview(finalNormalizedText)
    : convertedLines;

  await updateConversionJob(job.id, {
    status: usedFallback ? 'completed-with-fallback' : 'completed',
    stageLabel: usedFallback ? 'Imported with fallback review needed' : 'Conversion complete',
    rawText: finalRawText,
    normalizedText: finalNormalizedText,
    coverPageCandidate: finalCoverPage,
    structuredLines: finalLines,
    structuredLineCount: finalLines.length,
    warnings
  });

  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];

  return {
    lines: finalLines.length ? finalLines : fallbackCandidatesToLines(candidates),
    warnings: uniqueWarnings,
    usedFallback,
    coverPage: finalCoverPage,
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
  const extracted = normalizeExtractedText(rawText);
  const separated = separateCoverPageFromScript(extracted);
  return updateConversionJob(jobId, {
    rawText: preparePreStructureText(separated.bodyText || extracted),
    coverPageCandidate: separated.coverPage || null,
    coverPageSourceText: separated.coverText || '',
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
    coverPage: normalizeCoverPageCandidate(data?.coverPage),
    warnings: Array.isArray(data?.warnings) ? data.warnings : []
  };
}

function normalizeCoverPageCandidate(coverPage) {
  if (!coverPage || typeof coverPage !== 'object') return null;
  const normalized = {
    title: String(coverPage.title || '').trim(),
    author: String(coverPage.author || '').trim(),
    contact: String(coverPage.contact || '').trim(),
    company: String(coverPage.company || '').trim(),
    details: String(coverPage.details || '').trim(),
    logline: String(coverPage.logline || '').trim()
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

export function separateCoverPageFromScript(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n');

  const trimmedLines = lines.map((line) => line.trim());
  const firstSceneIndex = trimmedLines.findIndex((line) => /^(INT\.|EXT\.|EST\.|INT\/EXT\.|INT\.\/EXT\.)/i.test(line));
  if (firstSceneIndex <= 1) {
    return {
      coverText: '',
      bodyText: normalizeExtractedText(text),
      coverPage: null
    };
  }

  const coverLines = lines.slice(0, firstSceneIndex);
  const bodyLines = lines.slice(firstSceneIndex);
  const coverText = normalizeExtractedText(coverLines.join('\n'));
  const bodyText = normalizeExtractedText(bodyLines.join('\n'));
  const coverPage = detectCoverPageCandidate(coverText);

  if (!coverPage && coverText.split('\n').filter(Boolean).length < 3) {
    return {
      coverText: '',
      bodyText: normalizeExtractedText(text),
      coverPage: null
    };
  }

  return {
    coverText,
    bodyText: bodyText || normalizeExtractedText(text),
    coverPage
  };
}

export function detectCoverPageCandidate(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24);
  if (!lines.length) return null;
  const sceneIndex = lines.findIndex((line) => /^(INT\.|EXT\.|EST\.|INT\/EXT\.|INT\.\/EXT\.)/i.test(line));
  const coverLines = sceneIndex >= 0 ? lines.slice(0, sceneIndex) : lines;
  if (coverLines.length < 3) return null;
  const byIndex = coverLines.findIndex((line) => /^(by|written by|screenplay by|a screenplay by)$/i.test(line));
  const title = detectCoverTitleLine(coverLines);
  const titleIndex = title ? coverLines.indexOf(title) : 0;
  const author = byIndex >= 0
    ? inferCoverAuthor(coverLines.slice(byIndex + 1))
    : inferCoverAuthor(coverLines.slice(titleIndex + 1));
  const metaStartIndex = byIndex >= 0
    ? Math.max(byIndex + 1 + (author ? 1 : 0), titleIndex + 1)
    : titleIndex + 1;
  const metaLines = coverLines
    .slice(metaStartIndex)
    .filter((line) => line !== author && line !== title && !isCoverMetaNoise(line));
  const contact = metaLines.find((line) => /@|\+?\d[\d\s().-]{6,}/.test(line)) || '';
  const company = metaLines.find((line) => /productions?|pictures?|studios?|films?/i.test(line)) || '';
  const logline = metaLines.find((line) => /^logline[:\s-]/i.test(line))
    || metaLines.find((line) => /[.!?]/.test(line) && line.length > 45)
    || '';
  const details = metaLines.filter((line) => line && line !== contact && line !== company && line !== logline).join(' | ');
  return normalizeCoverPageCandidate({ title, author, contact, company, details, logline });
}

function sanitizeConvertedLines(lines) {
  const normalized = (lines || []).reduce((accumulator, line) => {
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

  return repairConvertedLines(normalized);
}

export function buildLocalStructuredPreview(text) {
  const prepared = preparePreStructureText(String(text || ''));
  if (!prepared) return [];
  const candidates = buildConversionCandidates(prepared);
  if (!candidates.length) return [];
  return sanitizeConvertedLines(fallbackCandidatesToLines(candidates));
}

export function buildConversionVersionSnapshot(record, { label = '', reason = '' } = {}) {
  if (!record) return null;
  const structuredLines = Array.isArray(record.structuredLines) ? record.structuredLines : [];
  const createdAt = new Date().toISOString();
  const lineCount = Number(record.structuredLineCount || structuredLines.length || 0);
  return {
    id: `pass_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: String(label || record.stageLabel || record.status || 'Saved pass'),
    reason: String(reason || '').trim(),
    createdAt,
    status: String(record.status || 'queued'),
    stageLabel: String(record.stageLabel || ''),
    warnings: Array.isArray(record.warnings) ? record.warnings.filter(Boolean).slice(0, 20) : [],
    rawText: String(record.rawText || ''),
    normalizedText: String(record.normalizedText || ''),
    structuredLines: structuredLines.map((line) => ({
      type: String(line?.type || 'action'),
      text: String(line?.text || '')
    })),
    structuredLineCount: lineCount,
    coverPageCandidate: record.coverPageCandidate || null,
    operatorGuidance: String(record.operatorGuidance || '')
  };
}

export async function appendConversionJobVersion(jobId, recordOverride = null, meta = {}) {
  if (!jobId) return null;
  const record = recordOverride || await getConversionJobRecord(jobId);
  if (!record) return null;
  const snapshot = buildConversionVersionSnapshot(record, meta);
  if (!snapshot) return record;
  const versions = Array.isArray(record.versions) ? record.versions.slice(-7) : [];
  const lastVersion = versions[versions.length - 1] || null;
  const lastKey = lastVersion
    ? `${lastVersion.status}|${lastVersion.stageLabel}|${lastVersion.structuredLineCount}|${String(lastVersion.normalizedText || '').slice(0, 240)}`
    : '';
  const nextKey = `${snapshot.status}|${snapshot.stageLabel}|${snapshot.structuredLineCount}|${String(snapshot.normalizedText || '').slice(0, 240)}`;
  if (lastKey === nextKey) {
    return record;
  }
  return patchConversionJobRecord(jobId, {
    versions: [...versions, snapshot],
    activeVersionId: snapshot.id
  });
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

export function assessPdfTextExtraction(pageSegments) {
  const pages = Array.isArray(pageSegments) ? pageSegments.map((page) => normalizeExtractedText(page)) : [];
  const nonEmptyPages = pages.filter(Boolean);
  const totalChars = nonEmptyPages.reduce((sum, page) => sum + page.replace(/\s+/g, '').length, 0);
  const avgCharsPerPage = nonEmptyPages.length ? totalChars / nonEmptyPages.length : 0;
  const pagesWithVeryLowText = nonEmptyPages.filter((page) => page.replace(/\s+/g, '').length < 80).length;
  const needsOcr = nonEmptyPages.length > 0 && (
    avgCharsPerPage < OCR_MIN_TEXT_CHARS_PER_PAGE
    || pagesWithVeryLowText >= Math.ceil(nonEmptyPages.length * 0.6)
  );
  return {
    totalPages: pages.length,
    nonEmptyPages: nonEmptyPages.length,
    avgCharsPerPage,
    pagesWithVeryLowText,
    needsOcr
  };
}

async function ocrPdfWithTesseract(pdf, { onProgress } = {}) {
  const collected = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;

    onProgress?.(`Running OCR on PDF page ${pageNumber} of ${pdf.numPages}...`);
    const result = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (message) => {
        if (message?.status === 'recognizing text' && Number.isFinite(message.progress)) {
          onProgress?.(`Running OCR on PDF page ${pageNumber} of ${pdf.numPages}... ${Math.round(message.progress * 100)}%`);
        }
      }
    });
    collected.push(normalizeExtractedText(result?.data?.text || ''));
  }
  return collected.filter(Boolean).join('\n\n');
}

function updateChunkContinuityMemory(previousMemory, normalizedText) {
  const next = {
    lastScene: String(previousMemory?.lastScene || ''),
    recentSpeakers: Array.isArray(previousMemory?.recentSpeakers) ? [...previousMemory.recentSpeakers] : []
  };
  const lines = String(normalizedText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (isSceneLike(line)) {
      next.lastScene = line;
      continue;
    }
    if (isCharacterCueLike(line)) {
      pushRecentSpeaker(next, line);
    }
  }
  return next;
}

function updateChunkContinuityMemoryFromLines(previousMemory, lines) {
  const next = {
    lastScene: String(previousMemory?.lastScene || ''),
    recentSpeakers: Array.isArray(previousMemory?.recentSpeakers) ? [...previousMemory.recentSpeakers] : []
  };
  for (const line of lines || []) {
    const type = String(line?.type || '').trim().toLowerCase();
    const text = String(line?.text || '').trim();
    if (!text) continue;
    if (type === 'scene') {
      next.lastScene = text;
      continue;
    }
    if (type === 'character') {
      pushRecentSpeaker(next, text);
    }
  }
  return next;
}

function pushRecentSpeaker(memory, speaker) {
  const normalized = String(speaker || '').trim();
  if (!normalized) return;
  const recent = Array.isArray(memory.recentSpeakers) ? memory.recentSpeakers.filter((entry) => entry !== normalized) : [];
  recent.unshift(normalized);
  memory.recentSpeakers = recent.slice(0, 4);
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

export function preparePreStructureText(value, { pageSegments = [] } = {}) {
  const normalized = normalizeExtractedText(value);
  if (!normalized) return '';

  const cleanedPageSegments = Array.isArray(pageSegments) && pageSegments.length
    ? stripRepeatedPageHeadersAndFooters(pageSegments)
    : [];

  const sourceText = cleanedPageSegments.length
    ? cleanedPageSegments.join('\n\n')
    : normalized;

  const merged = mergeSoftWrappedScreenplayLines(sourceText.split('\n'));
  return normalizeExtractedText(merged.join('\n'));
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
  if (/^[A-Z0-9 .'\-()]+$/.test(text) && text.length <= 32) {
    return false;
  }
  if (/^(CONT'D|O\.S\.|V\.O\.)$/i.test(text)) {
    return false;
  }
  return !/^[A-Z0-9 .'\-()]+$/.test(text);
}

function repairConvertedLines(lines) {
  const repaired = [];

  for (const entry of lines || []) {
    const current = {
      type: String(entry?.type || 'action').trim().toLowerCase(),
      text: String(entry?.text || '').trim()
    };
    if (!current.text) continue;

    const previous = repaired[repaired.length - 1] || null;

    if (current.type === 'parenthetical' && !(previous?.type === 'character' || previous?.type === 'dialogue')) {
      if (previous?.type === 'action') {
        previous.text = `${previous.text} ${current.text}`.replace(/\s+/g, ' ').trim();
        continue;
      }
      current.type = 'action';
    }

    if (current.type === 'dialogue' && !(previous?.type === 'character' || previous?.type === 'parenthetical' || previous?.type === 'dialogue')) {
      current.type = 'action';
    }

    if (current.type === 'scene' && previous?.type === 'scene' && previous.text === current.text) {
      continue;
    }

    if (current.type === 'action' && previous?.type === 'action' && shouldMergeActionBlocksAdvanced(previous.text, current.text)) {
      previous.text = `${previous.text} ${current.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    if (current.type === 'dialogue' && previous?.type === 'dialogue') {
      previous.text = `${previous.text} ${current.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    repaired.push(current);
  }

  return repaired;
}

function shouldMergeActionBlocks(previousText, currentText) {
  if (!previousText || !currentText) return false;
  if (isSceneLike(currentText) || isTransitionLike(currentText) || isShotLike(currentText) || isCharacterCueLike(currentText) || isParentheticalLike(currentText)) {
    return false;
  }
  if (/^[a-z("'“]/.test(currentText)) return true;
  if (currentText.length <= 42 && !/[.!?:"”')\]]$/.test(previousText)) return true;
  return false;
}

function shouldMergeActionBlocksAdvanced(previousText, currentText) {
  if (shouldMergeActionBlocks(previousText, currentText)) return true;
  if (!previousText || !currentText) return false;
  if (/^[a-z("'`]/.test(currentText)) return true;
  if (/[,:;\-—]$/.test(previousText) || /\.\.\.$/.test(previousText)) return true;
  if (/^(and|but|or|so|because|while|as|with|without|through|into|onto|toward|towards|inside|outside|before|after|then|still|when|where|as if|like)\b/i.test(currentText)) {
    return true;
  }
  return false;
}

function stripRepeatedPageHeadersAndFooters(pageSegments) {
  const normalizedSegments = pageSegments
    .map((segment) => normalizeExtractedText(segment))
    .filter(Boolean);

  if (normalizedSegments.length < 2) {
    return normalizedSegments;
  }

  const counts = new Map();
  const candidatesByPage = normalizedSegments.map((segment) => {
    const lines = segment.split('\n').map((line) => line.trim()).filter(Boolean);
    const candidates = [
      ...lines.slice(0, 3),
      ...lines.slice(-3)
    ]
      .map((line) => normalizeRepetitionCandidate(line))
      .filter(Boolean);
    new Set(candidates).forEach((candidate) => {
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    });
    return lines;
  });

  const repeated = new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .map(([candidate]) => candidate)
  );

  return candidatesByPage.map((lines) => lines
    .filter((line) => {
      const candidate = normalizeRepetitionCandidate(line);
      if (!candidate) return true;
      if (isLikelyPageNumber(line)) return false;
      return !repeated.has(candidate);
    })
    .join('\n'))
    .filter(Boolean);
}

function mergeSoftWrappedScreenplayLines(lines) {
  const merged = [];

  for (const rawLine of lines || []) {
    const original = String(rawLine || '').replace(/\r/g, '');
    const trimmed = original.trim();
    if (!trimmed) {
      if (merged[merged.length - 1]?.text) {
        merged.push({ text: '', role: 'break' });
      }
      continue;
    }

    if (isLikelyPageNumber(trimmed) || isLikelyContinuationMarker(trimmed)) {
      continue;
    }

    const indent = original.match(/^\s*/)?.[0]?.length || 0;
    const role = classifyScreenplayPhysicalLine(trimmed, indent, merged[merged.length - 1]?.role || '');
    const previous = merged[merged.length - 1];

    if (previous?.text && previous.role === role) {
      if (role === 'dialogue' && shouldJoinDialogueLineAdvanced(previous.text, trimmed)) {
        previous.text = `${previous.text} ${trimmed}`.replace(/\s+/g, ' ').trim();
        continue;
      }

      if (role === 'action' && shouldJoinActionLineAdvanced(previous.text, trimmed, previous.indent ?? 0, indent)) {
        previous.text = `${previous.text} ${trimmed}`.replace(/\s+/g, ' ').trim();
        continue;
      }
    }

    merged.push({ text: trimmed, role, indent });
  }

  return merged.map((entry) => entry.text);
}

function normalizeRepetitionCandidate(line) {
  const normalized = String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
  if (!normalized) return '';
  if (normalized.length > 72) return '';
  if (isSceneLike(normalized) || isTransitionLike(normalized) || isShotLike(normalized)) {
    return '';
  }
  return normalized.toLowerCase();
}

function isLikelyPageNumber(text) {
  return /^(page\s+)?\d{1,3}([./-]\d{1,3})?$/i.test(String(text || '').trim());
}

function isLikelyContinuationMarker(text) {
  return /^\(?(continued|cont'?d)\)?$/i.test(String(text || '').trim());
}

function classifyScreenplayPhysicalLine(text, indent, previousRole) {
  if (isSceneLike(text)) return 'scene';
  if (isTransitionLike(text)) return 'transition';
  if (isShotLike(text)) return 'shot';
  if (isParentheticalLike(text)) return 'parenthetical';
  if (isCharacterCueLike(text)) return 'character';

  if (previousRole === 'character' || previousRole === 'parenthetical' || previousRole === 'dialogue') {
    if (indent >= 4 || looksLikeDialogueText(text)) {
      return 'dialogue';
    }
  }

  if (indent >= 8 && looksLikeDialogueText(text)) {
    return 'dialogue';
  }

  return 'action';
}

function shouldJoinDialogueLine(previousText, currentText) {
  if (!previousText || !currentText) return false;
  if (isCharacterCueLike(currentText) || isSceneLike(currentText) || isTransitionLike(currentText) || isShotLike(currentText)) {
    return false;
  }
  if (/^[a-z"'(]/.test(currentText)) return true;
  if (!/[.!?:"”')\]]$/.test(previousText)) return true;
  return currentText.length <= 56;
}

function shouldJoinActionLine(previousText, currentText, previousIndent, currentIndent) {
  if (!previousText || !currentText) return false;
  if (isCharacterCueLike(currentText) || isSceneLike(currentText) || isTransitionLike(currentText) || isShotLike(currentText) || isParentheticalLike(currentText)) {
    return false;
  }
  const indentDelta = Math.abs((previousIndent || 0) - (currentIndent || 0));
  if (indentDelta > 3) return false;
  if (/^[a-z("'“]/.test(currentText)) return true;
  if (!/[.!?:"”')\]]$/.test(previousText)) return true;
  return false;
}

function shouldJoinDialogueLineAdvanced(previousText, currentText) {
  if (shouldJoinDialogueLine(previousText, currentText)) return true;
  if (!previousText || !currentText) return false;
  if (/^(CONT'D|O\.S\.|V\.O\.)$/i.test(currentText)) return false;
  if (/[,:;\-—]$/.test(previousText) || /\.\.\.$/.test(previousText)) return true;
  if (/^(and|but|or|so|because|if|when|while|then|still|just|maybe|really|please|well|no|yes)\b/i.test(currentText)) {
    return true;
  }
  return currentText.length <= 72 && !isCharacterCueLike(currentText);
}

function shouldJoinActionLineAdvanced(previousText, currentText, previousIndent, currentIndent) {
  if (shouldJoinActionLine(previousText, currentText, previousIndent, currentIndent)) return true;
  if (!previousText || !currentText) return false;
  const indentDelta = Math.abs((previousIndent || 0) - (currentIndent || 0));
  if (indentDelta > 3) return false;
  if (/[,:;\-—]$/.test(previousText) || /\.\.\.$/.test(previousText)) return true;
  if (/^(and|but|or|so|because|while|as|with|without|through|into|onto|toward|towards|inside|outside|before|after|then|still|when|where|as if|like)\b/i.test(currentText)) {
    return true;
  }
  return false;
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

function detectCoverTitleLine(lines) {
  const candidates = (lines || []).filter((line) => line && !isCoverMetaNoise(line));
  if (!candidates.length) return String(lines?.[0] || '').trim();
  const uppercaseCandidate = candidates.find((line) => line === line.toUpperCase() && line.length >= 4 && line.length <= 72);
  return uppercaseCandidate || candidates[0];
}

function inferCoverAuthor(lines) {
  for (const line of lines || []) {
    const candidate = String(line || '').trim();
    if (!candidate || isCoverMetaNoise(candidate)) continue;
    if (isLikelyAuthorName(candidate)) return candidate;
  }
  return '';
}

function isCoverMetaNoise(line) {
  const candidate = String(line || '').trim();
  if (!candidate) return true;
  if (isLikelyPageNumber(candidate)) return true;
  if (/^(by|written by|screenplay by|a screenplay by)$/i.test(candidate)) return true;
  if (/^(first|second|third|fourth|revised|revision|draft|shooting draft|final draft|spec draft)\b/i.test(candidate)) return true;
  if (/\b(revision|draft)\b/i.test(candidate) && /\d/.test(candidate)) return true;
  if (/^(copyright|all rights reserved)\b/i.test(candidate)) return true;
  return false;
}

function isLikelyAuthorName(line) {
  const candidate = String(line || '').trim();
  if (!candidate || candidate.length > 56) return false;
  if (/@|\+?\d[\d\s().-]{6,}/.test(candidate)) return false;
  if (/productions?|pictures?|studios?|films?|copyright|draft|revision|logline|story by|teleplay by|screenplay by/i.test(candidate)) return false;
  if (/^(int\.|ext\.|est\.)/i.test(candidate)) return false;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((word) => /^[A-Z][A-Za-z'’-]+$/.test(word));
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

async function updateConversionJob(jobId, patch) {
  if (!jobId) return Promise.resolve(null);
  const latestRecord = await getConversionJobRecord(jobId);
  const preservedPatch = {};
  if (!Object.prototype.hasOwnProperty.call(patch, 'rawText') && latestRecord?.rawTextEditedAt && String(latestRecord.rawText || '').trim()) {
    preservedPatch.rawText = latestRecord.rawText;
    preservedPatch.rawTextEditedAt = latestRecord.rawTextEditedAt;
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'normalizedText') && latestRecord?.normalizedTextEditedAt && String(latestRecord.normalizedText || '').trim()) {
    preservedPatch.normalizedText = latestRecord.normalizedText;
    preservedPatch.normalizedTextEditedAt = latestRecord.normalizedTextEditedAt;
    if (!Object.prototype.hasOwnProperty.call(patch, 'structuredLines')) {
      const preservedStructuredLines = buildLocalStructuredPreview(latestRecord.normalizedText);
      preservedPatch.structuredLines = preservedStructuredLines;
      preservedPatch.structuredLineCount = preservedStructuredLines.length;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'coverPageCandidate') && latestRecord?.coverPageCandidate) {
    preservedPatch.coverPageCandidate = latestRecord.coverPageCandidate;
  }
  const mergedPatch = { ...preservedPatch, ...patch };
  let nextJob = null;
  updateStoredJobs((jobs) => {
    let found = false;
    const updatedAt = new Date().toISOString();
    const nextJobs = jobs.map((job) => {
      if (job.id !== jobId) return job;
      found = true;
      nextJob = { ...job, ...mergedPatch, updatedAt };
      return nextJob;
    });
    if (!found) {
      nextJob = { id: jobId, ...mergedPatch, updatedAt };
      return [nextJob, ...nextJobs].slice(0, 8);
    }
    return nextJobs;
  });
  const payload = nextJob || { id: jobId, ...mergedPatch };
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
