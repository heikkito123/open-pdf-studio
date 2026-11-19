// Exercise the real Tool Sets menu, measurement creation and CSV grouping.
// OPDS_TEST_PDF optionally supplies a local drawing; the default is generated.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { leesPdfViewports, viewportOp } from '../js/pdf/pdf-viewports.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.OPDS_TEST_PDF ? path.resolve(process.env.OPDS_TEST_PDF) : null;
process.chdir(root);
process.env.OPDS_WEB_BUILD = '1';
const pdf = source ? await PDFDocument.load(await readFile(source)) : await PDFDocument.create();
if (!source) {
  const page = pdf.addPage([2381, 1684]);
  page.node.set(PDFName.of('VP'), pdf.context.obj([{ Type: 'Viewport', BBox: [64, 286, 1986, 1580],
    Measure: { Type: 'Measure', Subtype: 'RL', X: [{ C: 12.55464, U: PDFString.of(' ') }] } }]));
}
const bytes = Array.from(await pdf.save());
const pdfViewports = leesPdfViewports(pdf);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-takeoff-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18349, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.OPDS_CHROMIUM ? { executablePath: process.env.OPDS_CHROMIUM } : {}) });
  const page = await browser.newPage({ viewport: { width: 1433, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async ({ bytes, pdfViewports }) => {
    const { createBlankPDF } = await import('/js/pdf/loader.js');
    await createBlankPDF(2381, 1684, 1, bytes);
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    doc.pdfViewports = pdfViewports;
    doc.annotations = [];
    const { setScaleFromLine } = await import('/js/annotations/measurement.js');
    setScaleFromLine(100, 1000, 'mm');
    const tools = await import('/js/solid/stores/toolSetsStore.js');
    await tools.createToolSet('Takeoff regression');
    for (const subject of ['Walls', 'Pipes']) {
      await tools.saveAnnotationToToolSet({ type: 'measureDistance', page: 1, subject,
        measureUnit: 'mm', strokeColor: '#1565C0', lineWidth: 1 });
    }
    const { zetLabelVooraf } = await import('/js/annotations/label-vooraf.js');
    zetLabelVooraf('measureDistance', 'subject', 'General subject');
    zetLabelVooraf('measureDistance', 'measureName', 'General name');
    window.testProps = await import('/js/solid/stores/propertiesStore.js');
    window.testDocument = doc;
  }, { bytes, pdfViewports });

  const embeddedValue = 100 / viewportOp(pdfViewports[1], 1050, 500).pixelsPerUnit;
  const currentValue = () => page.evaluate(async () => {
    const { calculateDistance } = await import('/js/annotations/measurement.js');
    return calculateDistance(1000, 500, 1100, 500, 1).value;
  });
  assert.ok(Math.abs(await currentValue() - embeddedValue) < 1e-8, 'quick calibration does not bypass PDF scales by default');
  const dialog = page.locator('.calibration-dialog');
  const checkbox = dialog.getByRole('checkbox', { name: 'Use embedded PDF scale (forced scale)', exact: true });
  async function openCalibration() {
    await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('calibration', {}));
    await dialog.waitFor();
  }
  // Open through the real top-bar Calibrate button first.
  await page.evaluate(async () => (await import('/js/solid/stores/ribbonStore.js')).switchToTab('comment'));
  await page.locator('#tool-measure-calibrate').click();
  await dialog.waitFor();
  assert.equal(await checkbox.isChecked(), true);
  await dialog.getByRole('button', { name: 'Scale Ratio', exact: true }).click();
  assert.equal(await checkbox.isChecked(), true, 'the choice is visible on both calibration tabs');
  await checkbox.uncheck();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(Math.abs(await currentValue() - embeddedValue) < 1e-8, 'Cancel leaves the document unchanged');

  await openCalibration();
  await checkbox.uncheck();
  await dialog.locator('.calibration-input').nth(0).fill('100');
  await dialog.locator('.calibration-input').nth(1).fill('1000');
  await dialog.getByRole('button', { name: 'Draw line on drawing', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { scaleMeasureTool } = await import('/js/tools/tools/scale-measure-tool.js');
    const { state } = await import('/js/core/state.ts');
    const ctx = { state, pageNum: 1, scale: 1, x: 1000, y: 500,
      snap: () => ({ snapped: false }), redraw() {} };
    scaleMeasureTool.onPointerDown(ctx, { button: 0 });
    scaleMeasureTool.onPointerDown({ ...ctx, x: 1100 }, { button: 0 });
  });
  await dialog.waitFor();
  assert.equal(await checkbox.isChecked(), false, 'drawing the reference line retains the pending choice');
  await dialog.locator('.pref-btn-primary').click();
  assert.equal(await currentValue(), 1000);
  await openCalibration();
  assert.equal(await checkbox.isChecked(), false, 'the dialog remembers the document choice');
  await checkbox.check();
  await dialog.locator('.pref-btn-primary').click();
  assert.ok(Math.abs(await currentValue() - embeddedValue) < 1e-8, 'checking again restores PDF scales');
  assert.equal(await page.evaluate(() => window.testDocument.measureScale.pixelsPerUnit), 0.1,
    'toggling the choice preserves the reference calibration');
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  assert.equal(await currentValue(), 1000);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).redo());
  assert.ok(Math.abs(await currentValue() - embeddedValue) < 1e-8);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());

  for (const subject of ['Walls', 'Pipes', 'Walls']) {
    await page.locator('#tool-sets-panel .toolset-item').filter({ hasText: subject }).click();
    await page.waitForFunction(subject => window.testProps.annotProps.subject === subject
      && window.testProps.getCurrentAnnotation()?.id === '__tool-defaults__', subject);
    assert.equal(await page.evaluate(() => window.testProps.annotProps.measureName), '');
    const result = await page.evaluate(async () => {
      const { createAnnotationFromTool } = await import('/js/tools/annotation-creators.js');
      const { recordAdd } = await import('/js/core/undo-manager.js');
      const { getActiveDocument } = await import('/js/core/state.ts');
      const ann = createAnnotationFromTool('measureDistance', 1000, 500, 1100, 500);
      getActiveDocument().annotations.push(ann);
      recordAdd(ann);
      return { subject: ann.subject, name: ann.measureName, value: ann.measureValue, unit: ann.measureUnit };
    });
    assert.deepEqual(result, { subject, name: '', value: 1000, unit: 'mm' });
  }

  const report = await page.evaluate(async () => {
    const quantities = await import('/js/solid/stores/quantitiesStore.js');
    const { scheduleResultToCsv } = await import('/js/quantities/schedule-csv.js');
    quantities.setSelectedCategories(['line-based']);
    quantities.setScheduledFields(['label', 'length']);
    quantities.setSortLevels([{ field: 'label', dir: 'asc', group: true }]);
    quantities.setScheduleVisible(true);
    const result = quantities.scheduleResult();
    return { groups: result.groups.map(g => ({ label: g.key, count: g.rows.length })), csv: scheduleResultToCsv(result) };
  });
  assert.deepEqual(report.groups, [{ label: 'Pipes', count: 1 }, { label: 'Walls', count: 2 }]);
  assert.doesNotMatch(report.csv, /General name|General subject/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.replace(/^\uFEFF/, ''), report.csv);
  await openCalibration();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testDocument.measureScale), null);
  assert.ok(Math.abs(await currentValue() - embeddedValue) < 1e-8, 'Reset restores PDF scales');
  await openCalibration();
  assert.equal(await checkbox.isChecked(), true, 'Reset also restores the default checkbox');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ embeddedViewports: pdfViewports[1]?.length || 0, toolMenuSwitches: 3,
    embeddedScaleDefault: true, calibrationOptOut: true, referenceLineRestoresChoice: true,
    cancelResetUndoRedo: true, csvDownload: true, groups: report.groups, browserErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
