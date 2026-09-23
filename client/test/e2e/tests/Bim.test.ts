// src: https://playwright.dev/docs/writing-tests

import { expect } from '@playwright/test';
import test from 'test/e2e/setup/fixtures';
import { openAuthenticatedApp } from 'test/e2e/setup/appSettings';

/**
 * The Building Models route, end to end.
 *
 * A single page application answers HTTP 200 for every path, so reaching the
 * URL proves nothing. Each test below asserts on something only this page
 * renders.
 *
 * The drawing itself is checked only as far as a browser shows it: a canvas
 * appears and no error takes its place. A WebGL canvas has no accessible
 * content to query, so what the drawing contains is covered by the package's
 * own tests, which run without a browser.
 */
test.describe('Building Models', () => {
  test.beforeEach(async ({ page }) => {
    await openAuthenticatedApp(page);
    await expect(page).toHaveURL(/.*Library/);
  });

  test('is reachable from the menu and renders its own heading', async ({
    page,
  }) => {
    // The menu names the route Buildings, and the page heads itself
    // Building Models.
    await page.getByRole('link', { name: 'Buildings' }).click();

    await expect(page).toHaveURL('./bim');
    await expect(
      page.getByRole('heading', { name: 'Building Models' }),
    ).toBeVisible();
  });

  test('names the library directory it reads models from', async ({ page }) => {
    // The address comes from the deployment's own configuration. A page that
    // did not say where it was looking would leave an empty list ambiguous
    // between "no models" and "wrong directory".
    await page.goto('./bim');

    await expect(page.getByText('common/models')).toBeVisible();
  });

  test('says what it found instead of leaving the page blank', async ({
    page,
  }) => {
    // Either outcome is correct and the page has to distinguish them: a
    // library with no IFC file says so, and a library with one offers the
    // models in a menu headed IFC Model and says how many there are.
    await page.goto('./bim');

    const empty = page.getByText('No IFC file is in the shared library yet.');
    const picker = page.getByRole('combobox', { name: 'IFC Model' });
    const count = page.getByText(/^\d+ IFC models? in the shared library\.$/);

    // The list comes from the workspace over the network, which takes longer
    // than the default five seconds on a busy run.
    await expect(empty.or(picker).first()).toBeVisible({ timeout: 30000 });
    if (await picker.isVisible()) {
      await expect(count).toBeVisible();
    }
  });
});

test.describe('Building Models, drawing a model', () => {
  test.beforeEach(async ({ page }) => {
    await openAuthenticatedApp(page);
    await expect(page).toHaveURL(/.*Library/);
  });

  test('draws a model that has already been converted', async ({ page }) => {
    // A converted model loads its .glb, so it draws in seconds. A model that
    // is not converted yet is converted in the browser, which for a building
    // takes minutes, so this test only opens a converted one and says so when
    // the library holds none.
    await page.goto('./bim');
    const picker = page.getByRole('combobox', { name: 'IFC Model' });
    const empty = page.getByText('No IFC file is in the shared library yet.');
    // The list comes from the workspace over the network, which takes longer
    // than the default five seconds on a busy run.
    await expect(empty.or(picker).first()).toBeVisible({ timeout: 30000 });
    test.skip(!(await picker.isVisible()), 'The library holds no IFC model.');

    await picker.click();
    const converted = page.getByRole('option').filter({ hasText: 'Converted' });
    test.skip(
      (await converted.count()) === 0,
      'No model in the library has been converted yet.',
    );
    await converted.first().click();

    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/could not be read/)).toHaveCount(0);
  });
});

test.describe('Building Models without a session', () => {
  test('sends the visitor to sign in', async ({ page, baseURL }) => {
    // The route reads the signed-in user's own library, so it must not be
    // reachable without a session. The session lives in sessionStorage and is
    // restored only by openAuthenticatedApp, so a page opened directly has
    // none, the same way the authentication suite checks the other routes.
    await page.goto('./bim');

    await expect(page).toHaveURL(baseURL?.replace(/\/$/, '') ?? './');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({
      timeout: 10000,
    });
  });
});
