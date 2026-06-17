import { state } from './config.js';
import { paginateScriptLines } from './pagination.js';
import { escapeHtml } from './utils.js';
import { t } from './i18n.js';

export function buildPreviewDataFromExportDocument(exportDocument) {
  return {
    scriptPages: paginateScriptLines((exportDocument?.lines || []).map((line) => ({
      ...line,
      secondary: line.secondary || undefined
    })))
  };
}

function buildExportPageNumberLabel(pageNumber) {
  return String(pageNumber);
}

function buildProductionSummaryBits(exportDocument) {
  const summary = exportDocument?.productionSummary || {};
  const selection = exportDocument?.selection || {};
  const bits = [];
  if (Number.isFinite(Number(summary.sceneCount))) {
    bits.push(`${Number(summary.sceneCount)} scene${Number(summary.sceneCount) === 1 ? '' : 's'}`);
  }
  if (summary.locations?.length) {
    bits.push(`Locations: ${summary.locations.join(', ')}`);
  } else if (selection.locations?.length) {
    bits.push(`Locations: ${selection.locations.join(', ')}`);
  }
  if (summary.timeOfDay?.length) {
    bits.push(`Time: ${summary.timeOfDay.join(', ')}`);
  } else if (selection.timeOfDay?.length) {
    bits.push(`Time: ${selection.timeOfDay.join(', ')}`);
  }
  if (summary.characters?.length) {
    bits.push(`Characters: ${summary.characters.join(', ')}`);
  } else if (selection.characters?.length) {
    bits.push(`Characters: ${selection.characters.join(', ')}`);
  }
  if (selection.sceneRange?.start && selection.sceneRange?.end) {
    bits.push(`Range: ${selection.sceneRange.start}-${selection.sceneRange.end}`);
  }
  return bits;
}

function buildShootingSummaryBits(exportDocument) {
  const summary = exportDocument?.shootingSummary || {};
  const bits = [];
  if (Number.isFinite(Number(summary.sceneCount))) {
    bits.push(`${Number(summary.sceneCount)} locked scene${Number(summary.sceneCount) === 1 ? '' : 's'}`);
  }
  if (summary.revisionDate) {
    bits.push(`Revision date: ${summary.revisionDate}`);
  }
  if (summary.includesRevisions) {
    bits.push('Revision marks on');
  }
  if (summary.includesNotes) {
    bits.push('Notes included');
  }
  if (summary.includesComments) {
    bits.push('Comments included');
  }
  if (summary.includesPageNumbers) {
    bits.push('Page numbers on');
  }
  return bits;
}

function buildWatermarkSummaryBits(exportDocument) {
  const summary = exportDocument?.watermarkSummary || {};
  const bits = [];
  if (summary.text) {
    bits.push(summary.text);
  }
  if (summary.position) {
    bits.push(`Position: ${summary.position}`);
  }
  if (Number.isFinite(Number(summary.opacity))) {
    bits.push(`Opacity: ${Math.round(Number(summary.opacity) * 100)}%`);
  }
  return bits;
}

function buildPrintablePageHeader(exportDocument, pageNumber) {
  const hasWatermark = Boolean(exportDocument?.watermarkSummary?.text);
  const screenplayMode = String(exportDocument?.screenplayMode || exportDocument?.options?.exportMode || 'spec');
  const metadata = exportDocument?.metadata || {};
  const isShootingScript = exportDocument?.exportType === 'shooting';
  const isWatermarkedScript = exportDocument?.exportType === 'watermarked' || hasWatermark;
  const shouldRenderHeader = ['production', 'shooting', 'watermarked'].includes(exportDocument?.exportType)
    || hasWatermark
    || screenplayMode === 'production'
    || screenplayMode === 'character';
  if (!shouldRenderHeader) {
    return '';
  }
  const summaryBits = isShootingScript
    ? buildShootingSummaryBits(exportDocument)
    : isWatermarkedScript
      ? buildWatermarkSummaryBits(exportDocument)
      : buildProductionSummaryBits(exportDocument);
  if (!isShootingScript && !isWatermarkedScript && Number.isFinite(Number(exportDocument?.estimatedRuntimeMinutes))) {
    summaryBits.push(`Runtime est: ${Number(exportDocument.estimatedRuntimeMinutes)} min`);
  }
  const summaryMarkup = summaryBits.length
    ? `<p class="print-page-header-meta">${escapeHtml(summaryBits.join(' · '))}</p>`
    : '';
  const headerLabel = isShootingScript
    ? 'Production Script'
    : isWatermarkedScript
      ? 'Watermarked Script'
      : screenplayMode === 'production'
        ? 'Production Script'
        : screenplayMode === 'character'
          ? 'Character Script'
          : 'Spec Script';
  return `
    <div class="print-page-header" role="presentation">
      <div>
        <p class="print-page-header-label">${headerLabel}</p>
        <h2 class="print-page-header-title">${escapeHtml(metadata.title || 'Untitled Script')}</h2>
        ${summaryMarkup}
      </div>
      ${(isShootingScript && exportDocument?.options?.includePageNumbers === false) ? '' : `<span class="print-page-header-page">Page ${escapeHtml(buildExportPageNumberLabel(pageNumber))}</span>`}
    </div>
  `;
}

