import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, syncProjectFromInputs } from './project.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml, createTextNode } from './utils.js';
import {
  EXPORT_PAGE_SETTINGS,
  EXPORT_TYPOGRAPHY,
  buildPreparedExportLines,
  getExportLayout
} from './exportFormat.js';
import { t } from './i18n.js';

export function renderCoverPreview() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\n${escapeHtml(t("cover.by"))}\n\n${escapeHtml(project.author || t("cover.authorFallback"))}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  refs.coverPreview.innerHTML = `
    <div class="cover-sheet">
      <pre class="cover-text">${coverText}</pre>
    </div>
  `;
}

export function renderPreview() {
  const project = getCurrentProject();
  if (!project) return;
  refs.preview.innerHTML = "";
  const previewData = buildPreviewData(project);

  const pages = document.createElement("div");
  pages.className = "preview-pages";

  const coverPage = document.createElement("section");
  coverPage.className = "preview-page-sheet cover";
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\n${escapeHtml(t("cover.by"))}\n\n${escapeHtml(project.author || t("cover.authorFallback"))}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  coverPage.innerHTML = `<pre class="preview-cover-text">${coverText}</pre>`;
  pages.appendChild(coverPage);

  previewData.scriptPages.forEach((pageLines, pageIndex) => {
    const scriptPage = document.createElement("section");
    scriptPage.className = "preview-page-sheet";

    const body = document.createElement("div");
    body.className = "preview-page-body";

    pageLines.forEach((line) => {
      if (line.secondary !== undefined) {
        const node = document.createElement("div");
        node.className = `preview-line preview-dual-row ${line.type}`;
        const left = document.createElement("span");
        left.className = "preview-dual-col";
        left.textContent = line.displayText;
        const right = document.createElement("span");
        right.className = "preview-dual-col";
        right.textContent = line.secondary;
        node.appendChild(left);
        node.appendChild(right);
        body.appendChild(node);
      } else {
        const node = document.createElement("p");
        node.className = `preview-line ${line.type}`;
        node.textContent = line.displayText;
        body.appendChild(node);
      }
    });

    if (!pageLines.length) {
      body.appendChild(createTextNode(t("preview.placeholder")));
    }

    scriptPage.appendChild(body);

    if (state.viewOptions.pageNumbers) {
      const footer = document.createElement("div");
      footer.className = "preview-page-footer";
      footer.textContent = buildPageNumberLabel(pageIndex + 1, previewData.scriptPages.length);
      scriptPage.appendChild(footer);
    }

    pages.appendChild(scriptPage);
  });

  refs.preview.appendChild(pages);
}

export function buildPreviewData(project) {
  const preparedLines = buildPreparedExportLines(project, { autoNumberScenes: state.autoNumberScenes });

  return {
    preparedLines,
    scriptPages: paginateScriptLines(preparedLines)
  };
}

function buildPageNumberLabel(pageNumber, totalPages) {
  return t("preview.pageNumber", { page: pageNumber, total: totalPages });
}

export function buildPrintableDocument(project, autoPrint = false) {
  const previewData = buildPreviewData(project);
  const coverMarkup = `
    <section class="print-page cover-page">
      <div class="print-frame cover-frame">
        <div class="print-header"></div>
        <div class="print-body print-cover-body">
          ${buildPrintableCoverMarkup(project)}
        </div>
        <div class="print-footer-slot"></div>
      </div>
    </section>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageFooter = state.viewOptions.pageNumbers
      ? `<div class="print-footer">${escapeHtml(buildPageNumberLabel(pageNum, previewData.scriptPages.length))}</div>`
      : "";

    return `
    <section class="print-page script-page">
      <div class="print-frame">
        <div class="print-header"></div>
        <div class="print-body">
          ${pageLines.map((line, lineIndex) => renderHtmlExportLine(line, 'print', lineIndex)).join('')}
        </div>
        <div class="print-footer-slot">
          ${pageFooter}
        </div>
      </div>
    </section>
  `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(state.language)}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(project.title)}</title>
  <style>${getPrintableStyles()}</style>
</head>
<body>
  <main class="print-shell">
    ${coverMarkup}
    ${scriptMarkup}
  </main>
  ${autoPrint ? "<script>window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 350); }); window.addEventListener('afterprint', function () { window.close(); });<\/script>" : ""}
</body>
</html>`;
}

