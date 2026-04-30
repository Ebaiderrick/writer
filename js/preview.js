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
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\n${escapeHtml(t("cover.by"))}\n\n${escapeHtml(project.author || t("cover.authorFallback"))}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  const coverMarkup = `
    <section class="print-page cover-page">
      <pre class="print-cover-text">${coverText}</pre>
    </section>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageFooter = state.viewOptions.pageNumbers
      ? `<div class="print-footer">${escapeHtml(buildPageNumberLabel(pageNum, previewData.scriptPages.length))}</div>`
      : "";

    const firstScriptPageClass = index === 0 ? " script-page-first" : "";
    return `
    <section class="print-page script-page${firstScriptPageClass}">
      <div class="print-body">
        ${pageLines.map((line) => renderHtmlExportLine(line, 'print')).join('')}
      </div>
      ${pageFooter}
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
      <div class="word-cover-shell">
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
    </div>
  `;

  const scriptPagesMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageHeader = state.viewOptions.pageNumbers
      ? `<div class="word-page-number">${escapeHtml(buildPageNumberLabel(pageNum, previewData.scriptPages.length))}</div>`
      : `<div class="word-page-number word-page-number-placeholder"></div>`;
    const pageClassName = index === 0 ? 'word-page word-script-page word-script-page-first' : 'word-page word-script-page';

    return `
      <div class="${pageClassName}">
        ${pageHeader}
        <div class="word-body">
          ${pageLines.map((line) => renderHtmlExportLine(line, 'word')).join('')}
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
    ${scriptPagesMarkup.join('')}
  </main>
</body>
</html>`;
}

function renderHtmlExportLine(line, prefix) {
  if (line.secondary !== undefined) {
    return `<div class="${prefix}-line ${prefix}-dual-row ${escapeHtml(line.type)}"><span class="${prefix}-dual-col">${escapeHtml(line.displayText)}</span><span class="${prefix}-dual-col">${escapeHtml(line.secondary)}</span></div>`;
  }
  return `<p class="${prefix}-line ${escapeHtml(line.type)}">${escapeHtml(line.displayText)}</p>`;
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
      position: relative;
      width: ${EXPORT_PAGE_SETTINGS.widthIn}in;
      min-height: ${EXPORT_PAGE_SETTINGS.heightIn}in;
      margin: 0 auto;
      padding: ${EXPORT_PAGE_SETTINGS.marginsIn.top}in ${EXPORT_PAGE_SETTINGS.marginsIn.right}in ${EXPORT_PAGE_SETTINGS.marginsIn.bottom}in ${EXPORT_PAGE_SETTINGS.marginsIn.left}in;
      background: #fff;
      color: #111;
      page-break-after: always;
      break-after: page;
    }
    .print-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .cover-page {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .script-page-first {
      page-break-before: always !important;
      break-before: page !important;
    }
    .print-cover-text {
      white-space: pre-wrap;
      text-align: center;
      margin: 0;
    }
    .print-body {
      width: 100%;
      padding-bottom: 0.35in;
    }
    .print-line {
      margin: 0;
      white-space: pre-wrap;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    .print-line + .print-line,
    .print-line + .print-dual-row,
    .print-dual-row + .print-line,
    .print-dual-row + .print-dual-row {
      margin-top: 12pt;
    }
    ${buildTypeCss('print')}
    ${buildDualCss('print')}
    .print-footer {
      position: absolute;
      right: ${EXPORT_PAGE_SETTINGS.marginsIn.right}in;
      bottom: 0.4in;
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
      position: relative;
      width: 100%;
      min-height: 9in;
    }
    .cover-page {
      min-height: 9in;
      page-break-after: always;
      break-after: page;
      mso-break-type: page;
    }
    .word-script-page {
      page-break-before: always;
      break-before: page;
      mso-break-type: page;
    }
    .word-script-page-first {
      page-break-before: always;
      break-before: page;
      mso-break-type: page;
    }
    .word-cover-shell {
      min-height: 9in;
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
      position: absolute;
      top: -0.3in;
      right: 0;
      font-size: 10pt;
    }
    .word-page-number-placeholder {
      visibility: hidden;
    }
    .word-body {
      width: 100%;
    }
    .word-line {
      margin: 0;
      white-space: pre-wrap;
      line-height: ${EXPORT_TYPOGRAPHY.lineHeight};
    }
    .word-line + .word-line,
    .word-line + .word-dual-row,
    .word-dual-row + .word-line,
    .word-dual-row + .word-dual-row {
      margin-top: 12pt;
    }
    ${buildTypeCss('word')}
    ${buildDualCss('word')}
  `;
}