export function buildPrintableDocumentFromExportDocument(exportDocument, autoPrint = false) {
  const previewData = buildPreviewDataFromExportDocument(exportDocument);
  const metadata = exportDocument?.metadata || {};
  const isProductionExport = exportDocument?.exportType === 'production';
  const isShootingScript = exportDocument?.exportType === 'shooting';
  const isWatermarkedScript = exportDocument?.exportType === 'watermarked' || Boolean(exportDocument?.watermarkSummary?.text);
  const screenplayMode = String(exportDocument?.screenplayMode || exportDocument?.options?.exportMode || 'spec');
  const productionSummaryBits = buildProductionSummaryBits(exportDocument);
  const shootingSummaryBits = buildShootingSummaryBits(exportDocument);
  const watermarkSummaryBits = buildWatermarkSummaryBits(exportDocument);
  const runtimeEstimate = Number.isFinite(Number(exportDocument?.estimatedRuntimeMinutes))
    ? `${Number(exportDocument.estimatedRuntimeMinutes)} minute${Number(exportDocument.estimatedRuntimeMinutes) === 1 ? '' : 's'}`
    : '';
  const watermarkText = escapeHtml(String(exportDocument?.options?.watermarkText || '').trim());
  const watermarkPosition = String(exportDocument?.options?.watermarkPosition || 'diagonal').trim().toLowerCase();
  const watermarkOpacity = Number.isFinite(Number(exportDocument?.options?.watermarkOpacity))
    ? Math.min(0.3, Math.max(0.04, Number(exportDocument.options.watermarkOpacity)))
    : 0.12;
  const watermarkMarkup = isWatermarkedScript && watermarkText
    ? `<div class="print-watermark print-watermark-${escapeHtml(watermarkPosition)}" aria-hidden="true">${watermarkText}</div>`
    : '';
  const coverMarkup = exportDocument?.options?.includeTitlePage === false ? '' : `
    <section class="print-page cover-page${isProductionExport || isShootingScript || isWatermarkedScript ? ' production-cover-page' : ''}${isWatermarkedScript ? ' watermarked-page' : ''}"${isWatermarkedScript ? ` style="--print-watermark-opacity:${watermarkOpacity};"` : ''}>
      ${watermarkMarkup}
      <div class="print-cover-stack">
        ${isProductionExport
          ? `<p class="print-cover-kicker">Production Export</p>`
          : isShootingScript
            ? `<p class="print-cover-kicker">Production Script</p>`
            : isWatermarkedScript
              ? `<p class="print-cover-kicker">Watermarked Script</p>`
              : screenplayMode === 'production'
                ? `<p class="print-cover-kicker">Production Script</p>`
                : screenplayMode === 'character'
                  ? `<p class="print-cover-kicker">Character Script</p>`
                  : ''}
        <p class="print-cover-title">${escapeHtml(metadata.title || 'Untitled Script')}</p>
        ${metadata.subtitle ? `<p class="print-cover-subtitle">${escapeHtml(metadata.subtitle)}</p>` : ''}
        <p class="print-cover-byline">Written By</p>
        <p class="print-cover-author">${escapeHtml(metadata.author || t('cover.authorFallback'))}</p>
        ${metadata.coWriters ? `<p class="print-cover-coauthors">${escapeHtml(metadata.coWriters)}</p>` : ''}
        <div class="print-cover-meta">
          ${metadata.author ? `<p>Author: ${escapeHtml(metadata.author)}</p>` : ''}
          ${metadata.contact ? `<p>Contact: ${escapeHtml(metadata.contact)}</p>` : ''}
          ${metadata.company ? `<p>${escapeHtml(metadata.company)}</p>` : ''}
          ${metadata.details ? `<p>${escapeHtml(metadata.details)}</p>` : ''}
          ${metadata.draftDate ? `<p>Draft Date: ${escapeHtml(metadata.draftDate)}</p>` : ''}
          ${metadata.version ? `<p>Version: ${escapeHtml(String(metadata.version))}</p>` : ''}
          ${runtimeEstimate ? `<p>Estimated Runtime: ${escapeHtml(runtimeEstimate)}</p>` : ''}
        </div>
        <p class="print-cover-version">${escapeHtml(screenplayMode === 'production' ? 'Production Script' : screenplayMode === 'character' ? 'Character Script' : 'Spec Script')}</p>
        ${isProductionExport && productionSummaryBits.length ? `
          <div class="print-production-summary">
            ${productionSummaryBits.map((bit) => `<p>${escapeHtml(bit)}</p>`).join('')}
          </div>
        ` : ''}
        ${isShootingScript && shootingSummaryBits.length ? `
          <div class="print-production-summary">
            ${shootingSummaryBits.map((bit) => `<p>${escapeHtml(bit)}</p>`).join('')}
          </div>
        ` : ''}
        ${isWatermarkedScript && watermarkSummaryBits.length ? `
          <div class="print-production-summary">
            ${watermarkSummaryBits.map((bit) => `<p>${escapeHtml(bit)}</p>`).join('')}
          </div>
        ` : ''}
        ${metadata.logline ? `<p class="print-cover-logline">${escapeHtml(metadata.logline)}</p>` : ''}
        ${metadata.copyrightNotice ? `<p class="print-cover-copyright">${escapeHtml(metadata.copyrightNotice)}</p>` : ''}
      </div>
    </section>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => {
    const pageNum = index + 1;
    const pageFooter = state.viewOptions.pageNumbers && !isProductionExport && !isShootingScript
      ? `<div class="print-footer">${escapeHtml(buildExportPageNumberLabel(pageNum))}</div>`
      : '';
    const pageHeader = buildPrintablePageHeader(exportDocument, pageNum);
    const firstScriptPageClass = index === 0 ? ' script-page-first' : '';
    return `
    <section class="print-page script-page${firstScriptPageClass}${isProductionExport || isShootingScript ? ' production-page' : ''}${isShootingScript ? ' shooting-page' : ''}${isWatermarkedScript ? ' watermarked-page' : ''}"${isWatermarkedScript ? ` style="--print-watermark-opacity:${watermarkOpacity};"` : ''}>
      ${watermarkMarkup}
      ${pageHeader}
      <div class="print-body">
        ${pageLines.map((line) => line.secondary !== undefined
          ? `<div class="print-line print-dual-row ${escapeHtml(line.type)}"><span class="print-dual-col">${escapeHtml(line.displayText)}</span><span class="print-dual-col">${escapeHtml(line.secondary)}</span></div>`
          : `<p class="print-line ${escapeHtml(line.type)}">${escapeHtml(line.displayText)}</p>`
        ).join('')}
      </div>
      ${pageFooter}
    </section>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(state.language)}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(metadata.title || 'Untitled Script')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
  <style>${getPrintableStyles(exportDocument?.exportType || 'full')}</style>