export async function buildWordDocumentBlob(project) {
  const docx = globalThis.docx;
  if (!docx) {
    throw new Error("Word export library is not available.");
  }

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    VerticalAlign
  } = docx;

  const cmToTwip = (cm) => Math.round(cm * 567);
  const ptToHalfPoint = (pt) => pt * 2;
  const lineTwip = 240;
  const font = EXPORT_TYPOGRAPHY.fontFamily;
  const preparedLines = buildPreparedExportLines(project, { autoNumberScenes: state.autoNumberScenes });

  const coverChildren = [
    spacerParagraph(6),
    centeredParagraph(project.title, {
      font,
      bold: true,
      spacingAfter: 36
    }),
    centeredParagraph(t("cover.by"), {
      font,
      spacingAfter: 12
    }),
    centeredParagraph(project.author || t("cover.authorFallback"), {
      font,
      bold: true,
      spacingAfter: 36
    }),
    centeredParagraph(project.contact || "", { font, spacingAfter: 6 }),
    centeredParagraph(project.company || "", { font, spacingAfter: 6 }),
    centeredParagraph(project.details || "", { font, spacingAfter: 6 }),
    centeredParagraph(project.logline || "", {
      font,
      spacingBefore: 24,
      leftCm: 3.5,
      rightCm: 3.5
    })
  ].filter(Boolean);

  const bodyChildren = preparedLines.flatMap((line, index) => buildWordParagraphsForLine(line, index, {
    Paragraph,
    TextRun,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    VerticalAlign,
    cmToTwip,
    ptToHalfPoint,
    lineTwip,
    font
  }));

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: cmToTwip(2),
              right: cmToTwip(2.5),
              bottom: cmToTwip(2),
              left: cmToTwip(2.5)
            }
          }
        },
        children: coverChildren
      },
      {
        properties: {
          page: {
            margin: {
              top: cmToTwip(2),
              right: cmToTwip(2.5),
              bottom: cmToTwip(2),
              left: cmToTwip(2.5)
            }
          }
        },
        children: bodyChildren
      }
    ]
  });

  return Packer.toBlob(doc);
}

function centeredParagraph(text, { font, bold = false, spacingBefore = 0, spacingAfter = 0, leftCm = 0, rightCm = 0 }) {
  if (!text) return null;
  const docx = globalThis.docx;
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    spacing: {
      before: spacingBefore * 20,
      after: spacingAfter * 20,
      line: 240
    },
    indent: {
      left: Math.round(leftCm * 567),
      right: Math.round(rightCm * 567)
    },
    children: [
      new docx.TextRun({
        text,
        bold,
        font,
        size: 24
      })
    ]
  });
}

function spacerParagraph(lines = 1) {
  const docx = globalThis.docx;
  return new docx.Paragraph({
    spacing: {
      after: Math.max(0, lines) * 12 * 20,
      line: 240
    },
    children: [new docx.TextRun({ text: "" })]
  });
}

function buildWordParagraphsForLine(line, index, ctx) {
  if (line.secondary !== undefined) {
    return [buildWordDualBlock(line, index, ctx)];
  }
  return [buildWordParagraph(line.displayText, line.type, index, ctx)];
}

function buildWordParagraph(text, type, index, ctx) {
  const { Paragraph, TextRun, AlignmentType, cmToTwip, ptToHalfPoint, lineTwip, font } = ctx;
  const layout = getExportLayout(type);
  const config = getWordTypeConfig(type);

  return new Paragraph({
    alignment: config.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: {
      before: (index === 0 ? 0 : config.beforePt) * 20,
      after: config.afterPt * 20,
      line: lineTwip
    },
    indent: {
      left: cmToTwip(config.leftCm),
      right: cmToTwip(config.rightCm)
    },
    children: [
      new TextRun({
        text: config.uppercase ? text.toUpperCase() : text,
        bold: Boolean(config.bold ?? layout.bold),
        italics: Boolean(config.italic ?? layout.italic),
        font,
        size: ptToHalfPoint(EXPORT_TYPOGRAPHY.fontSizePt)
      })
    ]
  });
}

