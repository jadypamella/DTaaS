// src: https://playwright.dev/docs/writing-tests

import { expect } from '@playwright/test';
import test from 'test/e2e/setup/fixtures';
import { openAuthenticatedApp } from 'test/e2e/setup/appSettings';

/**
 * The Automation page, end to end.
 *
 * Its two cards are the only way into the Library Page and the Digital Twins
 * Page since they left the workbench. Each has to open its page in this tab,
 * because a new tab starts with an empty sessionStorage, where the session is
 * kept, and would send the person to sign in again.
 */
test.describe('Automation', () => {
  test.beforeEach(async ({ page }) => {
    await openAuthenticatedApp(page);
    await expect(page).toHaveURL(/.*Library/);
  });

  test('opens the Library Page and the Digital Twins Page in this tab', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'Automation' }).click();
    await expect(page).toHaveURL('./automation');

    await page.getByRole('link', { name: /Library Page/ }).click();
    await expect(page).toHaveURL('./preview/library');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Library Page' }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL('./automation');

    await page.getByRole('link', { name: /Digital Twins Page/ }).click();
    await expect(page).toHaveURL('./preview/digitaltwins');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Digital Twins Page' }),
    ).toBeVisible();
  });
});
