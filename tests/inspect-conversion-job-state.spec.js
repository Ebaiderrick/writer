import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('convert and import keeps one job record through import completion', async ({ page }) => {
  await login(page);

  const outcome = await page.evaluate(async () => {
    const uniqueName = `state-check-${Date.now()}.docx`;
    const conversion = await import('/js/scriptConversion.js');
    const store = await import('/js/conversionJobStore.js');

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (_url, options = {}) => {
      const payload = JSON.parse(String(options.body || '{}'));
      if (payload.stage === 'normalize') {
        return new Response(JSON.stringify({
          text: 'INT. LAB - NIGHT\n\nMARA\nI made it in time.',
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (payload.stage === 'structure') {
        return new Response(JSON.stringify({
          lines: [
            { type: 'scene', text: 'INT. LAB - NIGHT' },
            { type: 'character', text: 'MARA' },
            { type: 'dialogue', text: 'I made it in time.' }
          ],
          warnings: []
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return originalFetch(_url, options);
    };

    try {
      const jobId = await conversion.beginConversionUpload({
        fileName: uniqueName,
        projectId: 'proj_state_check'
      });
      await conversion.markConversionExtractionStarted(jobId);
      await conversion.attachRawTextToConversionJob(jobId, 'INT. LAB - NIGHT\n\nMARA\nI made it in time.');

      const result = await conversion.convertScriptTextToLines('INT. LAB - NIGHT\n\nMARA\nI made it in time.', {
        fileName: uniqueName,
        jobId,
        projectId: 'proj_state_check'
      });

      await conversion.markConversionImporting(jobId, result.lines.length);
      await conversion.finalizeConversionImport(jobId, {
        usedFallback: result.usedFallback,
        warnings: result.warnings,
        lineCount: result.lines.length
      });

      const record = await store.getConversionJobRecord(jobId);
      const jobs = await store.listConversionJobRecords();
      const matchingJobs = jobs.filter((job) => job.fileName === uniqueName);

      return {
        jobId,
        resultJobId: result.jobId,
        recordStatus: record?.status || '',
        recordStage: record?.stageLabel || '',
        recordLineCount: Number(record?.structuredLineCount || 0),
        recordStructuredLines: Array.isArray(record?.structuredLines) ? record.structuredLines.length : 0,
        matchingJobs: matchingJobs.length,
        matchingStatuses: matchingJobs.map((job) => job.status)
      };
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(outcome.resultJobId).toBe(outcome.jobId);
  expect(outcome.recordStatus).toBe('imported');
  expect(outcome.recordStage).toBe('Imported into project');
  expect(outcome.recordLineCount).toBe(3);
  expect(outcome.recordStructuredLines).toBe(3);
  expect(outcome.matchingJobs).toBe(1);
  expect(outcome.matchingStatuses).toEqual(['imported']);
});
