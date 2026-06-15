import {
  buildCharacterExportDocument,
  buildCharacterPacketExportDocument,
  buildBreakdownExportDocument,
  buildExportFilename,
  buildFullScriptExportDocument,
  buildLocationExportDocument,
  buildProductionExportDocument,
  buildRevisionExportDocument,
  buildSceneExportDocument,
  buildShootingScriptExportDocument,
  applyWatermarkToExportDocument,
  buildWatermarkedScriptExportDocument,
  getDefaultExportOptions
} from './exportModel.js';
import { buildPrintableDocumentFromExportDocument } from './printExport.js';
import { buildWordDocxBlobFromExportDocument, DOCX_MIME_TYPE } from './docxExport.js';

const PDF_MIME_TYPE = 'text/html;charset=utf-8';
const FOUNTAIN_MIME_TYPE = 'text/plain;charset=utf-8';
const FDX_MIME_TYPE = 'application/xml;charset=utf-8';

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

function assertSupportedFormat(format, allowedFormats, exportName) {
  if (!allowedFormats.includes(format)) {
    throw new Error(`${exportName} supports ${allowedFormats.join(' or ').toUpperCase()} only.`);
  }
}

function buildFountainTitlePage(metadata, options) {
  if (options.includeMetadata === false) {
    return '';
  }

  const lines = [];
  const pushInline = (key, value) => {
    if (!value) return;
    lines.push(`${key}: ${value}`);
  };
  const pushBlock = (key, values) => {
    const items = values.filter(Boolean);
    if (!items.length) return;
    lines.push(`${key}:`);
    items.forEach((value) => lines.push(`    ${value}`));
  };
  const draftDateSource = metadata.updatedAt || metadata.createdAt || '';
  const parsedDraftDate = draftDateSource ? new Date(draftDateSource) : null;
  const draftDate = parsedDraftDate && !Number.isNaN(parsedDraftDate.getTime())
    ? parsedDraftDate.toISOString().slice(0, 10)
    : '';

  pushBlock('Title', [metadata.title]);
  pushInline('Title2', metadata.subtitle);
  pushInline('Credit', 'Written by');
  pushInline('Author', metadata.author);
  pushInline('Authors', metadata.coWriters);
  pushInline('Draft date', draftDate);
  pushBlock('Contact', [metadata.contact, metadata.company, metadata.details]);
  pushInline('Genre', metadata.genre);
  pushInline('Version', Number.isFinite(Number(metadata.version)) && Number(metadata.version) > 0 ? `Version ${metadata.version}` : '');
  pushInline('Logline', metadata.logline);
  pushInline('Copyright', metadata.copyrightNotice);
  pushInline('Project ID', metadata.projectId);
  pushInline('Script ID', metadata.scriptId);
  return lines.length ? `${lines.join('\n')}\n\n` : '';
}