</head>
  <body data-theme="${escapeHtml(state.theme)}">
  <main class="print-shell">
    ${coverMarkup}
    ${scriptMarkup}
  </main>
  ${autoPrint ? "<script>window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 350); }); window.addEventListener('afterprint', function () { window.close(); });<\/script>" : ''}
</body>
</html>`;
}

function getPrintableStyles(exportType = 'full') {
  const isProductionExport = exportType === 'production';
  const isShootingScript = exportType === 'shooting';
  const isWatermarkedScript = exportType === 'watermarked';
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f1ef;
      color: #111;
      font-family: "Courier Prime", "Courier New", Courier, monospace;
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
      padding-left: 1in;
      padding-right: 1in;
      page-break-after: always !important;
      break-after: page !important;
    }
    .production-cover-page {
      justify-content: flex-start;
      padding-top: 1.35in;
    }
    .script-page-first {
      page-break-before: always !important;
      break-before: page !important;
    }
    .production-page {
      padding-top: 0.9in;
    }
    .shooting-page {
      padding-left: 1.35in;
      padding-right: 0.9in;
    }
    .watermarked-page {
      overflow: hidden;
    }
    .print-cover-stack {
      width: 100%;
      text-align: center;
    }
    .print-cover-kicker {
      margin: 0 0 22pt;
      font-size: 11pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .print-cover-title,
    .print-cover-subtitle,
    .print-cover-byline,
    .print-cover-author,
    .print-cover-coauthors,
    .print-cover-version,
    .print-cover-logline,
    .print-cover-copyright,
    .print-cover-meta p {
      margin: 0;
    }
    .print-cover-title {
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.8pt;
      margin-bottom: 32pt;
    }
    .print-cover-byline {
      font-size: 11pt;
      margin-bottom: 14pt;
    }
    .print-cover-author {
      font-weight: bold;
      margin-bottom: 10pt;
    }
    .print-cover-subtitle {
      font-size: 11pt;
      font-style: italic;
      margin-bottom: 18pt;
    }
    .print-cover-coauthors,
    .print-cover-version,
    .print-cover-copyright {
      font-size: 10.5pt;
      line-height: 1.35;
    }
    .print-cover-coauthors {
      margin-bottom: 32pt;
    }
    .print-cover-meta {
      margin-bottom: 20pt;
    }
    .print-cover-meta p {
      margin-bottom: 8pt;
    }
    .print-cover-logline {
      width: 4.8in;
      margin: 20pt auto 0;
      line-height: 1.35;
      white-space: pre-wrap;
    }
    .print-cover-copyright {
      margin-top: 18pt;
    }
    .print-production-summary {
      width: 5.2in;
      margin: 0 auto 30pt;
      padding: 12pt 16pt;
      border: 1px solid #111;
      text-align: left;
    }
    .print-production-summary p {
      margin: 0 0 6pt;
    }
    .print-production-summary p:last-child {
      margin-bottom: 0;
    }
    .print-page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16pt;
      margin-bottom: 18pt;
      padding-bottom: 10pt;
      border-bottom: 1px solid #111;
    }
    .print-page-header-label,
    .print-page-header-meta,
    .print-page-header-title,
    .print-page-header-page {
      margin: 0;
    }
    .print-page-header-label {
      font-size: 10pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .print-page-header-title {
      font-size: 12pt;
      text-transform: uppercase;
      margin-top: 4pt;
    }
    .print-page-header-meta {
      font-size: 10pt;
      line-height: 1.3;
      margin-top: 4pt;
    }
    .print-page-header-page {
      font-size: 10pt;
      white-space: nowrap;
      padding-top: 2pt;
    }
    .print-watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 44pt;
      font-weight: bold;
      letter-spacing: 0.12em;
      color: rgba(120, 20, 20, ${isWatermarkedScript ? "var(--print-watermark-opacity, 0.12)" : "0.12"});
      text-transform: uppercase;
      pointer-events: none;
      user-select: none;
      z-index: 0;
    }
    .print-watermark-diagonal {
      transform: rotate(-32deg);
    }
    .print-watermark-header {
      align-items: flex-start;
      padding-top: 0.7in;
      transform: none;
      font-size: 22pt;
    }
    .print-watermark-footer {
      align-items: flex-end;
      padding-bottom: 0.6in;
      transform: none;
      font-size: 22pt;
    }
    .print-body {
      width: 100%;
      padding-top: ${isProductionExport || isShootingScript ? '0.04in' : '0.18in'};
      padding-bottom: 0.35in;
      position: relative;
      z-index: 1;
    }
    .print-page-header,
    .print-cover-stack,
    .print-footer {
      position: relative;
      z-index: 1;
    }
    .print-line {
      margin: 0 0 10pt;
      white-space: pre-wrap;
      line-height: 1.18;
    }
    .print-line.scene,
    .print-line.shot {
      font-weight: bold;
      text-transform: uppercase;
    }
    .shooting-page .print-line.scene {
      letter-spacing: 0.01em;
    }
    .shooting-page .print-line.scene::before {
      content: '';
      display: inline-block;
      width: 0;
    }
    .print-line.character,
    .print-line.dual {
      margin-left: 3.5in;
      width: 2in;
      font-weight: bold;
      text-transform: uppercase;
    }
    .print-line.dialogue {
      margin-left: 2.5in;
      width: 3.5in;
    }
    .print-line.parenthetical {
      margin-left: 3in;
      width: 2.5in;
      font-style: italic;
    }
    .print-line.transition {
      font-weight: bold;
      margin-left: auto;
      width: 2.4in;
      text-align: right;
      text-transform: uppercase;
    }
    .print-dual-row {
      display: table;
      width: 100%;
      margin: 0 0 11pt;
      table-layout: fixed;
    }
    .print-dual-col {
      display: table-cell;
      width: 50%;
      white-space: pre-wrap;
      line-height: 1.22;
      vertical-align: top;
      padding: 0 6pt;
    }
    .print-dual-row.character .print-dual-col,
    .print-dual-row.dual .print-dual-col {
      font-weight: bold;
      padding-left: 0.95in;
      text-transform: uppercase;
    }
    .print-dual-row.dialogue .print-dual-col {
      padding-left: 0.5in;
      padding-right: 0.5in;
    }
    .print-dual-row.parenthetical .print-dual-col {
      padding-left: 0.7in;
      font-style: italic;
    }
    .print-footer {
      position: absolute;
      top: 0.45in;
      right: 1in;
      font-family: "Courier Prime", "Courier New", Courier, monospace;
      font-size: 10pt;
      color: #111;
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
