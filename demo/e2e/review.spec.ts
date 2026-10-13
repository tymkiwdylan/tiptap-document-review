import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pending-count')).toHaveText('4');
});

test('accept, reject, undo, and export a complete document', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Accept change 1', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('3');
  await expect(page.locator('#review-editor')).not.toContainText('four weeks');
  await page.getByRole('button', { name: 'Reject change 1', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('2');
  await expect(page.locator('#review-editor')).not.toContainText('$5,400');
  await expect(page.locator('#decision-summary')).toHaveText('1 accepted · 1 rejected');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('3');
  await expect(page.locator('#review-editor')).toContainText('$5,400');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('0');
  await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
  await expect(page.locator('#review-editor [data-change]')).toHaveCount(0);
  await expect(page.locator('#decision-summary')).toHaveText('4 accepted · 0 rejected');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download final JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('proposal-reviewed.json');
  const path = await download.path();
  if (!path) throw new Error('Download was not saved.');
  const downloaded = JSON.parse(await readFile(path, 'utf8'));
  expect(JSON.stringify(downloaded)).not.toMatch(/inlineChange|blockChange|lineBreakChange/);
  expect(downloaded.type).toBe('doc');
  expect(errors).toEqual([]);
});

test('reject all restores the original and reset restores the comparison', async ({ page }) => {
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await expect(page.locator('#review-editor')).toContainText('four weeks');
  await expect(page.locator('#review-editor')).not.toContainText('three weeks');
  await expect(page.locator('#review-editor')).toContainText('$4,800');
  await expect(page.locator('#review-editor [data-change]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.locator('#pending-count')).toHaveText('4');
  await expect(page.locator('#undo')).toBeDisabled();
});

test('editing a draft invalidates stale decisions and compares the new input', async ({ page }) => {
  await page.getByRole('tab', { name: 'Edit drafts' }).click();
  await page.getByRole('textbox', { name: 'Proposed document', exact: true }).fill('My custom proposal.');
  await page.getByRole('tab', { name: /Review changes/ }).click();
  await expect(page.getByRole('button', { name: 'Accept all', exact: true })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Drafts changed');
  await page.getByRole('tab', { name: 'Edit drafts' }).click();
  await page.getByRole('button', { name: 'Compare drafts' }).click();
  await expect(page.getByRole('tab', { name: /Review changes/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect(page.locator('#review-editor')).toHaveText('My custom proposal.');
  await expect(page.locator('#error')).toBeHidden();
});

test('all examples work and formatting is preserved after acceptance', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Try an example' }).selectOption('release');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect(page.locator('#review-editor')).toContainText('Release 0.5');
  await page.getByRole('combobox', { name: 'Try an example' }).selectOption('formatting');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect(page.locator('#review-editor strong')).toHaveText('final deliverables');
  await expect(page.locator('#review-editor')).toContainText('A recorded walkthrough.');
  await expect(page.locator('#review-editor [data-change]')).toHaveCount(0);
});

test('formatting toolbar applies a real rich-text edit', async ({ page }) => {
  await page.getByRole('tab', { name: 'Edit drafts' }).click();
  const draft = page.getByRole('textbox', { name: 'Proposed document', exact: true });
  await draft.fill('Format this sentence.');
  await draft.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold proposed selection', exact: true }).click();
  await expect(page.locator('#proposed-editor strong')).toHaveText('Format this sentence.');
  await page.getByRole('button', { name: 'Compare drafts' }).click();
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect(page.locator('#review-editor strong')).toHaveText('Format this sentence.');
});

test('mobile layout fits and change decisions remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: 'Accept change 1', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#pending-count')).toHaveText('4');
  await page.screenshot({ path: 'demo-evidence/mobile.png', fullPage: true });
});