function buildWordDualBlock(line, index, ctx) {
  const {
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    VerticalAlign,
    cmToTwip
  } = ctx;

  const config = getWordTypeConfig(line.type);
  const dualParagraphs = buildDualCellParagraphs(line, index, ctx);
  const totalWritingWidthCm = 21.59 - 2.5 - 2.5;
  const gapCm = 0.8;
  const columnWidthCm = (totalWritingWidthCm - gapCm) / 2;
  const beforeTwip = (index === 0 ? 0 : config.beforePt) * 20;

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
    columnWidths: [cmToTwip(columnWidthCm), cmToTwip(columnWidthCm)],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: cmToTwip(columnWidthCm), type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: {
              top: 0,
              bottom: 0,
              left: 0,
              right: cmToTwip(gapCm / 2)
            },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
            },
            children: dualParagraphs.left
          }),
          new TableCell({
            width: { size: cmToTwip(columnWidthCm), type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: {
              top: 0,
              bottom: 0,
              left: cmToTwip(gapCm / 2),
              right: 0
            },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
            },
            children: dualParagraphs.right
          })
        ]
      })
    ],
    margins: {
      top: beforeTwip,
      bottom: config.afterPt * 20,
      left: 0,
      right: 0
    }
  });
}

function buildDualCellParagraphs(line, index, ctx) {
  return {
    left: [buildWordCellParagraph(line.displayText, line.type, index, ctx)],
    right: [buildWordCellParagraph(line.secondary, line.type, index, ctx)]
  };
}

function buildWordCellParagraph(text, type, index, ctx) {
  const { Paragraph, TextRun, AlignmentType, ptToHalfPoint, lineTwip, font } = ctx;
  const layout = getExportLayout(type);
  const config = getWordTypeConfig(type);

  return new Paragraph({
    alignment: config.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: {
      before: 0,
      after: 0,
      line: lineTwip
    },
    indent: {
      left: 0,
      right: 0
    },
    children: [
      new TextRun({
        text: config.uppercase ? text.toUpperCase() : text,
        bold: Boolean(config.bold ?? layout.bold),
        italics: Boolean(config.italic ?? layout.italic),
        font,
        size: ptToHalfPoint(EXPORT_TYPOGRAPHY.fontSizePt)
      })
    ]
  });
}

function getWordTypeConfig(type) {
  switch (type) {
    case "scene":
      return { leftCm: 0, rightCm: 0, beforePt: 12, afterPt: 12, bold: true, uppercase: true, align: "left" };
    case "character":
      return { leftCm: 5, rightCm: 0, beforePt: 12, afterPt: 0, bold: true, uppercase: true, align: "left" };
    case "dialogue":
      return { leftCm: 2.5, rightCm: 2.5, beforePt: 0, afterPt: 0, align: "left" };
    case "parenthetical":
      return { leftCm: 3.75, rightCm: 2.5, beforePt: 0, afterPt: 0, italic: true, align: "left" };
    case "transition":
      return { leftCm: 0, rightCm: 0, beforePt: 12, afterPt: 0, bold: true, uppercase: true, align: "right" };
    case "shot":
      return { leftCm: 0, rightCm: 0, beforePt: 12, afterPt: 0, bold: true, uppercase: true, align: "left" };
    case "note":
      return { leftCm: 0, rightCm: 0, beforePt: 12, afterPt: 0, italic: true, align: "left" };
    case "dual":
      return { leftCm: 5, rightCm: 0, beforePt: 12, afterPt: 0, bold: true, uppercase: true, align: "left" };
    case "action":
    case "text":
    case "image":
    default:
      return { leftCm: 0, rightCm: 0, beforePt: 12, afterPt: 0, align: "left" };
  }
}