function stripInlineSceneNumber(text) {
  return String(text || '').replace(/\s+#([A-Za-z0-9.-]+)#\s*$/u, '').trim();
}

function needsForcedAction(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const letters = value.replace(/[^A-Za-z]/g, '');
  return Boolean(letters) && letters === letters.toUpperCase();
}

function formatFountainSceneHeading(line) {
  const heading = stripInlineSceneNumber(line.text || line.displayText).toUpperCase();
  if (!heading) return '';
  if (Number.isFinite(Number(line.sceneNumber)) && Number(line.sceneNumber) > 0) {
    return `${heading} #${Number(line.sceneNumber)}#`;
  }
  return heading;
}

function formatFountainCharacter(line) {
  const name = String(line.displayText || line.text || '').trim();
  if (!name) return '';
  return /[a-z]/.test(name) ? `@${name}` : name.toUpperCase();
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFdxTitlePage(metadata, options) {
  if (options.includeMetadata === false) {
    return `
  <TitlePage>
    <TextState Scaling="100" Selection="0,0" ShowInvisibles="No"/>
  </TitlePage>`;
  }

  const titleParagraphs = [];
  const pushParagraph = (text) => {
    if (!text) return;
    titleParagraphs.push(`
    <Paragraph Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="0.00" RightIndent="0.00" SpaceBefore="0" Spacing="1" StartsNewPage="No">
      <Text>${escapeXml(text)}</Text>
    </Paragraph>`);
  };
  const pushRightParagraph = (text) => {
    if (!text) return;
    titleParagraphs.push(`
    <Paragraph Alignment="Right" FirstIndent="0.00" Leading="Regular" LeftIndent="0.00" RightIndent="0.00" SpaceBefore="0" Spacing="1" StartsNewPage="No">
      <Text>${escapeXml(text)}</Text>
    </Paragraph>`);
  };

  pushParagraph(metadata.title);
  pushParagraph(metadata.subtitle);
  pushParagraph('Written by');
  pushParagraph(metadata.author);
  pushParagraph(metadata.coWriters);
  pushParagraph(metadata.genre ? `Genre: ${metadata.genre}` : '');
  pushParagraph(Number.isFinite(Number(metadata.version)) ? `Version ${metadata.version}` : '');
  pushParagraph(metadata.draftDate);
  pushParagraph(metadata.logline);
  pushParagraph(metadata.copyrightNotice);
  pushRightParagraph(metadata.contact);
  pushRightParagraph(metadata.company);
  pushRightParagraph(metadata.details);

  return `
  <TitlePage>
    <Content>${titleParagraphs.join('')}
    </Content>
    <TextState Scaling="100" Selection="0,0" ShowInvisibles="No"/>
  </TitlePage>`;
}

function mapLineTypeToFdxParagraphType(line) {
  switch (line.type) {
    case 'scene':
      return 'Scene Heading';
    case 'character':
    case 'dual':
      return 'Character';
    case 'parenthetical':
      return 'Parenthetical';
    case 'dialogue':
      return 'Dialogue';
    case 'transition':
      return 'Transition';
    case 'shot':
      return 'Shot';
    default:
      return 'Action';
  }
}

function buildFdxParagraph(line) {
  const paragraphType = mapLineTypeToFdxParagraphType(line);
  const text = escapeXml(line.displayText || line.text || '');
  const sceneNumber = Number.isFinite(Number(line.sceneNumber)) ? Number(line.sceneNumber) : '';
  const sceneProperties = paragraphType === 'Scene Heading'
    ? `
    <SceneProperties Number="${sceneNumber}" Title=""/>`
    : '';
  return `
  <Paragraph Type="${paragraphType}">${sceneProperties}
    <Text>${text}</Text>
  </Paragraph>`;
}

function buildFdxSmartType(exportDocument) {
  const characters = (exportDocument.characters || [])
    .map((character) => `<Character>${escapeXml(character.name || character.normalizedName || '')}</Character>`)
    .join('');
  const locations = [...new Set((exportDocument.scenes || []).map((scene) => scene.location).filter(Boolean))]
    .map((location) => `<Location>${escapeXml(location)}</Location>`)
    .join('');
  const timesOfDay = [...new Set((exportDocument.scenes || []).map((scene) => scene.timeOfDay).filter(Boolean))]
    .map((time) => `<TimeOfDay>${escapeXml(time)}</TimeOfDay>`)
    .join('');
  const transitions = [...new Set((exportDocument.lines || []).filter((line) => line.type === 'transition').map((line) => line.displayText).filter(Boolean))]
    .map((transition) => `<Transition>${escapeXml(transition)}</Transition>`)
    .join('');

  return `
  <SmartType>
    <Characters>${characters}
    </Characters>
    <SceneIntros Separator="">
      <SceneIntro>INT.</SceneIntro>
      <SceneIntro>EXT.</SceneIntro>
      <SceneIntro>INT./EXT.</SceneIntro>
    </SceneIntros>
    <Locations>${locations}
    </Locations>
    <TimesOfDay Separator="">${timesOfDay}
    </TimesOfDay>
    <Transitions>${transitions}
    </Transitions>
  </SmartType>`;
}

function buildFdxDocument(exportDocument) {
  const contentParagraphs = exportDocument.lines.map(buildFdxParagraph).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="3">
  <Content>${contentParagraphs}
  </Content>
${buildFdxTitlePage(exportDocument.metadata, exportDocument.options)}
${buildFdxSmartType(exportDocument)}
</FinalDraft>
`;
}

function toFountainLine(line) {
  switch (line.type) {
    case 'scene':
      return formatFountainSceneHeading(line);
    case 'character':
      return `\n${formatFountainCharacter(line)}`;
    case 'dual':
      return `\n${formatFountainCharacter(line)} ^`;
    case 'dialogue':
      return line.displayText;
    case 'parenthetical':
      return line.displayText.startsWith('(') ? line.displayText : `(${line.displayText})`;
    case 'transition':
      return /TO:\s*$/u.test(line.displayText) && line.displayText === line.displayText.toUpperCase()
        ? line.displayText
        : `> ${line.displayText}`;
    case 'shot':
      return `!${line.displayText}`;
    case 'note':
      return `[[${line.displayText.replace(/^\[|\]$/g, '')}]]`;
    case 'image':
      return `[[${line.displayText.replace(/^\[|\]$/g, '')}]]`;
    case 'centered':
      return `> ${line.displayText} <`;
    default:
      return needsForcedAction(line.displayText) ? `!${line.displayText}` : line.displayText;
  }
}

async function buildFormatOutput(exportDocument, format) {
  const exportDocumentWithWatermark = format === 'pdf' && exportDocument?.options?.enableWatermarkSettings
    ? applyWatermarkToExportDocument(exportDocument)
    : exportDocument;
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
    case 'fdx': {
      return {
        filename: buildExportFilename(exportDocument, 'fdx'),
        content: buildFdxDocument(exportDocument),
        mimeType: FDX_MIME_TYPE
      };
    }
    case 'pdf':
    default: {
      const content = buildPrintableDocumentFromExportDocument(exportDocumentWithWatermark, false);
      return {
        filename: buildExportFilename(exportDocumentWithWatermark, 'html'),
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

  static async exportCharacterPacket(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Character packet export');
    const exportDocument = buildCharacterPacketExportDocument(project, {
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

  static async exportProduction(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Production export');
    const exportDocument = buildProductionExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportShootingScript(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Shooting script export');
    const exportDocument = buildShootingScriptExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportWatermarkedScript(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf'], 'Watermarked script export');
    const exportDocument = buildWatermarkedScriptExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportLocation(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Location export');
    const exportDocument = buildLocationExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportRevision(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Revision export');
    const exportDocument = buildRevisionExportDocument(project, {
      ...request,
      options: normalized.options
    });
    return buildFormatOutput(exportDocument, normalized.format);
  }

  static async exportBreakdown(project, request = {}) {
    const normalized = normalizeExportRequest(request);
    assertSupportedFormat(normalized.format, ['pdf', 'docx'], 'Breakdown export');
    const exportDocument = buildBreakdownExportDocument(project, {
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

  static async generateFDX(exportDocument) {
    return buildFormatOutput(exportDocument, 'fdx');
  }
}

export {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  FOUNTAIN_MIME_TYPE,
  FDX_MIME_TYPE
};
