import { test, expect } from '@playwright/test';

test('export service builds full, character, and scene exports from structured screenplay data', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    const { ExportService } = await import('/js/exportService.js');

    const project = {
      id: 'project-export-test',
      title: 'Night Run',
      author: 'Lenon',
      genre: 'Thriller',
      version: 3,
      contact: 'lenon@example.com',
      company: 'Wraita Studio',
      details: 'Draft 3',
      logline: 'A courier discovers the package is alive.',
      comments: [
        { id: 'comment-1', sceneId: 'scene-1', author: 'Editor', text: 'Tighten the entrance beat.' }
      ],
      lines: [
        { id: 'scene-1', type: 'scene', text: 'INT. WAREHOUSE - NIGHT' },
        { id: 'line-1', type: 'action', text: 'Rain leaks through the broken roof.' },
        { id: 'line-2', type: 'character', text: 'JOHN' },
        { id: 'line-3', type: 'dialogue', text: 'I think we are late.' },
        { id: 'line-4', type: 'character', text: 'SARAH' },
        { id: 'line-5', type: 'parenthetical', text: '(calmly)' },
        { id: 'line-6', type: 'dialogue', text: 'No. We are exactly on time.' },
        { id: 'scene-2', type: 'scene', text: 'EXT. DOCKS - DAWN' },
        { id: 'line-7', type: 'action', text: 'The boat horn shakes the harbor awake.' },
        { id: 'line-8', type: 'character', text: 'JOHN' },
        { id: 'line-9', type: 'dialogue', text: 'Then let us move.' }
      ]
    };

    const fullFountain = await ExportService.exportFullScript(project, {
      format: 'fountain',
      options: {
        includeMetadata: true,
        includeSceneNumbers: true
      }
    });

    const characterFountain = await ExportService.exportCharacter(project, {
      format: 'fountain',
      characters: ['JOHN'],
      options: {
        includeSceneDescriptions: true,
        includeSurroundingAction: true,
        includeSceneNumbers: true
      }
    });

    const scenePdf = await ExportService.exportScenes(project, {
      format: 'pdf',
      sceneNumbers: [2],
      options: {
        includeSceneNumbers: true,
        includeTitlePage: false
      }
    });

    return {
      fullFilename: fullFountain.filename,
      fullContent: fullFountain.content,
      characterFilename: characterFountain.filename,
      characterContent: characterFountain.content,
      sceneFilename: scenePdf.filename,
      sceneContent: String(scenePdf.content),
      sceneTransport: scenePdf.transport
    };
  });

  expect(result.fullFilename).toBe('night-run-full-script.fountain');
  expect(result.fullContent).toContain('Title: Night Run');
  expect(result.fullContent).toContain('1. INT. WAREHOUSE - NIGHT');
  expect(result.fullContent).toContain('SARAH');

  expect(result.characterFilename).toBe('night-run-character-export.fountain');
  expect(result.characterContent).toContain('1. INT. WAREHOUSE - NIGHT');
  expect(result.characterContent).toContain('JOHN');
  expect(result.characterContent).not.toContain('SARAH');

  expect(result.sceneFilename).toBe('night-run-scene-export.html');
  expect(result.sceneTransport).toBe('print-html');
  expect(result.sceneContent).toContain('2. EXT. DOCKS - DAWN');
  expect(result.sceneContent).not.toContain('INT. WAREHOUSE - NIGHT');
});

test('export service can generate DOCX output when the docx library is available', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:4173/', { waitUntil: 'commit', timeout: 20000 });

  const result = await page.evaluate(async () => {
    class StubDocument {
      constructor(config) {
        this.config = config;
      }
    }
    class StubParagraph {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTextRun {
      constructor(config) {
        this.config = config;
      }
    }
    class StubHeader {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTable {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTableRow {
      constructor(config) {
        this.config = config;
      }
    }
    class StubTableCell {
      constructor(config) {
        this.config = config;
      }
    }

    window.docx = {
      Document: StubDocument,
      Paragraph: StubParagraph,
      TextRun: StubTextRun,
      Header: StubHeader,
      Table: StubTable,
      TableRow: StubTableRow,
      TableCell: StubTableCell,
      AlignmentType: { RIGHT: 'right', CENTER: 'center' },
      WidthType: { PERCENTAGE: 'pct' },
      BorderStyle: { NONE: 'none' },
      VerticalAlign: { TOP: 'top' },
      PageNumber: { CURRENT: 'current' },
      Packer: {
        async toBlob(document) {
          return new Blob([JSON.stringify({
            title: document?.config?.title || '',
            sectionCount: document?.config?.sections?.length || 0
          })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        }
      }
    };

    const { ExportService } = await import('/js/exportService.js');
    const project = {
      id: 'project-docx-test',
      title: 'Harbor Lights',
      author: 'Lenon',
      version: 2,
      lines: [
        { id: 'scene-1', type: 'scene', text: 'EXT. HARBOR - NIGHT' },
        { id: 'line-1', type: 'action', text: 'Fog drifts across the empty dock.' },
        { id: 'line-2', type: 'character', text: 'MARA' },
        { id: 'line-3', type: 'dialogue', text: 'No one followed us.' }
      ]
    };

    const docxResult = await ExportService.exportFullScript(project, {
      format: 'docx',
      options: {
        includeSceneNumbers: true,
        includeMetadata: true
      }
    });

    return {
      filename: docxResult.filename,
      mimeType: docxResult.mimeType,
      size: docxResult.content?.size || 0,
      payload: await docxResult.content.text()
    };
  });

  expect(result.filename).toBe('harbor-lights-full-script.docx');
  expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(result.size).toBeGreaterThan(0);
  expect(result.payload).toContain('"sectionCount":2');
});
