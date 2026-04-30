import { TYPE_SEQUENCE } from './config.js';
import { formatLineText } from './utils.js';

export const EXPORT_PAGE_SETTINGS = {
  size: 'Letter',
  widthIn: 8.5,
  heightIn: 11,
  cmToIn: 0.3937007874,
  marginsIn: {
    top: 2 * 0.3937007874,
    right: 2 * 0.3937007874,
    bottom: 2 * 0.3937007874,
    left: 2 * 0.3937007874
  },
  footerNumberOffsetIn: 0.18,
  pageUnitCapacity: 50
};

export const EXPORT_TYPOGRAPHY = {
  fontFamily: 'Courier Prime',
  cssFontFamily: '"Courier Prime", "Courier New", Courier, monospace',
  fontSizePt: 12,
  lineHeight: 1
};

export const EXPORT_TYPE_LAYOUTS = {
  scene: {
    label: 'Scene heading',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left',
    bold: true,
    uppercase: true
  },
  action: {
    label: 'Action',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left'
  },
  character: {
    label: 'Character',
    indentIn: 2,
    widthChars: 33,
    widthIn: 4.25,
    beforeLines: 1,
    align: 'left',
    bold: true,
    uppercase: true
  },
  dialogue: {
    label: 'Dialogue',
    indentIn: 1,
    widthChars: 39,
    widthIn: 4,
    beforeLines: 0,
    align: 'left'
  },
  transition: {
    label: 'Transition',
    indentIn: 3.5,
    widthChars: 26,
    widthIn: 3,
    beforeLines: 1,
    align: 'right',
    bold: true,
    uppercase: true
  },
  parenthetical: {
    label: 'Parenthetical',
    indentIn: 1.5,
    widthChars: 30,
    widthIn: 3,
    beforeLines: 0,
    align: 'left'
  },
  shot: {
    label: 'Shot',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left',
    bold: true,
    uppercase: true
  },
  text: {
    label: 'Text',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left'
  },
  note: {
    label: 'Note',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left',
    italic: true
  },
  dual: {
    label: 'Dual dialogue',
    indentIn: 0,
    widthChars: 28,
    widthIn: 3,
    beforeLines: 1,
    align: 'left',
    bold: true,
    uppercase: true,
    dual: true
  },
  image: {
    label: 'Image cue',
    indentIn: 0,
    widthChars: 61,
    widthIn: 6.5,
    beforeLines: 1,
    align: 'left'
  }
};

export const EXPORT_FORMAT_METADATA = {
  source: 'EyaWriter',
  compatibilityTarget: 'WriterDuet screenplay export',
  version: 1,
  page: EXPORT_PAGE_SETTINGS,
  typography: EXPORT_TYPOGRAPHY,
  elements: TYPE_SEQUENCE.reduce((accumulator, type) => {
    accumulator[type] = { ...EXPORT_TYPE_LAYOUTS[type] };
    return accumulator;
  }, {})
};

export function getExportLayout(type) {
  return EXPORT_TYPE_LAYOUTS[type] || EXPORT_TYPE_LAYOUTS.action;
}

export function formatExportDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '1970-01-01' : date.toISOString().slice(0, 10);
}

export function sanitizeFilenameSegment(value) {
  return String(value || 'Untitled Script')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled Script';
}

export function buildExportFileBase(title, date = new Date()) {
  return `${sanitizeFilenameSegment(title)}_${formatExportDate(date)}`;
}

export function buildExportFilename(title, extension, date = new Date()) {
  const ext = String(extension || '').replace(/^\.+/, '');
  return `${buildExportFileBase(title, date)}.${ext}`;
}

export function buildPreparedExportLines(project, { autoNumberScenes = false } = {}) {
  let sceneNumber = 0;

  return (project?.lines || []).reduce((accumulator, line) => {
    const normalized = formatLineText(line.text, line.type);
    if (!normalized) {
      return accumulator;
    }

    if (line.type === 'scene') {
      sceneNumber += 1;
    }

    const entry = {
      id: line.id,
      type: line.type,
      displayText: autoNumberScenes && line.type === 'scene' ? `${sceneNumber}. ${normalized}` : normalized
    };

    if (typeof line.secondary === 'string') {
      const secondary = formatLineText(line.secondary, line.type);
      if (secondary) {
        entry.secondary = secondary;
      }
    }

    accumulator.push(entry);
    return accumulator;
  }, []);
}

export function buildExportSnapshot(project, pages, options = {}) {
  return {
    exportVersion: EXPORT_FORMAT_METADATA.version,
    exportedAt: new Date().toISOString(),
    exportFileBase: buildExportFileBase(project?.title),
    author: project?.author || "",
    screenplayFormat: EXPORT_FORMAT_METADATA,
    autoNumberScenes: Boolean(options.autoNumberScenes),
    project,
    preparedLines: buildPreparedExportLines(project, options),
    pages
  };
}
