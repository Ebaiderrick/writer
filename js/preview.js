import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, syncProjectFromInputs } from './project.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml, createTextNode, formatLineText, getExportFilename } from './utils.js';
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
        ${pageLines.map((line) => line.secondary !== undefined
          ? `<div class="print-line print-dual-row ${escapeHtml(line.type)}"><span class="print-dual-col">${escapeHtml(line.displayText)}</span><span class="print-dual-col">${escapeHtml(line.secondary)}</span></div>`
          : `<p class="print-line ${escapeHtml(line.type)}">${escapeHtml(line.displayText)}</p>`
        ).join("")}
      </div>
      ${pageFooter}
    </section>
  `}).join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(state.language)}">
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

export async function buildAdvancedWordBlob(project) {
  if (typeof docx === 'undefined') {
    throw new Error('docx library not loaded');
  }

  const {
    Document, Paragraph, TextRun, AlignmentType, HeadingLevel,
    Footer, PageNumber, Packer
  } = docx;

  const children = [];

  // Title page info if screenplay
  if (project.title || project.author) {
    children.push(new Paragraph({
      text: project.title || "Untitled Script",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 400 },
    }));

    if (project.author) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `by ${project.author}`, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
      }));
    }

    // Push details/contact if available
    [project.company, project.contact, project.details].filter(Boolean).forEach(detail => {
      children.push(new Paragraph({
        text: detail,
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }));
    });

    children.push(new Paragraph({ text: "", spacing: { after: 400 }, pageBreakBefore: true }));
  }

  let sceneNumber = 0;
  project.lines.forEach((line) => {
    const text = formatLineText(line.text, line.type);
    if (!text && line.secondary === undefined) return;

    if (line.type === "scene") sceneNumber++;

    const paraOptions = {
      spacing: { before: 120, after: 120, line: 360 }, // 1.5 line spacing (240 is 1.0)
      children: [],
    };

    const textRunOptions = {
      text: line.type === "scene" && state.autoNumberScenes ? `${sceneNumber}. ${text}` : text,
      font: "Times New Roman",
      size: 24, // 12pt
    };

    switch (line.type) {
      case "scene":
        textRunOptions.allCaps = true;
        textRunOptions.bold = true;
        break;
      case "character":
      case "dual":
        textRunOptions.allCaps = true;
        textRunOptions.bold = true;
        paraOptions.indent = { left: 3600 }; // 2.5in from margin (3.5in from edge)
        break;
      case "dialogue":
        paraOptions.indent = { left: 2160, right: 2160 }; // ~1.5in indents (~3in width)
        break;
      case "parenthetical":
        textRunOptions.italics = true;
        paraOptions.indent = { left: 2880, right: 2880 }; // ~2in indents (~2in width)
        break;
      case "transition":
        textRunOptions.allCaps = true;
        textRunOptions.bold = true;
        paraOptions.alignment = AlignmentType.RIGHT;
        break;
      case "text":
        paraOptions.alignment = AlignmentType.BOTH;
        break;
      case "note":
        textRunOptions.color = "666666";
        textRunOptions.italics = true;
        break;
    }

    paraOptions.children.push(new TextRun(textRunOptions));

    if (line.secondary !== undefined) {
      paraOptions.children.push(new TextRun({ text: "  |  ", color: "999999" }));
      paraOptions.children.push(new TextRun({
        ...textRunOptions,
        text: formatLineText(line.secondary, line.type)
      }));
    }

    children.push(new Paragraph(paraOptions));
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun("Page "),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            }),
          ],
        }),
      },
      children: children,
    }],
  });

  return await Packer.toBlob(doc);
}

export async function exportPdfProfessional(project) {
  if (typeof html2pdf === 'undefined') {
    throw new Error('html2pdf library not loaded');
  }

  const previewData = buildPreviewData(project);
  const element = document.createElement("div");
  element.className = "pdf-export-content";

  const style = document.createElement("style");
  style.textContent = `
    .pdf-export-content {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
      background: #fff;
    }
    .pdf-page {
      position: relative;
      width: 6.27in; /* A4 width 8.27 - 2in (1in each side) */
      min-height: 9.69in; /* A4 height 11.69 - 2in (1in each side) */
      padding: 0;
      margin: 0;
      page-break-after: always;
      display: flex;
      flex-direction: column;
    }
    .pdf-cover-page {
      height: 9.69in;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .pdf-title { font-size: 24pt; font-weight: bold; margin-bottom: 20pt; text-transform: uppercase; }
    .pdf-author { font-size: 14pt; font-style: italic; margin-bottom: 40pt; }
    .pdf-details { font-size: 12pt; margin-bottom: 10pt; }

    .pdf-body { flex: 1; }
    .pdf-line {
      margin: 0 0 10pt 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .pdf-line.scene { font-weight: bold; text-transform: uppercase; }
    .pdf-line.character, .pdf-line.dual { font-weight: bold; text-transform: uppercase; margin-left: 2.5in; }
    .pdf-line.dialogue { margin-left: 1.5in; margin-right: 1.5in; }
    .pdf-line.parenthetical { font-style: italic; margin-left: 2.0in; margin-right: 2.0in; }
    .pdf-line.transition { font-weight: bold; text-transform: uppercase; text-align: right; }
    .pdf-line.text { text-align: justify; }
    .pdf-line.note { color: #666; font-style: italic; border-left: 3px solid #ccc; padding-left: 10px; }

    .pdf-dual-row { display: flex; gap: 0.5in; }
    .pdf-dual-col { flex: 1; }

    .pdf-footer {
      height: 0.5in;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      font-size: 10pt;
      color: #333;
    }
  `;
  element.appendChild(style);

  // Cover Page
  const coverPage = document.createElement("div");
  coverPage.className = "pdf-page";
  const coverInner = document.createElement("div");
  coverInner.className = "pdf-cover-page";
  coverInner.innerHTML = `
    <div class="pdf-title">${escapeHtml(project.title || "Untitled Document")}</div>
    ${project.author ? `<div class="pdf-author">by ${escapeHtml(project.author)}</div>` : ''}
    ${[project.company, project.contact, project.details].filter(Boolean).map(d => `<div class="pdf-details">${escapeHtml(d)}</div>`).join('')}
  `;
  coverPage.appendChild(coverInner);
  element.appendChild(coverPage);

  // Script Pages
  previewData.scriptPages.forEach((pageLines, index) => {
    const page = document.createElement("div");
    page.className = "pdf-page";

    const body = document.createElement("div");
    body.className = "pdf-body";

    pageLines.forEach(line => {
      const div = document.createElement("div");
      div.className = `pdf-line ${line.type}`;

      if (line.secondary !== undefined) {
        div.className += " pdf-dual-row";
        div.innerHTML = `
          <div class="pdf-dual-col">${escapeHtml(line.displayText)}</div>
          <div class="pdf-dual-col">${escapeHtml(line.secondary)}</div>
        `;
      } else {
        div.textContent = line.displayText;
      }
      body.appendChild(div);
    });

    page.appendChild(body);

    if (state.viewOptions.pageNumbers) {
      const footer = document.createElement("div");
      footer.className = "pdf-footer";
      footer.textContent = buildPageNumberLabel(index + 1, previewData.scriptPages.length);
      page.appendChild(footer);
    }

    element.appendChild(page);
  });

  const opt = {
    margin: 1,
    filename: getExportFilename(project.title, "pdf"),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
  };

  return html2pdf().set(opt).from(element).save();
}

function buildWordDualColStyle(type) {
  const base = "margin:0;padding:0 4pt;white-space:pre-wrap;line-height:1.2;vertical-align:top;width:50%;";
  switch (type) {
    case "character":
    case "dual":
      return `${base}font-weight:bold;padding-left:0.5in;`;
    case "parenthetical":
      return `${base}padding-left:0.3in;`;
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
      return `${base.join(";")};font-weight:bold;`;
    case "transition":
      return `${base.join(";")};font-weight:bold;margin-left:3.7in;text-align:right;`;
    case "character":
    case "dual":
      return `${base.join(";")};font-weight:bold;margin-left:2.2in;`;
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
    .cover-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding-left: 1.0in; /* Center for cover */
      page-break-after: always !important;
      break-after: page !important;
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
      margin: 0 0 12pt;
      white-space: pre-wrap;
      line-height: 1.2;
    }
    .print-line.scene,
    .print-line.shot,
    .print-line.transition {
      font-weight: bold;
    }
    .print-line.character,
    .print-line.dual {
      margin-left: 2.2in;
      width: 2.4in;
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
    .print-dual-row {
      display: table;
      width: 100%;
      margin: 0 0 12pt;
      table-layout: fixed;
    }
    .print-dual-col {
      display: table-cell;
      width: 50%;
      white-space: pre-wrap;
      line-height: 1.2;
      vertical-align: top;
      padding: 0 6pt;
    }
    .print-dual-row.character .print-dual-col,
    .print-dual-row.dual .print-dual-col {
      font-weight: bold;
      padding-left: 0.5in;
    }
    .print-dual-row.parenthetical .print-dual-col {
      padding-left: 0.3in;
    }
    .print-footer {
      position: absolute;
      right: 1.0in;
      bottom: 0.5in;
      font-family: "Courier New", Courier, monospace;
      font-size: 10pt;
      color: #444;
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
