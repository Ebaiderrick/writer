import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, syncProjectFromInputs } from './project.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml, createTextNode, formatLineText } from './utils.js';
import { t } from './i18n.js';
import { buildFullScriptExportDocument } from './exportModel.js';
import { buildPrintableDocumentFromExportDocument } from './printExport.js';

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
    const entry = {
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized
    };
    if (line.secondary !== undefined) {
      entry.secondary = formatLineText(line.secondary, line.type);
    }
    preparedLines.push(entry);
  });

  return {
    scriptPages: paginateScriptLines(preparedLines)
  };
}

function buildPageNumberLabel(pageNumber, totalPages) {
  return t("preview.pageNumber", { page: pageNumber, total: totalPages });
}

export function buildPrintableDocument(project, autoPrint = false) {
  const exportDocument = buildFullScriptExportDocument(project, {
    includeSceneNumbers: state.autoNumberScenes,
    includeMetadata: true,
    includeTitlePage: true
  });
  return buildPrintableDocumentFromExportDocument(exportDocument, autoPrint);
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
              <p class="word-cover-byline">${escapeHtml(t("cover.by"))}</p>
              <p class="word-cover-author">${escapeHtml(project.author || t("cover.authorFallback"))}</p>
              <div class="word-cover-meta-group">
                ${project.contact ? `<p class="word-cover-meta">${escapeHtml(project.contact)}</p>` : ""}
                ${project.company ? `<p class="word-cover-meta">${escapeHtml(project.company)}</p>` : ""}
                ${project.details ? `<p class="word-cover-meta">${escapeHtml(project.details)}</p>` : ""}
              </div>
              ${project.logline ? `<p class="word-cover-logline">${escapeHtml(project.logline)}</p>` : ""}
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  const scriptPagesMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageHeader = state.viewOptions.pageNumbers
      ? `<div class="word-page-number">${escapeHtml(buildExportPageNumberLabel(pageNum))}</div>`
      : `<div class="word-page-number word-page-number-placeholder"></div>`;
    const pageClassName = index === 0 ? "word-page word-script-page word-script-page-first" : "word-page word-script-page";

    return `
      <div class="${pageClassName}">
        ${pageHeader}
        <div class="word-body">
          ${pageLines.map((line) => line.secondary !== undefined
            ? `<table class="word-dual-row" style="width:100%;border-collapse:collapse;margin-bottom:10pt;"><tr>
                <td class="word-dual-col" style="${buildWordDualColStyle(line.type)}">${escapeHtml(line.displayText)}</td>
                <td class="word-dual-col" style="${buildWordDualColStyle(line.type)}">${escapeHtml(line.secondary)}</td>
               </tr></table>`
            : `<p class="word-line ${line.type}" style="${buildWordLineStyle(line.type)}">${escapeHtml(line.displayText)}</p>`
          ).join("")}
        </div>
      </div>
    `;
  });
  const scriptMarkup = scriptPagesMarkup.join("");

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
      margin: 1in 1in 1in 1.5in;
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
      letter-spacing: 0.8pt;
      margin-bottom: 32pt;
    }
    .word-cover-byline {
      font-size: 11pt;
      margin-bottom: 14pt;
    }
    .word-cover-author {
      font-weight: bold;
      margin-bottom: 42pt;
    }
    .word-cover-meta-group {
      margin-bottom: 34pt;
    }
    .word-cover-meta {
      margin-bottom: 8pt;
    }
    .word-cover-logline {
      width: 4.8in;
      margin: 0 auto;
      white-space: pre-wrap;
      line-height: 1.35;
    }
    .word-page-number {
      position: absolute;
      top: 0;
      right: 0;
      font-size: 10pt;
    }
    .word-body {
      width: 100%;
      padding-top: 0.18in;
    }
    .word-line {
      margin: 0 0 11pt;
      white-space: pre-wrap;
      line-height: 1.22;
    }
  </style>
</head>
<body>
  <main class="word-shell">
    ${coverMarkup}
    ${scriptMarkup}
  </main>
</body>
</html>`;
}

function buildWordDualColStyle(type) {
  const base = "margin:0;padding:0 6pt;white-space:pre-wrap;line-height:1.22;vertical-align:top;width:50%;";
  switch (type) {
    case "character":
    case "dual":
      return `${base}font-weight:bold;padding-left:0.95in;text-transform:uppercase;`;
    case "parenthetical":
      return `${base}padding-left:0.7in;font-style:italic;`;
    case "dialogue":
      return `${base}padding-left:0.5in;padding-right:0.5in;`;
    default:
      return base;
  }
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
      return `${base.join(";")};font-weight:bold;margin-left:4.3in;width:2.2in;text-align:right;text-transform:uppercase;`;
    case "character":
    case "dual":
      return `${base.join(";")};font-weight:bold;margin-left:3.1in;width:2.3in;text-transform:uppercase;`;
    case "dialogue":
      return `${base.join(";")};margin-left:2.1in;width:3.2in;`;
    case "parenthetical":
      return `${base.join(";")};margin-left:2.6in;width:2.1in;font-style:italic;`;
    default:
      return `${base.join(";")};`;
  }
}

