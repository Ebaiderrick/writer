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

export function buildWordDocument(project) {
  const previewData = buildPreviewData(project);
  const coverMarkup = `
    <div class="word-page cover-page">
      <div class="word-frame cover-frame">
        <div class="word-header"></div>
        <div class="word-body word-cover-shell">
          <div class="word-cover-stack">
            <p class="word-cover-title">${escapeHtml(project.title)}</p>
            <p class="word-cover-byline">${escapeHtml(t("cover.by"))}</p>
            <p class="word-cover-author">${escapeHtml(project.author || t("cover.authorFallback"))}</p>
            <p class="word-cover-meta">${escapeHtml(project.contact || "")}</p>
            <p class="word-cover-meta">${escapeHtml(project.company || "")}</p>
            <p class="word-cover-meta">${escapeHtml(project.details || "")}</p>
            <p class="word-cover-logline">${escapeHtml(project.logline || "")}</p>
          </div>
        </div>
        <div class="word-footer-slot"></div>
      </div>
    </div>
  `;

  const scriptPagesMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageFooter = state.viewOptions.pageNumbers
      ? `<div class="word-page-number">${escapeHtml(buildPageNumberLabel(pageNum, previewData.scriptPages.length))}</div>`
      : `<div class="word-page-number word-page-number-placeholder"></div>`;
    const pageClassName = 'word-page word-script-page';

    return `
      <div class="${pageClassName}">
        <div class="word-frame">
          <div class="word-header"></div>
          <div class="word-body">
            ${pageLines.map((line, lineIndex) => renderHtmlExportLine(line, 'word', lineIndex)).join('')}
          </div>
          <div class="word-footer-slot">
            ${pageFooter}
          </div>
        </div>
      </div>
  `;
  });

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name="ProgId" content="Word.Document">
  <meta name="Generator" content="EyaWriter">
  <title>${escapeHtml(project.title)}</title>
  <style>${getWordStyles()}</style>
</head>
<body>
  <main class="word-shell">
    ${coverMarkup}
    <br clear="all" class="word-explicit-page-break" style="mso-special-character: line-break; page-break-before: always;">
    ${scriptPagesMarkup.join('')}
  </main>
</body>
</html>`;
}

function renderHtmlExportLine(line, prefix, lineIndex = 0) {
  const spacingStyle = buildBlockSpacingStyle(line.type, lineIndex);
  if (line.secondary !== undefined) {
    const rowStyle = `${spacingStyle}${prefix === 'word' ? buildWordDualRowStyle(line.type) : ''}`;
    const colStyle = prefix === 'word' ? buildWordDualColStyle(line.type) : '';
    return `<div class="${prefix}-line ${prefix}-dual-row ${escapeHtml(line.type)}" style="${rowStyle}"><span class="${prefix}-dual-col" style="${colStyle}">${escapeHtml(line.displayText)}</span><span class="${prefix}-dual-col" style="${colStyle}">${escapeHtml(line.secondary)}</span></div>`;
  }
  const lineStyle = `${spacingStyle}${prefix === 'word' ? buildWordLineStyle(line.type) : ''}`;
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

function buildCoverText(project, titleLeadingBreaks = 10) {
  const topPadding = "\n".repeat(Math.max(0, titleLeadingBreaks));
  return `${topPadding}${escapeHtml(project.title)}\n\n\n${escapeHtml(t("cover.by"))}\n\n${escapeHtml(project.author || t("cover.authorFallback"))}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
}

function buildWordLineStyle(type) {
  const layout = getExportLayout(type);
  const rules = [
    `margin-left:${layout.indentIn}in`,
    `width:${layout.widthIn}in`,
    `text-align:${layout.align}`,
    `font-family:${EXPORT_TYPOGRAPHY.cssFontFamily}`,
    `font-size:${EXPORT_TYPOGRAPHY.fontSizePt}pt`,
    `line-height:${EXPORT_TYPOGRAPHY.lineHeight}`,
    'white-space:pre-wrap',
    'margin-bottom:0'
  ];

  if (layout.bold) {
    rules.push('font-weight:700');
  }
  if (layout.italic) {
    rules.push('font-style:italic');
  }

  return `${rules.join(';')};`;
}

function buildWordDualRowStyle(type) {
  const layout = getExportLayout(type);
  const rules = [
    `margin-left:${layout.indentIn}in`,
    'display:grid',
    `grid-template-columns:${layout.widthIn}in ${layout.widthIn}in`,
    'column-gap:0.5in',
    `width:${(layout.widthIn * 2) + 0.5}in`,
    'white-space:pre-wrap'
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

  if (layout.bold) {
    rules.push('font-weight:700');
  }
  if (layout.italic) {
    rules.push('font-style:italic');
  }

  return `${rules.join(';')};`;
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
      padding: 0 ${EXPORT_PAGE_SETTINGS.marginsIn.right}in 0 ${EXPORT_PAGE_SETTINGS.marginsIn.left}in;
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
      margin-bottom: 36pt;
      font-weight: 700;
    }
    .word-cover-byline {
      margin-bottom: 12pt;
    }
    .word-cover-author {
      margin-bottom: 36pt;
    }
    .word-cover-logline {
      margin-top: 24pt;
    }
    .word-page-number {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding-bottom: ${EXPORT_PAGE_SETTINGS.footerNumberOffsetIn}in;
      font-size: 10pt;
    }
    .word-page-number-placeholder {
      visibility: hidden;
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