function renderHtmlExportLine(line, prefix, lineIndex = 0) {
  const spacingStyle = buildBlockSpacingStyle(line.type, lineIndex);
  if (line.secondary !== undefined) {
    const rowStyle = `${prefix === 'word' ? buildWordBlockSpacingStyle(line.type, lineIndex) : spacingStyle}${prefix === 'word' ? buildWordDualRowStyle(line.type) : ''}`;
    const colStyle = prefix === 'word' ? buildWordDualColStyle(line.type) : '';
    return `<div class="${prefix}-line ${prefix}-dual-row ${escapeHtml(line.type)}" style="${rowStyle}"><span class="${prefix}-dual-col" style="${colStyle}">${escapeHtml(line.displayText)}</span><span class="${prefix}-dual-col" style="${colStyle}">${escapeHtml(line.secondary)}</span></div>`;
  }
  const lineStyle = `${prefix === 'word' ? buildWordBlockSpacingStyle(line.type, lineIndex) : spacingStyle}${prefix === 'word' ? buildWordLineStyle(line.type) : ''}`;
  return `<p class="${prefix}-line ${escapeHtml(line.type)}" style="${lineStyle}">${escapeHtml(line.displayText)}</p>`;
}

function buildBlockSpacingStyle(type, lineIndex) {
  if (lineIndex === 0) {
    return "margin-top:0;";
  }
  const spacingLines = Math.max(0, getExportLayout(type).beforeLines || 0);
  return `margin-top:${spacingLines * 12}pt;`;
}

function buildPrintableCoverMarkup(project) {
  return `
    <div class="print-cover-stack">
      <p class="print-cover-title">${escapeHtml(project.title)}</p>
      <p class="print-cover-byline">${escapeHtml(t("cover.by"))}</p>
      <p class="print-cover-author">${escapeHtml(project.author || t("cover.authorFallback"))}</p>
      <p class="print-cover-meta">${escapeHtml(project.contact || "")}</p>
      <p class="print-cover-meta">${escapeHtml(project.company || "")}</p>
      <p class="print-cover-meta">${escapeHtml(project.details || "")}</p>
      <p class="print-cover-logline">${escapeHtml(project.logline || "")}</p>
    </div>
  `;
}

function buildWordCoverMarkup(project) {
  return `
    <div class="word-cover-stack">
      <p class="word-cover-title">${escapeHtml(project.title)}</p>
      <p class="word-cover-byline">${escapeHtml(t("cover.by"))}</p>
      <p class="word-cover-author">${escapeHtml(project.author || t("cover.authorFallback"))}</p>
      <p class="word-cover-meta">${escapeHtml(project.contact || "")}</p>
      <p class="word-cover-meta">${escapeHtml(project.company || "")}</p>
      <p class="word-cover-meta">${escapeHtml(project.details || "")}</p>
      <p class="word-cover-logline">${escapeHtml(project.logline || "")}</p>
    </div>
  `;
}

function buildWordLineStyle(type) {
  const layout = getExportLayout(type);
  const characterMarginCm = 5;
  const dialogueMarginCm = 2.5;
  const defaultMarginLeft = `${layout.indentIn}in`;
  const defaultWidth = `${layout.widthIn}in`;
  const rules = [
    `margin-left:${type === 'character' ? `${characterMarginCm}cm` : defaultMarginLeft}`,
    `width:${type === 'dialogue' ? 'auto' : defaultWidth}`,
    `text-align:${layout.align}`,
    `font-family:${EXPORT_TYPOGRAPHY.cssFontFamily}`,
    `font-size:${EXPORT_TYPOGRAPHY.fontSizePt}pt`,
    `line-height:${EXPORT_TYPOGRAPHY.lineHeight}`,
    'white-space:pre-wrap',
    'margin-bottom:0',
    `margin-right:${type === 'dialogue' ? `${dialogueMarginCm}cm` : '0'}`,
    `font-weight:${layout.bold ? '700' : '400'}`,
    `font-style:${layout.italic ? 'italic' : 'normal'}`,
    `mso-bidi-font-weight:${layout.bold ? 'bold' : 'normal'}`
  ];

  if (type === 'dialogue') {
    rules.push(`margin-left:${dialogueMarginCm}cm`);
  }
  if (type === 'scene') {
    rules.push('text-transform:uppercase');
  }

  return `${rules.join(';')};`;
}

