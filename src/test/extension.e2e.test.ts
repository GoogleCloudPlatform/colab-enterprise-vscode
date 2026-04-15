/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import { assert } from 'chai';
import dotenv from 'dotenv';
import * as chrome from 'selenium-webdriver/chrome';
import {
  Builder,
  By,
  InputBox,
  Key,
  ModalDialog,
  WebDriver,
  Workbench,
  VSBrowser,
  until,
} from 'vscode-extension-tester';
import { CONFIG } from '../config';

const ELEMENT_WAIT_MS = 60 * 1000;
const CELL_EXECUTION_WAIT_MS = 30 * 1000;
const AUTH_WAIT_MS = 1000;

describe('Workbench Extension', function () {
  dotenv.config();

  let driver: WebDriver;
  let testTitle: string;
  let workbench: Workbench;

  beforeEach(function () {
    testTitle = this.currentTest?.fullTitle() ?? '';
  });

  before(async () => {
    assert.ok(CONFIG.ClientId, 'ClientId is not set');
    assert.ok(CONFIG.ClientNotSoSecret, 'ClientNotSoSecret is not set');
    assert.ok(process.env.TEST_ACCOUNT_EMAIL, 'TEST_ACCOUNT_EMAIL is not set');
    assert.ok(
      process.env.TEST_ACCOUNT_PASSWORD,
      'TEST_ACCOUNT_PASSWORD is not set',
    );
    // Wait for VS Code UI to settle before running tests.
    workbench = new Workbench();
    driver = workbench.getDriver();

    // Dismiss any modal window that appears at start.
    await driver.sleep(ELEMENT_WAIT_MS);
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await driver.sleep(ELEMENT_WAIT_MS);
  });

  describe('with a notebook', () => {
    beforeEach(async () => {
      // Create an executable notebook. Note that it's created with a single
      // code cell by default.
      await workbench.executeCommand('Create: New Jupyter Notebook');
      // Wait for the notebook editor to finish loading before we interact with
      // it.
      await notebookLoaded(driver);
      await workbench.executeCommand('Notebook: Edit Cell');
      const cell = await driver.switchTo().activeElement();
      await cell.sendKeys('1 + 1');
    });

    it('authenticates and executes the notebook on a Workbench server', async () => {
      // Select the Workbench server provider from the kernel selector.
      await workbench.executeCommand('Notebook: Select Notebook Kernel');
      const selected = await selectAnyQuickPickItem({
        items: ['Select Another Kernel...', 'Google Cloud'],
        quickPick: 'Select Notebook Kernel',
      });

      if (selected === 'Select Another Kernel...') {
        await selectQuickPickItem({
          item: 'Google Cloud',
          quickPick: 'Select Another Kernel',
        });
      }

      await selectQuickPickItem({
        item: 'Workbench',
        quickPick: 'Select a Jupyter Server',
      });

      await pushDialogButton({
        button: 'Allow',
        dialog: "The extension 'Workbench' wants to sign in using Google.",
      });

      // Begin the sign-in process by copying the OAuth URL to the clipboard and
      // opening it in a browser window. Why do this instead of triggering the
      // "Open" button in the dialog? We copy the URL so that we can use a new
      // driver instance for the OAuth flow, since the original driver instance
      // does not have a handle to the window that would be spawned with "Open".
      await pushDialogButton({
        button: 'Copy',
        dialog: 'Do you want Code to open the external website?',
      });
      // TODO: Remove this dynamic import
      const clipboardy = await import('clipboardy');

      await driver.sleep(AUTH_WAIT_MS);

      await doOauthSignIn(/* oauthUrl= */ clipboardy.default.readSync());

      // Now that we're authenticated, we can resume selecting GCP project for
      // the Workbench notebook server.
      await selectQuickPickItem({
        item: 'jaas-test-notebooks-host',
        quickPick: 'Select a Google Cloud Project',
      });

      await selectQuickPickItem({
        item: 'workbench-vs-code-plugin',
        quickPick: 'Select Jupyter Instance',
      });

      await selectQuickPickItem({
        item: 'TensorFlow 2-11',
        quickPick: 'Select a Kernel',
      });

      // Execute the notebook and poll for the success indicator (green check).
      // Why not the cell output? Because the output is rendered in a webview.
      await workbench.executeCommand('Notebook: Run All');
      await driver.wait(
        async () => {
          const element = await workbench
            .getEnclosingElement()
            .findElements(By.className('codicon-notebook-state-success'));
          return element.length > 0;
        },
        CELL_EXECUTION_WAIT_MS,
        'Notebook: Run All failed',
      );
    });

    it('selects the instance directly from the native UI menu', async () => {
      await workbench.executeCommand('Notebook: Select Notebook Kernel');

      await selectQuickPickItem({
        item: 'Select Another Kernel...',
        quickPick: 'Select Another Kernel...',
      });

      await selectQuickPickItem({
        item: 'Google Cloud',
        quickPick: 'Select Another Kernel...',
      });

      await selectQuickPickItem({
        item: 'workbench-vs-code-plugin',
        quickPick: 'Select Jupyter Instance',
      });

      await selectQuickPickItem({
        item: 'TensorFlow 2-11',
        quickPick: 'Select a Kernel',
      });

      // Execute the notebook and poll for the success indicator (green check).
      await workbench.executeCommand('Notebook: Run All');
      await driver.wait(async () => {
        const element = await workbench
          .getEnclosingElement()
          .findElements(By.className('codicon-notebook-state-success'));
        return element.length > 0;
      });
    });
  });

  async function selectAnyQuickPickItem({
    items,
    quickPick,
  }: {
    items: string[];
    quickPick: string;
  }): Promise<string> {
    return driver.wait(
      async () => {
        const inputBox = await InputBox.create();
        const picks = await inputBox.getQuickPicks();
        for (const pick of picks) {
          const text = await pick.getText();
          for (const item of items) {
            if (text.includes(item)) {
              await pick.select();
              console.log(
                `Selection of "${item}" completed (promise resolved).`,
              );
              return item;
            }
          }
        }
        return '';
      },
      ELEMENT_WAIT_MS,
      `Selecting any of "${items.join(', ')}" for QuickPick "${quickPick}" failed`,
    );
  }

  /**
   * Selects the QuickPick option.
   */
  async function selectQuickPickItem({
    item,
    quickPick,
  }: {
    item: string;
    quickPick: string;
  }): Promise<string> {
    return selectAnyQuickPickItem({ items: [item], quickPick });
  }
  /**
   * Pushes a button in a modal dialog and waits for the action to complete.
   */
  async function pushDialogButton({
    button,
    dialog,
  }: {
    button: string;
    dialog: string;
  }) {
    // ModalDialog.pushButton will throw if the dialog is not found; to reduce
    // flakes we attempt this until it succeeds or times out.
    return driver.wait(
      async () => {
        try {
          const dialog = new ModalDialog();
          await dialog.pushButton(button);
          return true;
        } catch (_) {
          // Fail when the timeout's reached.
          return false;
        }
      },
      ELEMENT_WAIT_MS,
      `Push "${button}" button for dialog "${dialog}" failed`,
    );
  }

  /**
   * Performs the OAuth sign-in flow for the Workbench extension.
   */
  async function doOauthSignIn(oauthUrl: string): Promise<void> {
    const oauthDriver = await getOAuthDriver();

    try {
      await oauthDriver.get(oauthUrl);

      // Input the test account email address.
      const emailInput = await oauthDriver.findElement(
        By.css("input[type='email']"),
      );
      await emailInput.sendKeys(process.env.TEST_ACCOUNT_EMAIL ?? '');
      await emailInput.sendKeys(Key.ENTER);

      // Input the test account password. Note that we wait for the page to
      // settle to avoid getting a stale element reference.
      await oauthDriver.wait(
        until.urlContains('accounts.google.com/v3/signin/challenge'),
        ELEMENT_WAIT_MS,
      );
      await oauthDriver.sleep(1000);
      const passwordInput = await oauthDriver.findElement(
        By.css("input[type='password']"),
      );
      await passwordInput.sendKeys(process.env.TEST_ACCOUNT_PASSWORD ?? '');
      await passwordInput.sendKeys(Key.ENTER);

      // Click Continue to sign in to Workbench.
      await oauthDriver.wait(
        until.urlContains('accounts.google.com/signin/oauth/id'),
        ELEMENT_WAIT_MS,
      );
      await waitAndClick(
        oauthDriver,
        By.xpath("//span[text()='Continue']"),
        '"Continue" button not visible on ID screen',
      );

      // Click Allow or Continue to authorize the scope
      // (handles both v1 and v2 consent screens).
      await oauthDriver.wait(until.urlContains('consent'), ELEMENT_WAIT_MS);
      await waitAndClick(
        oauthDriver,
        By.xpath("//span[text()='Allow' or text()='Continue']"),
        '"Allow" or "Continue" button not visible on consent screen',
      );

      // Check that the test account's authenticated.
      // Close the browser window.
      await oauthDriver.wait(
        until.urlContains(
          'https://docs.cloud.google.com/vertex-ai/docs/workbench/auth',
        ),
        ELEMENT_WAIT_MS,
      );
      await oauthDriver.quit();
    } catch (_) {
      // If the OAuth flow fails, ensure we grab a screenshot for debugging.
      const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      fs.writeFileSync(
        `${screenshotsDir}/${testTitle} (oauth window).png`,
        await oauthDriver.takeScreenshot(),
        'base64',
      );
      throw _;
    }
  }
});

