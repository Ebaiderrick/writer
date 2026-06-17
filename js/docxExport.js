import { state } from './config.js';
import { formatLineText } from './utils.js';
import { t } from './i18n.js';
import { buildFullScriptExportDocument } from './exportModel.js';

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SCREENPLAY_FONT = "Courier Prime";
const LINE_SPACING = 360;
const PARAGRAPH_AFTER = 80;
const LETTER_WIDTH = 12240;
const LETTER_HEIGHT = 15840;
const PAGE_MARGIN_TOP_BOTTOM = inches(1);
const PAGE_MARGIN_LEFT_RIGHT = inches(1);
const CHARACTER_BLOCK_SIDE_MARGIN = centimeters(5.4);
const DUAL_CHARACTER_BLOCK_SIDE_MARGIN = centimeters(1.15);

function inches(value) {
  return Math.round(value * 1440);
}

function centimeters(value) {
  return Math.round((value / 2.54) * 1440);
}

function buildExportLines(project) {
  const preparedLines = [];
  let sceneNumber = 0;

  project.lines.forEach((line) => {
    const normalized = formatLineText(line.text, line.type);
    if (!normalized) {
      return;
    }

    if (line.type === "scene") {
      sceneNumber += 1;
    }

    preparedLines.push({
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized,
      secondary: line.secondary !== undefined ? formatLineText(line.secondary, line.type) : undefined
    });
  });

  return preparedLines;
}

function getDocxLibrary() {
  const docxLib = window.docx;
  if (!docxLib?.Document || !docxLib?.Packer || !docxLib?.Paragraph || !docxLib?.TextRun) {
    throw new Error("DOCX export library is not available.");
  }
  return docxLib;
}

function createRuns(TextRun, text, options = {}) {
  const segments = String(text || "").split(/\n/);
  return segments.map((segment, index) => new TextRun({
    ...options,
    text: segment,
    break: index === 0 ? 0 : 1
  }));
}

