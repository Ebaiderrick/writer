import {
  buildCharacterExportDocument,
  buildExportFilename,
  buildFullScriptExportDocument,
  buildSceneExportDocument,
  getDefaultExportOptions
} from './exportModel.js';
import { buildPrintableDocumentFromExportDocument } from './preview.js';
import { buildWordDocxBlobFromExportDocument, DOCX_MIME_TYPE } from './docxExport.js';

const PDF_MIME_TYPE = 'text/html;charset=utf-8';
const FOUNTAIN_MIME_TYPE = 'text/plain;charset=utf-8';

function mergeOptions(options = {}) {
  return {
    ...getDefaultExportOptions(),
    ...options
  };
}

function normalizeExportRequest(request = {}) {
  return {
    format: String(request.format || 'pdf').trim().toLowerCase(),
    options: mergeOptions(request.options || request)
  };
}

function buildFountainTitlePage(metadata, options) {
  if (options.includeMetadata === false) {
    return '';
  }

  const lines = [];
  if (metadata.title) lines.push(`Title: ${metadata.title}`);
  if (metadata.author) lines.push(`Author: ${metadata.author}`);
  if (metadata.genre) lines.push(`Genre: ${metadata.genre}`);
  if (Number.isFinite(Number(metadata.version))) lines.push(`Draft date: Version ${metadata.version}`);
  if (metadata.contact) lines.push(`Contact: ${metadata.contact}`);
  if (metadata.company) lines.push(`Source: ${metadata.company}`);
  if (metadata.details) lines.push(`Notes: ${metadata.details}`);
  if (metadata.logline) lines.push(`Logline: ${metadata.logline}`);
  return lines.length ? `${lines.join('\n')}\n\n` : '';
}

function toFountainLine(line) {
  switch (line.type) {
    case 'scene':
      return line.displayText.toUpperCase();
    case 'character':
      return `\n${line.displayText.toUpperCase()}`;
    case 'dual':
      return `\n${line.displayText.toUpperCase()} ^`;
    case 'dialogue':
      return line.displayText;
    case 'parenthetical':
      return line.displayText.startsWith('(') ? line.displayText : `(${line.displayText})`;
    case 'transition':
      return `> ${line.displayText.toUpperCase()}`;
    case 'shot':
      return `> ${line.displayText.toUpperCase()}`;
    case 'note':
      return `[[${line.displayText.replace(/^\[|\]$/g, '')}]]`;
    case 'image':
      return `[[${line.displayText.replace(/^\[|\]$/g, '')}]]`;
    default:
      return line.displayText;
  }
}

async function buildFormatOutput(exportDocument, format) {
  switch (format) {
    case 'docx': {
      const content = await buildWordDocxBlobFromExportDocument(exportDocument);
      return {
        filename: buildExportFilename(exportDocument, 'docx'),
        content,
        mimeType: DOCX_MIME_TYPE
      };
    }
    case 'fountain': {
      const titlePage = buildFountainTitlePage(exportDocument.metadata, exportDocument.options);
      const body = exportDocument.lines.map(toFountainLine).join('\n\n').replace(/\n{3,}/g, '\n\n');
      return {
        filename: buildExportFilename(exportDocument, 'fountain'),
        content: `${titlePage}${body}\n`,
        mimeType: FOUNTAIN_MIME_TYPE
      };
    }
    case 'pdf':
    default: {
      const content = buildPrintableDocumentFromExportDocument(exportDocument, false);
      return {
        filename: buildExportFilename(exportDocument, 'html'),
        content,
        mimeType: PDF_MIME_TYPE,
        transport: 'print-html'
      };
    }
  }
}

export class ExportService {
  static async exportFullScript(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    const exportDocument = buildFullScriptExportDocument(project, normalized.options);
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportCharacter(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    const exportDocument = buildCharacterExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportScenes(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    const exportDocument = buildSceneExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async generatePDF(exportDocument) {
    return buildFormatOutput(exportDocument, 'pdf');
  }

  static async generateDOCX(exportDocument) {
    return buildFormatOutput(exportDocument, 'docx');
  }

  static async generateFountain(exportDocument) {
    return buildFormatOutput(exportDocument, 'fountain');
  }
}

export {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  FOUNTAIN_MIME_TYPE
};
