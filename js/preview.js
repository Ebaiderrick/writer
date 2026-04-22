import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, syncProjectFromInputs } from './project.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml, createTextNode, normalizeLineText } from './utils.js';

export function renderCoverPreview() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
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
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  coverPage.innerHTML = `<pre class="preview-cover-text">${coverText}</pre>`;
  pages.appendChild(coverPage);

  previewData.scriptPages.forEach((pageLines, pageIndex) => {
    const scriptPage = document.createElement("section");
    scriptPage.className = "preview-page-sheet";

    if (state.viewOptions.pageNumbers && pageIndex > 0) {
      const pageNumber = document.createElement("div");
      pageNumber.className = "preview-page-number";
      pageNumber.textContent = `${pageIndex + 1}.`;
      scriptPage.appendChild(pageNumber);
    }

    const body = document.createElement("div");
    body.className = "preview-page-body";

    pageLines.forEach((line) => {
      const node = document.createElement("p");
      node.className = `preview-line ${line.type}`;
      node.textContent = line.displayText;
      body.appendChild(node);
    });

    if (!pageLines.length) {
      body.appendChild(createTextNode("Your screenplay preview appears here."));
    }

    scriptPage.appendChild(body);

    if (state.viewOptions.pageCount && !state.viewOptions.pageNumbers) {
      const footer = document.createElement("div");
      footer.className = "preview-page-footer";
      footer.textContent = `${previewData.scriptPages.length} pages`;
      scriptPage.appendChild(footer);
    }

    pages.appendChild(scriptPage);
  });

  refs.preview.appendChild(pages);
}

export function buildPreviewData(project) {
  const preparedLines = [];
  let sceneNumber = 0;

  project.lines.forEach((line) => {
    const normalized = normalizeLineText(line.text, line.type);
    if (!normalized) {
      return;
    }
    if (line.type === "scene") {
      sceneNumber += 1;
    }
    preparedLines.push({
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized
    });
  });

  return {
    scriptPages: paginateScriptLines(preparedLines)
  };
}

function buildPreviewFooterLabel(pageNumber, totalPages) {
  if (state.viewOptions.pageCount) {
    return `${totalPages} pages`;
  }
  return "";
}

export function buildPrintableDocument(project, autoPrint = false) {
  const previewData = buildPreviewData(project);
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  const coverMarkup = `
    <section class="print-page cover-page">
      <pre class="print-cover-text">${coverText}</pre>
    </section>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageHeader = (pageNum > 1 && state.viewOptions.pageNumbers) ? `<div class="print-page-number">${pageNum}.</div>` : "";

    return `
    <section class="print-page">
      ${pageHeader}
      <div class="print-body">
        ${pageLines.map((line) => `<p class="print-line ${line.type}">${escapeHtml(line.displayText)}</p>`).join("")}
      </div>
      ${(state.viewOptions.pageCount && !state.viewOptions.pageNumbers)
        ? `<div class="print-footer">${escapeHtml(buildPreviewFooterLabel(pageNum, previewData.scriptPages.length))}</div>`
        : ""}
    </section>
  `}).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(project.title)}</title>
  <style>${getPrintableStyles()}</style>
</head>
  <body data-theme="${escapeHtml(state.theme)}">
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
      <table class="word-cover-table" role="presentation">
        <tr>
          <td class="word-cover-cell" align="center" valign="middle">
            <div class="word-cover-stack">
              <p class="word-cover-title">${escapeHtml(project.title)}</p>
              <p class="word-cover-byline">by</p>
              <p class="word-cover-author">${escapeHtml(project.author || "Author")}</p>
              <p class="word-cover-meta">${escapeHtml(project.contact || "")}</p>
              <p class="word-cover-meta">${escapeHtml(project.company || "")}</p>
              <p class="word-cover-meta">${escapeHtml(project.details || "")}</p>
              <p class="word-cover-logline">${escapeHtml(project.logline || "")}</p>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  const scriptPagesMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageHeader = (pageNum > 1 && state.viewOptions.pageNumbers)
      ? `<div class="word-page-number">${pageNum}.</div>`
      : `<div class="word-page-number word-page-number-placeholder"></div>`;

    return `
      <div class="word-page">
        ${pageHeader}
        <div class="word-body">
          ${pageLines.map((line) => `<p class="word-line ${line.type}" style="${buildWordLineStyle(line.type)}">${escapeHtml(line.displayText)}</p>`).join("")}
        </div>
      </div>
    `;
  });

  const pageBreakMarkup = '<div class="word-page-break"><span>&nbsp;</span></div>';
  const scriptMarkup = scriptPagesMarkup.join(pageBreakMarkup);

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name="ProgId" content="Word.Document">
  <meta name="Generator" content="EyaWriter">
  <title>${escapeHtml(project.title)}</title>
  <style>
    @page WordSection {
      size: 8.5in 11in;
      margin: 1.0in 1.0in 1.0in 1.5in;
    }
    body {
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: "Courier New", Courier, monospace;
      font-size: 12pt;
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
    }
    .word-cover-table {
      width: 100%;
      height: 9in;
      border-collapse: collapse;
    }
    .word-cover-cell {
      vertical-align: middle;
      text-align: center;
      padding: 0;
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
    }
    .word-cover-title {
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 28pt;
    }
    .word-cover-byline {
      margin-bottom: 18pt;
    }
    .word-cover-author {
      margin-bottom: 28pt;
    }
    .word-cover-meta {
      margin-bottom: 8pt;
    }
    .word-cover-logline {
      margin-top: 24pt;
      white-space: pre-wrap;
    }
    .word-page-number {
      position: absolute;
      top: -0.5in;
      right: 0;
    }
    .word-page-break {
      page-break-after: always;
      break-after: page;
      height: 0;
      overflow: hidden;
    }
    .word-body {
      width: 100%;
    }
    .word-line {
      margin: 0 0 12pt;
      white-space: pre-wrap;
      line-height: 1.2;
    }
  </style>
</head>
<body>
  <main class="word-shell">
    ${coverMarkup}
    ${pageBreakMarkup}
    ${scriptMarkup}
  </main>
</body>
</html>`;
}

