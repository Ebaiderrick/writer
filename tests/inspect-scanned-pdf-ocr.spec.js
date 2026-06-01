import { test, expect } from '@playwright/test';

test('phase 8 scanned pdf flow detects weak extraction and switches to OCR', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const conversion = await import('/js/scriptConversion.js');
    const progress = [];

    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument() {
        return {
          promise: Promise.resolve({
            numPages: 1,
            async getPage() {
              return {
                async getTextContent() {
                  return {
                    items: [
                      { str: '12', transform: [1, 0, 0, 1, 20, 700] },
                      { str: 'scan', transform: [1, 0, 0, 1, 20, 680] }
                    ]
                  };
                },
                getViewport() {
                  return { width: 400, height: 600, scale: 2 };
                },
                render() {
                  return { promise: Promise.resolve() };
                }
              };
            }
          })
        };
      }
    };

    window.Tesseract = {
      async recognize(_canvas, _lang, options = {}) {
        options.logger?.({ status: 'recognizing text', progress: 0.5 });
        return {
          data: {
            text: 'INT. KITCHEN - NIGHT\n\nMARA\nI made it through OCR.'
          }
        };
      }
    };

    const file = new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type: 'application/pdf' });
    const text = await conversion.extractScriptTextFromFile(file, {
      onProgress: (message) => progress.push(String(message || ''))
    });
    const readability = conversion.assessPdfTextExtraction(['12\nscan']);

    return { text, readability, progress };
  });

  expect(result.readability.needsOcr).toBe(true);
  expect(result.text).toContain('INT. KITCHEN - NIGHT');
  expect(result.text).toContain('I made it through OCR.');
  expect(result.progress.some((entry) => entry.includes('Running OCR on PDF page 1 of 1'))).toBe(true);
});