function createParagraph(docxLib, text, type, extra = {}) {
  const { Paragraph, TextRun, AlignmentType } = docxLib;
  const base = {
    spacing: { line: LINE_SPACING, after: PARAGRAPH_AFTER },
    children: createRuns(TextRun, text),
    ...extra
  };

  switch (type) {
    case "scene":
    case "shot":
      return new Paragraph({
        ...base,
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "transition":
      return new Paragraph({
        ...base,
        alignment: AlignmentType.RIGHT,
        indent: { left: inches(3.9) },
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "character":
    case "dual":
      return new Paragraph({
        ...base,
        indent: {
          left: CHARACTER_BLOCK_SIDE_MARGIN,
          right: CHARACTER_BLOCK_SIDE_MARGIN
        },
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "dialogue":
      return new Paragraph({
        ...base,
        indent: {
          left: inches(1.0),
          right: inches(1.5)
        }
      });
    case "parenthetical":
      return new Paragraph({
        ...base,
        indent: {
          left: inches(1.5),
          right: inches(2.0)
        },
        children: createRuns(TextRun, text, { italics: true })
      });
    case "note":
      return new Paragraph({
        ...base,
        children: createRuns(TextRun, text, { italics: true })
      });
    default:
      return new Paragraph(base);
  }
}

function createDualParagraph(docxLib, text, type) {
  const { Paragraph, TextRun, AlignmentType } = docxLib;
  const base = {
    spacing: { line: LINE_SPACING, after: 40 },
    children: createRuns(TextRun, text)
  };

  switch (type) {
    case "scene":
    case "shot":
      return new Paragraph({
        ...base,
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "transition":
      return new Paragraph({
        ...base,
        alignment: AlignmentType.RIGHT,
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "character":
    case "dual":
      return new Paragraph({
        ...base,
        indent: {
          left: DUAL_CHARACTER_BLOCK_SIDE_MARGIN,
          right: DUAL_CHARACTER_BLOCK_SIDE_MARGIN
        },
        children: createRuns(TextRun, String(text || "").toUpperCase(), { bold: true })
      });
    case "dialogue":
      return new Paragraph({
        ...base,
        indent: {
          left: inches(0.2),
          right: inches(0.2)
        }
      });
    case "parenthetical":
      return new Paragraph({
        ...base,
        indent: {
          left: inches(0.45),
          right: inches(0.25)
        },
        children: createRuns(TextRun, text, { italics: true })
      });
    default:
      return new Paragraph(base);
  }
}

function createDualDialogueTable(docxLib, line) {
  const { Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign } = docxLib;
  const childrenLeft = line.displayText ? [createDualParagraph(docxLib, line.displayText, line.type)] : [];
  const childrenRight = line.secondary ? [createDualParagraph(docxLib, line.secondary, line.type)] : [];

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            verticalAlign: VerticalAlign.TOP,
            width: { size: 50, type: WidthType.PERCENTAGE },
            margins: {
              top: 0,
              bottom: 0,
              left: inches(0.05),
              right: inches(0.12)
            },
            children: childrenLeft.length ? childrenLeft : [createDualParagraph(docxLib, "", "action")]
          }),
          new TableCell({
            verticalAlign: VerticalAlign.TOP,
            width: { size: 50, type: WidthType.PERCENTAGE },
            margins: {
              top: 0,
              bottom: 0,
              left: inches(0.12),
              right: inches(0.05)
            },
            children: childrenRight.length ? childrenRight : [createDualParagraph(docxLib, "", "action")]
          })
        ]
      })
    ]
  });
}

function buildCoverSection(docxLib, project) {
  const { Paragraph, TextRun, AlignmentType } = docxLib;
  const metaParagraphs = [project.contact, project.company, project.details]
    .filter(Boolean)
    .map((value) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE_SPACING, after: 40 },
      children: [new TextRun({ text: String(value), font: SCREENPLAY_FONT, size: 24 })]
    }));

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: inches(2.4), after: 240, line: LINE_SPACING },
      children: [new TextRun({
        text: String(project.title || "UNTITLED").toUpperCase(),
        bold: true,
        font: SCREENPLAY_FONT,
        size: 28
      })]
    }),
    ...(project.subtitle ? [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 140, line: LINE_SPACING },
        children: [new TextRun({
          text: String(project.subtitle),
          italics: true,
          font: SCREENPLAY_FONT,
          size: 22
        })]
      })
    ] : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120, line: LINE_SPACING },
      children: [new TextRun({ text: t("cover.by"), font: SCREENPLAY_FONT, size: 24 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300, line: LINE_SPACING },
      children: [new TextRun({
        text: String(project.author || t("cover.authorFallback")),
        bold: true,
        font: SCREENPLAY_FONT,
        size: 24
      })]
    }),
    ...(project.coWriters ? [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 220, line: LINE_SPACING },
        children: [new TextRun({
          text: String(project.coWriters),
          font: SCREENPLAY_FONT,
          size: 22
        })]
      })
    ] : []),
    ...metaParagraphs
  ];

  if (project.version) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40, line: LINE_SPACING },
      children: [new TextRun({ text: `Version ${String(project.version)}`, font: SCREENPLAY_FONT, size: 22 })]
    }));
  }

  if (project.draftDate) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80, line: LINE_SPACING },
      children: [new TextRun({ text: String(project.draftDate), font: SCREENPLAY_FONT, size: 22 })]
    }));
  }

  if (project.logline) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 120, line: LINE_SPACING }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: {
          left: inches(1.2),
          right: inches(1.2)
        },
        spacing: { line: LINE_SPACING, after: 120 },
        children: createRuns(TextRun, String(project.logline), { font: SCREENPLAY_FONT, size: 24 })
      })
    );
  }

  return {
    properties: {
      page: {
        size: {
          width: LETTER_WIDTH,
          height: LETTER_HEIGHT
        },
        margin: {
          top: PAGE_MARGIN_TOP_BOTTOM,
          right: PAGE_MARGIN_LEFT_RIGHT,
          bottom: PAGE_MARGIN_TOP_BOTTOM,
          left: PAGE_MARGIN_LEFT_RIGHT,
          header: centimeters(1),
          footer: centimeters(1)
        }
      }
    },
    children
  };
}