/**
 * Creates a new WebDriver instance for the OAuth flow.
 */
function getOAuthDriver(): Promise<WebDriver> {
  const authDriverArgsPrefix = '--auth-driver:';
  const authDriverArgs = process.argv
    .filter((a) => a.startsWith(authDriverArgsPrefix))
    .map((a) => a.substring(authDriverArgsPrefix.length));
  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(
      new chrome.Options().addArguments(...authDriverArgs) as chrome.Options,
    )
    .build();
}

async function notebookLoaded(driver: WebDriver): Promise<void> {
  await driver.wait(
    async () => {
      const editors = await driver.findElements(
        By.className('notebook-editor'),
      );
      return editors.length > 0;
    },
    ELEMENT_WAIT_MS,
    'Notebook editor did not load in time',
  );
}

/**
 * Waits for an element to be visible and clicks it.
 */
async function waitAndClick(
  driver: WebDriver,
  locator: By,
  errorMsg: string,
): Promise<void> {
  await driver.wait(
    async () => {
      try {
        const element = await driver.findElement(locator);
        await driver.wait(
          until.elementIsVisible(element),
          ELEMENT_WAIT_MS,
          `Element located but not visible: ${errorMsg}`,
        );
        await element.click();
        return true;
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e.name === 'StaleElementReferenceError' ||
            e.name === 'ElementClickInterceptedError')
        ) {
          return false;
        }
        throw e;
      }
    },
    ELEMENT_WAIT_MS,
    errorMsg,
  );
}
