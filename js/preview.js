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

    const body = document.createElement("div");
    body.className = "preview-page-body";

    pageLines.forEach((line) => {
      const node = document.createElement("p");
      node.className = line.type; // Use clean classes: scene, action, character, etc.
      node.textContent = line.displayText;
      body.appendChild(node);
    });

    if (!pageLines.length) {
      body.appendChild(createTextNode("Your screenplay preview appears here."));
    }

    scriptPage.appendChild(body);

    if (state.viewOptions.pageNumbers || state.viewOptions.pageCount) {
      const footer = document.createElement("div");
      footer.className = "preview-page-footer";
      footer.textContent = buildPreviewFooterLabel(pageIndex + 1, previewData.scriptPages.length);
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
  // Page numbering requirement from memory:
  // top-right corner, 0.5" from top, flush with right margin,
  // formatted with trailing period (e.g., "2."), omitted from first page.
  // This function currently handles the preview panel footer.
  if (state.viewOptions.pageNumbers && state.viewOptions.pageCount) {
    return `Page ${pageNumber} of ${totalPages}`;
  }
  if (state.viewOptions.pageNumbers) {
    return `Page ${pageNumber}.`;
  }
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
    <div class="print-page-break" aria-hidden="true"></div>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageHeader = (pageNum > 1 && state.viewOptions.pageNumbers) ? `<div class="print-page-number">${pageNum}.</div>` : "";

    return `
    <section class="print-page">
      ${pageHeader}
      <div class="print-body">
        ${pageLines.map((line) => `<p class="${line.type}">${escapeHtml(line.displayText)}</p>`).join("")}
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
  ${autoPrint ? "<script>window.addEventListener('load', function () { window.print(); });<\/script>" : ""}
</body>
</html>`;
}

function getPrintableStyles() {
  return `
    @page {
      size: 8.5in 11in;
      margin-top: 1in;
      margin-bottom: 1in;
      margin-left: 1.5in;
      margin-right: 1in;
    }

    body {
      font-family: "Courier New", Courier, monospace;
      font-size: 12pt;
      line-height: 1;
      background: white;
      color: black;
      margin: 0;
    }

    * { box-sizing: border-box; }

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
      padding: 0; /* Margins are handled by @page in print, and we'll center for preview */
      background: #fff;
      color: #111;
      page-break-after: always;
      break-after: page;
    }

    /* Adjust padding for browser preview (non-print) */
    @media screen {
      .print-page {
        padding: 1in 1in 1in 1.5in;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        margin-bottom: 20px;
      }
      body {
        background: #f3f1ef;
        padding: 20px;
      }
    }

    .print-page-number {
      position: absolute;
      top: 0.5in;
      right: 0in; /* Flush with right margin */
      font-family: "Courier New", Courier, monospace;
      font-size: 12pt;
    }

    .cover-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .print-cover-text {
      white-space: pre-wrap;
      text-align: center;
      margin: 0;
    }

    .scene {
      text-transform: uppercase;
      margin-top: 24px;
      margin-bottom: 12px;
    }

    .action {
      margin-bottom: 12px;
    }

    .character {
      margin-left: 2.2in; /* Relative to 1.5in left margin = 3.7in total */
      width: 2in;
      text-transform: uppercase;
    }

    .parenthetical {
      margin-left: 1.7in; /* Relative to 1.5in left margin = 3.2in total */
      width: 2.5in;
      font-style: italic;
    }

    .dialogue {
      margin-left: 1in; /* Relative to 1.5in left margin = 2.5in total */
      width: 3.5in;
      margin-bottom: 12px;
    }

    .transition {
      text-align: right;
      margin-top: 12px;
      margin-left: auto;
      width: 2in;
    }

    @media print {
      body {
        margin: 0;
        background: white;
      }
      .print-page {
        box-shadow: none;
        margin: 0;
        width: 100%;
        page-break-after: always;
      }
    }
  `;
}
