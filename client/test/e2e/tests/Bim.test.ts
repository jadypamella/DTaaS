// src: https://playwright.dev/docs/writing-tests

import { expect, type Page } from '@playwright/test';
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

/** Open the IFC Model menu, or skip the test when the library holds no model. */
async function openModelMenu(page: Page) {
  await page.goto('./bim');
  const picker = page.getByRole('combobox', { name: 'IFC Model' });
  const empty = page.getByText('No IFC file is in the shared library yet.');
  // The list comes from the workspace over the network, which takes longer
  // than the default five seconds on a busy run.
  await expect(empty.or(picker).first()).toBeVisible({ timeout: 30000 });
  // Skipped when the library holds no model: there is nothing to open, and
  // the empty library has its own test above.
  test.skip(!(await picker.isVisible()), 'The library holds no IFC model.');
  await picker.click();
}

/** A model size as the menu prints it, 11 KB or 1.6 MB, in kilobytes. */
function kilobytes(text: string): number {
  const match = /(\d+(?:\.\d+)?) (KB|MB)/.exec(text);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * (match[2] === 'MB' ? 1024 : 1);
}

/** The model a browser converts in seconds, and no larger. */
const LARGEST_TO_CONVERT_KB = 2 * 1024;

/**
 * Wait until the model is in the scene and nothing went wrong drawing it.
 *
 * A WebGL canvas has nothing to query, and counting its colours does not tell
 * an empty scene from a small model, grey on grey. The class list under the
 * drawing does: it is computed from the objects the scene holds, so it appears
 * only once the model has loaded into it.
 */
async function expectModelDrawn(page: Page) {
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  const classes = page.getByText('In This Model').locator('..');
  await expect(classes).toBeVisible({ timeout: 30000 });
  await expect(classes.getByRole('button').first()).toBeVisible();
  await expect(page.getByText(/could not be read/)).toHaveCount(0);
}

test.describe('Building Models, drawing a model', () => {
  test.beforeEach(async ({ page }) => {
    await openAuthenticatedApp(page);
    await expect(page).toHaveURL(/.*Library/);
  });

  test('draws a model that has already been converted', async ({ page }) => {
    // A converted model loads its .glb, so it draws in seconds.
    await openModelMenu(page);
    const converted = page.getByRole('option').filter({ hasText: 'Converted' });
    // Skipped when no model is converted yet, because the only other way to
    // draw one is to convert it, which the next test does.
    test.skip(
      (await converted.count()) === 0,
      'No model in the library has been converted yet.',
    );
    await converted.first().click();

    await expectModelDrawn(page);
  });

  test('converts a model in the browser and stores the result', async ({
    page,
    baseURL,
  }, testInfo) => {
    // It writes into the shared library, so two browsers running it at once
    // would race for the same model. One browser runs it.
    test.skip(
      testInfo.project.name !== 'chromium',
      'Writes to the shared library, so only chromium runs it.',
    );
    // The smallest model not converted yet, so the conversion takes seconds.
    // A building takes minutes, so a library whose unconverted models are all
    // large is skipped with the reason.
    await openModelMenu(page);
    const unconverted = page
      .getByRole('option')
      .filter({ hasText: 'From IFC' });
    const texts = await unconverted.allInnerTexts();
    const sizes = texts.map(kilobytes);
    const smallest = sizes.indexOf(Math.min(...sizes));
    // Skipped when every unconverted model is large, because converting a
    // building in the browser takes minutes.
    test.skip(
      smallest < 0 || sizes[smallest] > LARGEST_TO_CONVERT_KB,
      'No unconverted model small enough to convert in a test.',
    );

    // The test writes a .glb into the user's library, so it removes what it
    // wrote and the next run finds the model unconverted again.
    const library = `${(baseURL ?? '').replace(/\/$/, '')}/${
      process.env.REACT_APP_TEST_USERNAME
    }/api/contents/common/models`;
    const storedGeometry = async () => {
      const listing = await (await page.request.get(library)).json();
      return (listing.content as { name: string }[])
        .map((file) => file.name)
        .filter((name) => name.endsWith('.glb'));
    };
    const before = await storedGeometry();

    try {
      await unconverted.nth(smallest).click();
      // The page says one or the other. A refusal is reported at once and not
      // after the timeout. Two copies of this test running at the same moment
      // are refused by design: the second finds the file the first just named,
      // and the upload never replaces a file that appeared during it.
      const stored = page.getByText(/Stored in the library/);
      const refused = page.getByText(/could not be stored/);
      await expect(stored.or(refused)).toBeVisible({ timeout: 60000 });
      expect(
        await refused.isVisible(),
        'The page reported that the conversion could not be stored.',
      ).toBe(false);
      await expect(
        page.getByText('Converted', { exact: true }).first(),
      ).toBeVisible();
      await expectModelDrawn(page);
      expect((await storedGeometry()).length).toBe(before.length + 1);
    } finally {
      const written = (await storedGeometry()).filter(
        (name) => !before.includes(name),
      );
      await Promise.all(
        written.map((name) =>
          page.request.delete(`${library}/${encodeURIComponent(name)}`),
        ),
      );
    }
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