function buildScriptSection(docxLib, project) {
  const { Header, Paragraph, AlignmentType, PageNumber, TextRun } = docxLib;
  const lines = buildExportLines(project);
  const header = state.viewOptions.pageNumbers
    ? new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0, line: LINE_SPACING },
          children: [PageNumber.CURRENT]
        })
      ]
    })
    : undefined;

  const children = [];
  lines.forEach((line) => {
    if (line.secondary !== undefined && line.secondary) {
      children.push(createDualDialogueTable(docxLib, line));
      return;
    }
    children.push(createParagraph(docxLib, line.displayText, line.type));
  });

  if (!children.length) {
    children.push(new Paragraph({
      spacing: { line: LINE_SPACING, after: PARAGRAPH_AFTER },
      children: [new TextRun({ text: " ", font: SCREENPLAY_FONT, size: 24 })]
    }));
  }

  return {
    properties: {
      page: {
        size: {
          width: LETTER_WIDTH,
          height: LETTER_HEIGHT
        },
        margin: {
          top: PAGE_MARGIN_TOP_BOTTOM,
          right: PAGE_MARGIN_LEFT_RIGHT,
          bottom: PAGE_MARGIN_TOP_BOTTOM,
          left: PAGE_MARGIN_LEFT_RIGHT,
          header: centimeters(0.9),
          footer: centimeters(0.9)
        },
        pageNumbers: {
          start: 1
        }
      }
    },
    headers: header ? { default: header } : undefined,
    children
  };
}

function buildCoverSectionFromExportDocument(docxLib, exportDocument) {
  return buildCoverSection(docxLib, exportDocument?.metadata || {});
}

function buildScriptSectionFromExportDocument(docxLib, exportDocument) {
  const { Header, Paragraph, AlignmentType, PageNumber, TextRun } = docxLib;
  const lines = Array.isArray(exportDocument?.lines) ? exportDocument.lines : [];
  const metadata = exportDocument?.metadata || {};
  const pageNumbersEnabled = exportDocument?.options?.includePageNumbers ?? state.viewOptions.pageNumbers;
  const header = pageNumbersEnabled
    ? new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0, line: LINE_SPACING },
          children: [PageNumber.CURRENT]
        })
      ]
    })
    : undefined;

  const children = [];
  lines.forEach((line) => {
    if (line.secondary) {
      children.push(createDualDialogueTable(docxLib, line));
      return;
    }
    children.push(createParagraph(docxLib, line.displayText, line.type));
  });

  if (!children.length) {
    children.push(new Paragraph({
      spacing: { line: LINE_SPACING, after: PARAGRAPH_AFTER },
      children: [new TextRun({ text: " ", font: SCREENPLAY_FONT, size: 24 })]
    }));
  }

  if (metadata.copyrightNotice) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 180, after: 0, line: LINE_SPACING },
        children: createRuns(TextRun, String(metadata.copyrightNotice), { font: SCREENPLAY_FONT, size: 22 })
      })
    );
  }

  return {
    properties: {
      page: {
        size: {
          width: LETTER_WIDTH,
          height: LETTER_HEIGHT
        },
        margin: {
          top: PAGE_MARGIN_TOP_BOTTOM,
          right: PAGE_MARGIN_LEFT_RIGHT,
          bottom: PAGE_MARGIN_TOP_BOTTOM,
          left: PAGE_MARGIN_LEFT_RIGHT,
          header: centimeters(0.9),
          footer: centimeters(0.9)
        },
        pageNumbers: {
          start: 1
        }
      }
    },
    headers: header ? { default: header } : undefined,
    children
  };
}

export async function buildWordDocxBlobFromExportDocument(exportDocument) {
  const docxLib = getDocxLibrary();
  const { Document, Packer } = docxLib;
  const metadata = exportDocument?.metadata || {};
  const sections = [];

  if (exportDocument?.options?.includeTitlePage !== false) {
    sections.push(buildCoverSectionFromExportDocument(docxLib, exportDocument));
  }
  sections.push(buildScriptSectionFromExportDocument(docxLib, exportDocument));

  const document = new Document({
    creator: "EyaWriter",
    title: metadata.title || "Untitled",
    description: "Industry-style screenplay export",
    styles: {
      default: {
        document: {
          run: {
            font: SCREENPLAY_FONT,
            size: 24,
            color: "111111"
          },
          paragraph: {
            spacing: {
              line: LINE_SPACING,
              after: PARAGRAPH_AFTER
            }
          }
        }
      }
    },
    sections
  });

  return Packer.toBlob(document);
}

export async function buildWordDocxBlob(project) {
  const exportDocument = buildFullScriptExportDocument(project, {
    includeSceneNumbers: state.autoNumberScenes,
    includeMetadata: true,
    includeTitlePage: true,
    includePageNumbers: state.viewOptions.pageNumbers
  });
  return buildWordDocxBlobFromExportDocument(exportDocument);
}

export { DOCX_MIME_TYPE };