function buildWordLineStyle(type) {
  const base = [
    "margin-top:0",
    "margin-bottom:12pt",
    "white-space:pre-wrap",
    "line-height:1.2"
  ];

  switch (type) {
    case "scene":
    case "shot":
      return `${base.join(";")};font-weight:bold;text-transform:uppercase;`;
    case "transition":
      return `${base.join(";")};font-weight:bold;text-transform:uppercase;margin-left:3.7in;text-align:right;`;
    case "character":
    case "dual":
      return `${base.join(";")};font-weight:bold;text-transform:uppercase;margin-left:2.2in;`;
    case "dialogue":
      return `${base.join(";")};margin-left:1.5in;margin-right:1.5in;`;
    case "parenthetical":
      return `${base.join(";")};margin-left:1.9in;margin-right:2.0in;`;
    default:
      return `${base.join(";")};`;
  }
}

function getPrintableStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f1ef;
      color: #111;
      font-family: "Courier New", Courier, monospace;
    }
    .print-shell {
      display: grid;
      gap: 0;
      padding: 0;
    }
    .print-page {
      position: relative;
      width: 8.5in;
      min-height: 11in;
      margin: 0 auto;
      padding: 1.0in 1.0in 1.0in 1.5in;
      background: #fff;
      color: #111;
      page-break-after: always;
      break-after: page;
      font-size: 12pt;
    }
    .print-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .print-page-number {
      position: absolute;
      top: 0.5in;
      right: 1.0in;
      font-family: "Courier New", Courier, monospace;
      font-size: 12pt;
    }
    .cover-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding-left: 1.0in; /* Center for cover */
    }
    .print-cover-text {
      white-space: pre-wrap;
      text-align: center;
      margin: 0;
    }
    .print-body {
      width: 100%;
    }
    .print-line {
      margin: 0 0 12pt;
      white-space: pre-wrap;
      line-height: 1.2;
    }
    .print-line.scene,
    .print-line.shot,
    .print-line.transition {
      font-weight: bold;
      text-transform: uppercase;
    }
    .print-line.character,
    .print-line.dual {
      margin-left: 2.2in;
      width: 2.4in;
      text-transform: uppercase;
      font-weight: bold;
    }
    .print-line.dialogue {
      margin-left: 1.0in;
      width: 3.5in;
    }
    .print-line.parenthetical {
      margin-left: 1.6in;
      width: 2.4in;
    }
    .print-line.transition {
      margin-left: auto;
      width: 2.4in;
      text-align: right;
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
