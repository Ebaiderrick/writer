import { paginateScriptLines } from './pagination.js';

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

let jsPdfLoaderPromise = null;

function loadJsPdfRuntime() {
  if (window.jspdf?.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (jsPdfLoaderPromise) {
    return jsPdfLoaderPromise;
  }
  jsPdfLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-jspdf-runtime="true"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.jspdf?.jsPDF), { once: true });
      existing.addEventListener('error', () => reject(new Error('The PDF engine could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = JSPDF_CDN;
    script.async = true;
    script.dataset.jspdfRuntime = 'true';
    script.addEventListener('load', () => {
      if (window.jspdf?.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
      reject(new Error('The PDF engine loaded but could not be started.'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('The PDF engine could not be loaded.')), { once: true });
    document.head.appendChild(script);
  });
  return jsPdfLoaderPromise;
}

function pointsFromCm(cm) {
  return (Number(cm) || 0) * 28.3464567;
}

function pointsFromInches(inches) {
  return (Number(inches) || 0) * 72;
}

function getLineLayout(line = {}) {
  switch (line.type) {
    case 'scene':
      return { x: pointsFromInches(1.18), width: pointsFromInches(6.0), style: 'bold', align: 'left', spacingAfter: 3 };
    case 'character':
    case 'dual':
      return { x: pointsFromInches(3.55), width: pointsFromInches(2.2), style: 'bold', align: 'left', spacingAfter: 1.5 };
    case 'parenthetical':
      return { x: pointsFromInches(3.1), width: pointsFromInches(2.0), style: 'normal', align: 'left', spacingAfter: 1.2 };
    case 'dialogue':
      return { x: pointsFromInches(2.55), width: pointsFromInches(3.2), style: 'normal', align: 'left', spacingAfter: 1.8 };
    case 'transition':
      return { x: pointsFromInches(1.18), width: pointsFromInches(6.0), style: 'bold', align: 'right', spacingAfter: 2.4 };
    case 'shot':
      return { x: pointsFromInches(1.18), width: pointsFromInches(6.0), style: 'bold', align: 'left', spacingAfter: 2.4 };
    case 'note':
      return { x: pointsFromInches(1.18), width: pointsFromInches(6.0), style: 'italic', align: 'left', spacingAfter: 2.2 };
    default:
      return { x: pointsFromInches(1.18), width: pointsFromInches(6.0), style: 'normal', align: 'left', spacingAfter: 2.2 };
  }
}

function drawWrappedText(doc, text, x, y, width, { align = 'left', fontStyle = 'normal', fontSize = 12, lineHeight = 13.4 } = {}) {
  const value = String(text || '').trim();
  if (!value) return y;
  doc.setFont('courier', fontStyle);
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(value, width);
  lines.forEach((segment, index) => {
    const lineY = y + (index * lineHeight);
    if (align === 'right') {
      doc.text(segment, x + width, lineY, { align: 'right', baseline: 'top' });
    } else if (align === 'center') {
      doc.text(segment, x + (width / 2), lineY, { align: 'center', baseline: 'top' });
    } else {
      doc.text(segment, x, lineY, { align: 'left', baseline: 'top' });
    }
  });
  return y + (lines.length * lineHeight);
}

function drawCoverPage(doc, exportDocument) {
  const { metadata = {} } = exportDocument || {};
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;
  const midY = pageHeight / 2;
  const title = String(metadata.title || 'Untitled Script').trim();
  const author = String(metadata.author || 'Author').trim();
  const infoLines = [
    metadata.contact,
    metadata.company,
    metadata.details,
    metadata.draftDate ? `Draft Date: ${metadata.draftDate}` : '',
    metadata.version ? `Version: ${metadata.version}` : ''
  ].filter(Boolean);

  doc.setFont('courier', 'bold');
  doc.setFontSize(20);
  doc.text(title, centerX, midY - 58, { align: 'center', baseline: 'middle' });

  if (metadata.subtitle) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(12);
    doc.text(String(metadata.subtitle), centerX, midY - 38, { align: 'center', baseline: 'middle' });
  }

  doc.setFont('courier', 'normal');
  doc.setFontSize(12);
  doc.text('Written By', centerX, midY - 4, { align: 'center', baseline: 'middle' });

  doc.setFont('courier', 'bold');
  doc.text(author, centerX, midY + 18, { align: 'center', baseline: 'middle' });

  if (infoLines.length) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(11);
    infoLines.forEach((line, index) => {
      doc.text(String(line), centerX, midY + 70 + (index * 14), { align: 'center', baseline: 'middle' });
    });
  }
}

function drawScriptPage(doc, pageLines, exportDocument, pageNumber) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const topMargin = pointsFromCm(2.0);
  const bottomMargin = pageHeight - pointsFromCm(2.0);
  const baseLineHeight = 13.4;
  let y = topMargin;

  if (exportDocument?.options?.includePageNumbers !== false) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(11);
    doc.text(String(pageNumber), pageWidth - pointsFromInches(0.8), pageHeight - pointsFromCm(1.5) + 2, { align: 'right', baseline: 'bottom' });
  }

  for (const line of pageLines) {
    const layout = getLineLayout(line);
    if (line.type === 'scene' && y > topMargin + 2) {
      y += 7.2;
    }
    if (line.secondary) {
      const leftX = pointsFromInches(1.65);
      const rightX = pointsFromInches(4.45);
      const colWidth = pointsFromInches(2.1);
      const leftEndY = drawWrappedText(doc, line.displayText, leftX, y, colWidth, {
        fontStyle: layout.style,
        fontSize: 12,
        lineHeight: baseLineHeight
      });
      const rightEndY = drawWrappedText(doc, line.secondary, rightX, y, colWidth, {
        fontStyle: layout.style,
        fontSize: 12,
        lineHeight: baseLineHeight
      });
      y = Math.max(leftEndY, rightEndY) + 3;
    } else {
      y = drawWrappedText(doc, line.displayText, layout.x, y, layout.width, {
        align: layout.align,
        fontStyle: layout.style,
        fontSize: 12,
        lineHeight: baseLineHeight
      });
      y += layout.spacingAfter;
    }
    if (y > bottomMargin) {
      y = bottomMargin;
      break;
    }
  }
}

export async function buildPdfBlobFromExportDocument(exportDocument) {
  const jsPDF = await loadJsPdfRuntime();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true
  });

  const pages = paginateScriptLines((exportDocument?.lines || []).map((line) => ({
    ...line,
    secondary: line.secondary || undefined
  })));

  const includeTitlePage = exportDocument?.options?.includeTitlePage !== false;

  if (includeTitlePage) {
    drawCoverPage(doc, exportDocument);
  }

  pages.forEach((pageLines, index) => {
    if (index > 0 || includeTitlePage) {
      doc.addPage('letter', 'portrait');
    }
    drawScriptPage(doc, pageLines, exportDocument, index + 1);
  });

  return doc.output('blob');
}