function buildWordDualRowStyle(type) {
  const layout = getExportLayout(type);
  const rules = [
    `margin-left:${type === 'character' || type === 'dual' ? '5cm' : `${layout.indentIn}in`}`,
    'display:grid',
    `grid-template-columns:${layout.widthIn}in ${layout.widthIn}in`,
    'column-gap:0.5in',
    `width:${(layout.widthIn * 2) + 0.5}in`,
    'white-space:pre-wrap',
    'margin-right:0',
    `font-weight:${layout.bold ? '700' : '400'}`
  ];
  return `${rules.join(';')};`;
}

function buildWordDualColStyle(type) {
  const layout = getExportLayout(type);
  const rules = [
    `width:${layout.widthIn}in`,
    `text-align:${layout.align}`,
    `font-family:${EXPORT_TYPOGRAPHY.cssFontFamily}`,
    `font-size:${EXPORT_TYPOGRAPHY.fontSizePt}pt`,
    `line-height:${EXPORT_TYPOGRAPHY.lineHeight}`,
    'white-space:pre-wrap',
    'vertical-align:top'
  ];

  rules.push(`font-weight:${layout.bold ? '700' : '400'}`);
  rules.push(`font-style:${layout.italic ? 'italic' : 'normal'}`);

  return `${rules.join(';')};`;
}

function buildWordBlockSpacingStyle(type, lineIndex) {
  if (lineIndex === 0) {
    return 'margin-top:0;margin-bottom:0;';
  }
  if (type === 'dialogue' || type === 'parenthetical') {
    return 'margin-top:0;margin-bottom:0;';
  }
  if (type === 'scene') {
    return 'margin-top:12pt;margin-bottom:12pt;';
  }
  return buildBlockSpacingStyle(type, lineIndex);
}

function buildTypeCss(prefix) {
  return Object.entries({
    scene: ['font-weight:700'],
    shot: ['font-weight:700'],
    transition: ['font-weight:700', 'text-align:right', 'margin-left:3.5in', 'width:3in'],
    character: ['font-weight:700', 'margin-left:2in', 'width:4.25in'],
    dialogue: ['margin-left:1in', 'width:4in'],
    parenthetical: ['margin-left:1.5in', 'width:3in'],
    text: [],
    action: [],
    note: ['font-style:italic'],
    image: [],
    dual: ['font-weight:700']
  }).map(([type, declarations]) => `.${prefix}-line.${type}{${declarations.join(';')}}`).join('');
}

function buildDualCss(prefix) {
  const left = getExportLayout('dual').widthIn;
  return `
    .${prefix}-dual-row {
      display: grid;
      grid-template-columns: ${left}in ${left}in;
      column-gap: 0.5in;
      width: 100%;
      margin: 0;
      white-space: pre-wrap;
    }
    .${prefix}-dual-col {
      display: block;
      width: ${left}in;
      white-space: pre-wrap;
      vertical-align: top;
    }
    .${prefix}-dual-row.dialogue .${prefix}-dual-col,
    .${prefix}-dual-row.parenthetical .${prefix}-dual-col {
      font-weight: 400;
    }
    .${prefix}-dual-row.parenthetical .${prefix}-dual-col {
      padding-left: 0.5in;
    }
  `;
}

function getPrintableStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: ${EXPORT_TYPOGRAPHY.cssFontFamily};
      font-size: ${EXPORT_TYPOGRAPHY.fontSizePt}pt;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    .print-shell {
      display: grid;
      gap: 0;
      padding: 0;
    }
    .print-page {
      width: ${EXPORT_PAGE_SETTINGS.widthIn}in;
      height: ${EXPORT_PAGE_SETTINGS.heightIn}in;
      margin: 0 auto;
      background: #fff;
      color: #111;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
    }
    .print-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .print-frame {
      display: grid;
      grid-template-rows: ${EXPORT_PAGE_SETTINGS.marginsIn.top}in 1fr ${EXPORT_PAGE_SETTINGS.marginsIn.bottom}in;
      height: 100%;
      padding: 0 ${2.5 * EXPORT_PAGE_SETTINGS.cmToIn}in 0 ${2.5 * EXPORT_PAGE_SETTINGS.cmToIn}in;
    }
    .print-header,
    .print-footer-slot {
      width: 100%;
    }
    .cover-page {
      page-break-after: always;
      break-after: page;
    }
    .print-cover-text {
      white-space: pre-wrap;
      text-align: center;
      margin: 0;
    }
    .print-body {
      width: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .print-cover-body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .print-cover-stack {
      width: 100%;
      text-align: center;
      transform: translateY(-48pt);
    }
    .print-cover-title,
    .print-cover-byline,
    .print-cover-author,
    .print-cover-meta,
    .print-cover-logline {
      margin: 0;
      white-space: pre-wrap;
      font-weight: 400;
    }
    .print-cover-title {
      font-weight: 700;
      margin-bottom: 36pt;
    }
    .print-cover-byline {
      margin-bottom: 12pt;
    }
    .print-cover-author {
      font-weight: 700;
      margin-bottom: 36pt;
    }
    .print-cover-meta {
      margin-bottom: 6pt;
    }
    .print-cover-logline {
      margin-top: 24pt;
      margin-left: 3.5cm;
      margin-right: 3.5cm;
    }
    .print-line {
      margin: 0;
      white-space: pre-wrap;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    ${buildTypeCss('print')}
    ${buildDualCss('print')}
    .print-footer {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding-bottom: ${EXPORT_PAGE_SETTINGS.footerNumberOffsetIn}in;
      font-size: 10pt;
      color: #111111;
    }
    @page {
      size: letter;
      margin: 0;
    }
    @media print {
      body { background: #fff; }
      .print-page { box-shadow: none; }
    }
  `;
}

function getWordStyles() {
  return `
    @page WordSection {
      size: ${EXPORT_PAGE_SETTINGS.widthIn}in ${EXPORT_PAGE_SETTINGS.heightIn}in;
      margin: ${EXPORT_PAGE_SETTINGS.marginsIn.top}in ${EXPORT_PAGE_SETTINGS.marginsIn.right}in ${EXPORT_PAGE_SETTINGS.marginsIn.bottom}in ${EXPORT_PAGE_SETTINGS.marginsIn.left}in;
    }
    body {
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: ${EXPORT_TYPOGRAPHY.cssFontFamily};
      font-size: ${EXPORT_TYPOGRAPHY.fontSizePt}pt;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    .word-shell {
      width: 100%;
    }
    .word-page {
      page: WordSection;
      width: 100%;
      height: ${EXPORT_PAGE_SETTINGS.heightIn}in;
      page-break-after: always;
      break-after: page;
      mso-break-type: page;
      overflow: hidden;
    }
    .word-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .word-explicit-page-break {
      page-break-before: always;
      break-before: page;
      mso-break-type: page;
      height: 0;
      overflow: hidden;
      line-height: 0;
      font-size: 0;
    }
    .word-frame {
      display: grid;
      grid-template-rows: ${EXPORT_PAGE_SETTINGS.marginsIn.top}in 1fr ${EXPORT_PAGE_SETTINGS.marginsIn.bottom}in;
      height: 100%;
      padding: 0 ${2.5 * EXPORT_PAGE_SETTINGS.cmToIn}in 0 ${2.5 * EXPORT_PAGE_SETTINGS.cmToIn}in;
    }
    .word-header,
    .word-footer-slot {
      width: 100%;
    }
    .cover-page {
      page-break-after: auto;
      break-after: auto;
      mso-break-type: auto;
    }
    .word-cover-shell {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .word-cover-stack {
      width: 100%;
      text-align: center;
      transform: translateY(-48pt);
    }
    .word-cover-title,
    .word-cover-byline,
    .word-cover-author,
    .word-cover-meta,
    .word-cover-logline {
      margin: 0;
      white-space: pre-wrap;
    }
    .word-cover-title {
      font-weight: 700;
      margin-bottom: 36pt;
    }
    .word-cover-byline {
      margin-bottom: 12pt;
    }
    .word-cover-author {
      font-weight: 700;
      margin-bottom: 36pt;
    }
    .word-cover-meta {
      margin-bottom: 6pt;
    }
    .word-cover-logline {
      margin-top: 24pt;
      margin-left: 3.5cm;
      margin-right: 3.5cm;
    }
    .word-body {
      width: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .word-line {
      margin: 0;
      white-space: pre-wrap;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    ${buildTypeCss('word')}
    ${buildDualCss('word')}
  `;
}
