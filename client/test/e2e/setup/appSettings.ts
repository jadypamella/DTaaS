import { expect, type Page } from '@playwright/test';
import { restoreSessionStorage } from 'test/e2e/setup/authStorage';

export const PRIMARY_RUNNER = process.env.PRIMARY_RUNNER ?? 'linux';
export const SECONDARY_RUNNER = process.env.SECONDARY_RUNNER ?? 'windows';

export async function disableRemoteLogging(page: Page) {
  await page.evaluate(() => {
    const readSettings = (): Record<string, unknown> => {
      const persistedSettings = localStorage.getItem('settings');
      if (persistedSettings === null) return {};
      try {
        return JSON.parse(persistedSettings) as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...readSettings(),
        remoteLoggingEnabled: false,
      }),
    );
  });
}

/**
 * Finish a GitLab sign-in, authorizing the application only when GitLab asks.
 *
 * GitLab shows the Authorize page the first time a user signs in to an
 * application. After that it sends the browser straight back to the website,
 * so a run that always waits for the button fails for every user who has
 * signed in before. This waits for whichever page comes first.
 */
export async function authorizeIfAsked(page: Page) {
  const authorize = page.getByRole('button', { name: /Authorize/ });
  const signedIn = page.getByRole('button', { name: 'Open settings' });
  await expect(authorize.or(signedIn)).toBeVisible({ timeout: 30000 });
  if (await authorize.isVisible()) {
    await authorize.press('Enter');
  }
  await expect(signedIn).toBeVisible({ timeout: 30000 });
}

export async function openAuthenticatedApp(page: Page) {
  await restoreSessionStorage(page);
  await page.goto('./Library');
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible(
    { timeout: 30000 },
  );
}

export async function saveRunnerSettings(
  page: Page,
  primaryRunner = PRIMARY_RUNNER,
  secondaryRunner = SECONDARY_RUNNER,
) {
  await page.getByLabel('Open settings').click();
  await page.getByRole('menuitem', { name: 'Account' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(
    page.getByRole('button', { name: 'Save Settings' }),
  ).toBeVisible();
  await page.fill('#runnerTag', primaryRunner);
  await page.fill('#measurementSecondaryRunnerTag', secondaryRunner);
  await page.getByRole('button', { name: 'Save Settings' }).click();
}
