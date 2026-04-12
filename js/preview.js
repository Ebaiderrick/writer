import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, syncProjectFromInputs } from './project.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml, normalizeLineText } from './utils.js';

export function renderCoverPreview() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;

  const meta = {
    title: project.title,
    author: project.author,
    email: project.contact, // Mapping existing contact to email/phone for the template
    phone: project.company
  };

  const html = `
    <section class="cover-page page">
      <h1 class="title">${escapeHtml(meta.title || "UNTITLED")}</h1>
      <p class="written-by">Written by</p>
      <p class="author">${escapeHtml(meta.author || "")}</p>

      <div class="contact">
        <p>${escapeHtml(meta.email || "")}</p>
        <p>${escapeHtml(meta.phone || "")}</p>
      </div>
    </section>
  `;
  refs.coverPreview.innerHTML = html;
}

export function renderPreview() {
  const project = getCurrentProject();
  if (!project) return;

  const meta = {
    title: project.title,
    author: project.author,
    email: project.contact,
    phone: project.company
  };

  refs.preview.innerHTML = renderScreenplay(project.lines, meta);
}

export function renderScreenplay(lines, meta) {
  let html = "";

  // COVER PAGE
  html += `
    <section class="cover-page page">
      <h1 class="title">${escapeHtml(meta.title || "UNTITLED")}</h1>
      <p class="written-by">Written by</p>
      <p class="author">${escapeHtml(meta.author || "")}</p>

      <div class="contact">
        <p>${escapeHtml(meta.email || "")}</p>
        <p>${escapeHtml(meta.phone || "")}</p>
      </div>
    </section>
  `;

  // Use pagination to create separate pages for the script
  const paginated = paginateScriptLines(lines.map(line => ({
      ...line,
      displayText: normalizeLineText(line.text, line.type)
  })));

  paginated.forEach((pageLines) => {
      html += `<section class="script page">`;
      pageLines.forEach(line => {
          if (!line.displayText.trim()) return;
          // Map internal type 'scene' to 'scene-heading' for the Master CSS
          const className = line.type === 'scene' ? 'scene-heading' : line.type;
          html += `<p class="${className}">${escapeHtml(line.displayText)}</p>`;
      });
      html += `</section>`;
  });

  return html;
}

export function exportScript(lines, meta) {
  const content = renderScreenplay(lines, meta);
  const win = window.open("", "_blank");

  // We'll inject the Master CSS directly
  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(meta.title || "Screenplay")}</title>
        <style>
          body {
            font-family: "Courier New", Courier, monospace;
            font-size: 12pt;
            line-height: 1;
            background: #fff;
            color: #000;
            margin: 0;
            padding: 0;
          }

          /* PAGE SETUP */
          .page {
            width: 8.5in;
            min-height: 11in;
            margin: 20px auto;
            padding: 1in 1in 1in 1.5in;
            box-sizing: border-box;
            background: white;
            page-break-after: always;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }

          @media print {
            .page {
                margin: 0;
                box-shadow: none;
            }
            body {
                background: white;
            }
          }

          /* COVER PAGE */
          .cover-page {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            position: relative;
          }

          .cover-page .title {
            font-size: 24pt;
            font-weight: bold;
            text-align: center;
            margin-bottom: 24px;
            text-transform: uppercase;
          }

          .cover-page .written-by {
            margin-bottom: 12px;
          }

          .cover-page .author {
            margin-bottom: 40px;
          }

          .cover-page .contact {
            position: absolute;
            bottom: 1in;
            left: 1.5in;
            text-align: left;
          }

          /* SCENE */
          .scene-heading {
            font-weight: bold;
            text-transform: uppercase;
            margin-top: 24px;
            margin-bottom: 12px;
          }

          /* ACTION */
          .action {
            margin-bottom: 12px;
          }

          /* CHARACTER */
          .character {
            font-weight: bold;
            text-transform: uppercase;
            margin-left: 2.2in; /* 3.7in from left edge - 1.5in padding */
          }

          /* PARENTHETICAL */
          .parenthetical {
            margin-left: 1.7in; /* 3.2in from left edge - 1.5in padding */
            max-width: 2.5in;
            font-style: italic;
          }

          /* DIALOGUE */
          .dialogue {
            margin-left: 1in; /* 2.5in from left edge - 1.5in padding */
            max-width: 3.5in;
            margin-bottom: 12px;
          }

          /* TRANSITION */
          .transition {
            font-weight: bold;
            text-align: right;
            margin-top: 12px;
          }
        </style>
      </head>
      <body data-theme="${escapeHtml(state.theme)}">
        <div id="screenplay">
          ${content}
        </div>
        <script>
            // Auto-print if needed could be added here
        </script>
      </body>
    </html>
  `);

  win.document.close();
  win.focus();
}

export function buildPrintableDocument(project, autoPrint = false) {
    // This function is still used by exportWord/exportPdf in events.js
    // We'll make it use renderScreenplay
    const meta = {
        title: project.title,
        author: project.author,
        email: project.contact,
        phone: project.company
    };
    const content = renderScreenplay(project.lines, meta);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(project.title)}</title>
  <style>
          body {
            font-family: "Courier New", Courier, monospace;
            font-size: 12pt;
            line-height: 1;
            background: #fff;
            color: #000;
            margin: 0;
            padding: 0;
          }

          /* PAGE SETUP */
          .page {
            width: 8.5in;
            min-height: 11in;
            margin: 0 auto;
            padding: 1in 1in 1in 1.5in;
            box-sizing: border-box;
            background: white;
            page-break-after: always;
          }

          /* COVER PAGE */
          .cover-page {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            position: relative;
          }

          .cover-page .title {
            font-size: 24pt;
            font-weight: bold;
            text-align: center;
            margin-bottom: 24px;
            text-transform: uppercase;
          }

          .cover-page .written-by {
            margin-bottom: 12px;
          }

          .cover-page .author {
            margin-bottom: 40px;
          }

          .cover-page .contact {
            position: absolute;
            bottom: 1in;
            left: 1.5in;
            text-align: left;
          }

          /* SCENE */
          .scene-heading {
            font-weight: bold;
            text-transform: uppercase;
            margin-top: 24px;
            margin-bottom: 12px;
          }

          /* ACTION */
          .action {
            margin-bottom: 12px;
          }

          /* CHARACTER */
          .character {
            font-weight: bold;
            text-transform: uppercase;
            margin-left: 2.2in;
          }

          /* PARENTHETICAL */
          .parenthetical {
            margin-left: 1.7in;
            max-width: 2.5in;
            font-style: italic;
          }

          /* DIALOGUE */
          .dialogue {
            margin-left: 1in;
            max-width: 3.5in;
            margin-bottom: 12px;
          }

          /* TRANSITION */
          .transition {
            font-weight: bold;
            text-align: right;
            margin-top: 12px;
          }
  </style>
</head>
<body data-theme="${escapeHtml(state.theme)}">
  <div id="screenplay">
    ${content}
  </div>
  ${autoPrint ? "<script>window.addEventListener('load', function () { window.print(); });<\/script>" : ""}
</body>
</html>`;
}
