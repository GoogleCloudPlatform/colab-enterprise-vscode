/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
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
  until,
} from 'vscode-extension-tester';
import { CONFIG } from '../config';

const ELEMENT_WAIT_MS = 15000;
const CELL_EXECUTION_WAIT_MS = 30000;
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOTS_DIR =
  process.env.SCREENSHOTS_DIR ||
  path.resolve(__dirname, '../../e2e-screenshots', RUN_TIMESTAMP);
let screenshotStep = 1;

describe('Workbench Extension', function () {
  dotenv.config();

  let driver: WebDriver;
  let testTitle: string;
  let workbench: Workbench;

  before(async () => {
    assert.ok(CONFIG.ClientId, 'ClientId is not set');
    assert.ok(CONFIG.ClientNotSoSecret, 'ClientNotSoSecret is not set');
    // Wait for VS Code UI to settle before running tests.
    workbench = new Workbench();
    driver = workbench.getDriver();
    await driver.sleep(8000);
  });

  beforeEach(function () {
    testTitle = this.currentTest?.fullTitle() ?? '';
    screenshotStep = 1;
  });

  afterEach(async function () {
    const state = this.currentTest?.state === 'passed' ? 'success' : 'failed';
    const title =
      this.currentTest
        ?.fullTitle()
        .replace(/\s+/g, '_')
        .replace(/[/\\?%*:|"<>]/g, '-') ?? 'unknown_test';
    try {
      await takeScreenshot(driver, `${title}_${state}`);
    } catch (err) {
      console.error('Failed to take screenshot:', err);
    }
  });

  describe('with a notebook', () => {
    beforeEach(async () => {
      // Create an executable notebook. Note that it's created with a single
      // code cell by default.
      await workbench.executeCommand('Create: New Jupyter Notebook');
      await takeScreenshot(driver, 'create_notebook');
      // Wait for the notebook editor to finish loading before we interact with
      // it.
      await notebookLoaded(driver);
      await takeScreenshot(driver, 'notebook_loaded');
      await workbench.executeCommand('Notebook: Edit Cell');
      await takeScreenshot(driver, 'edit_cell');
      const cell = await driver.switchTo().activeElement();
      await cell.sendKeys('1 + 1');
      await takeScreenshot(driver, 'cell_filled');
    });

    it('authenticates and executes the notebook on a Colab server', async () => {
      // Select the Colab server provider from the kernel selector.
      await workbench.executeCommand('Notebook: Select Notebook Kernel');
      await takeScreenshot(driver, 'select_kernel_command');
      const selected = await selectQuickPickItem({
        item: [
          'Select Another Kernel...',
          'Select Another Kernel',
          'Google Cloud Workbench',
        ],
        quickPick: 'Select Another Kernel...',
      });
      if (
        selected &&
        (selected.toLowerCase() === 'select another kernel...' ||
          selected.toLowerCase() === 'select another kernel')
      ) {
        await selectQuickPickItem({
          item: 'Google Cloud Workbench',
          quickPick: 'Select Another Kernel',
        });
      }
      await selectQuickPickItem({
        item: 'Workbench',
        quickPick: 'Select a Jupyter Server',
      });

      // Accept the dialog allowing the Colab extension to sign in using Google.
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
      await doOauthSignIn(/* oauthUrl= */ clipboardy.default.readSync());

      // Now that we're authenticated, we can resume creating a Colab server via
      // the open kernel selector.
      await selectQuickPickItem({
        item: 'jaas-test-notebooks-host',
        quickPick: 'Select a Google Cloud Project (1/2)',
      });

      await driver.sleep(ELEMENT_WAIT_MS);
      await takeScreenshot(driver, 'project_selected');

      // Alias the server with the default name.
      const inputBox = await InputBox.create();
      await inputBox.sendKeys(Key.ENTER);
      await selectQuickPickItem({
        item: 'workbench-vs-code-plugin (jaas-test-notebooks-host)',
        quickPick: 'Select a Jupyter Server',
      });

      await driver.sleep(ELEMENT_WAIT_MS);
      await takeScreenshot(driver, 'server_selected');

      await selectQuickPickItem({
        item: 'TensorFlow 2-11',
        quickPick: 'Select a Kernel',
      });

      await driver.sleep(ELEMENT_WAIT_MS);
      await takeScreenshot(driver, 'kernel_selected');

      await driver.sleep(ELEMENT_WAIT_MS);
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
  });

  /**
   * Selects the QuickPick option.
   */
  async function selectQuickPickItem({
    item,
    quickPick,
  }: {
    item: string | string[];
    quickPick: string;
  }): Promise<string | undefined> {
    const items = Array.isArray(item) ? item : [item];
    return driver
      .wait(
        async () => {
          try {
            const inputBox = await InputBox.create();
            const picks = await inputBox.getQuickPicks();
            for (const pick of picks) {
              const text = await pick.getText();
              const label = await pick.getLabel().catch(() => '');

              for (const searchItem of items) {
                if (text === searchItem || label === searchItem) {
                  console.log(`Found item: "${label || text}". Selecting...`);
                  try {
                    await pick.select();
                  } catch (e: unknown) {
                    if (
                      e instanceof Error &&
                      e.message.includes('element click intercepted')
                    ) {
                      console.log(
                        `Selection intercepted. Trying JS click for "${label || text}"...`,
                      );
                      await driver.executeScript('arguments[0].click();', pick);
                    } else {
                      throw e;
                    }
                  }
                  console.log(`Selected item: "${label || text}"`);
                  await takeScreenshot(
                    driver,
                    `selected_${(label || text)
                      .replace(/[^a-z0-9]/gi, '_')
                      .toLowerCase()}`,
                  );
                  return label || text;
                }
              }
            }
            return undefined;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.log(`Error selecting item in "${quickPick}": ${message}`);
            return undefined;
          }
        },
        ELEMENT_WAIT_MS,
        `Select "${items.join(' OR ')}" item for QuickPick "${quickPick}" failed`,
    )
      .catch(async (e: unknown) => {
        // Log available items for debugging
        try {
          const inputBox = await InputBox.create();
          const picks = await inputBox.getQuickPicks();
          const labels = await Promise.all(picks.map((p) => p.getText()));
          console.log(`Available QuickPick items for "${quickPick}":`, labels);
        } catch (err) {
          console.log('Failed to log QuickPick items:', err);
        }

        // If the QuickPick selection fails, ensure we take a screenshot for
        // debugging.
        const title = testTitle
          .replace(/\s+/g, '_')
          .replace(/[/\\?%*:|"<>]/g, '-');
        await takeScreenshot(driver, `${title}_quickpick_failure`);
        throw e;
      });
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
          // Swallow the error since we want to fail when the timeout's reached.
          return false;
        }
      },
      ELEMENT_WAIT_MS,
      `Push "${button}" button for dialog "${dialog}" failed`,
    );
  }

  /**
   * Performs the OAuth sign-in flow for the Colab extension.
   */
  async function doOauthSignIn(oauthUrl: string): Promise<void> {
    const oauthDriver = await getOAuthDriver();

    try {
      await oauthDriver.get(oauthUrl);
      await takeScreenshot(oauthDriver, 'oauth_redirect_loaded');

      // Input the test account email address.
      const emailInput = await oauthDriver.findElement(
        By.css("input[type='email']"),
      );
      await emailInput.sendKeys(process.env.TEST_ACCOUNT_EMAIL ?? '');
      await emailInput.sendKeys(Key.ENTER);
      await takeScreenshot(oauthDriver, 'email_entered');

      // Input the test account password. Note that we wait for the page to
      // settle to avoid getting a stale element reference.
      await oauthDriver.wait(
        until.urlContains('accounts.google.com/v3/signin/challenge'),
        ELEMENT_WAIT_MS,
      );
      await oauthDriver.sleep(1000);
      await takeScreenshot(oauthDriver, 'password_page_loaded');

      const passwordInput = await oauthDriver.findElement(
        By.css("input[type='password']"),
      );
      await passwordInput.sendKeys(process.env.TEST_ACCOUNT_PASSWORD ?? '');
      await passwordInput.sendKeys(Key.ENTER);
      await takeScreenshot(oauthDriver, 'password_entered');

      // Click Continue to sign in to Colab.
      await oauthDriver.wait(
        until.urlContains('accounts.google.com/signin/oauth/id'),
        ELEMENT_WAIT_MS,
      );
      await takeScreenshot(oauthDriver, 'oauth_id_page_loaded');

      await waitAndClick(
        oauthDriver,
        By.xpath("//span[text()='Continue']"),
        '"Continue" button not visible on ID screen',
      );
      await takeScreenshot(oauthDriver, 'continue_clicked');

      // Click Allow or Continue to authorize the scope (handles both v1 and v2
      // consent screens).
      await oauthDriver.wait(until.urlContains('consent'), ELEMENT_WAIT_MS);
      await takeScreenshot(oauthDriver, 'consent_page_loaded');

      await waitAndClick(
        oauthDriver,
        By.xpath("//span[text()='Allow' or text()='Continue']"),
        '"Allow" or "Continue" button not visible on consent screen',
      );
      await takeScreenshot(oauthDriver, 'allow_clicked');

      // Check that the test account's authenticated. Close the browser window.
      // await oauthDriver.wait(
      //   until.urlContains('vscode://google.workbench/auth-success'),
      //   ELEMENT_WAIT_MS,
      // );
      await takeScreenshot(oauthDriver, 'auth_success');

      await oauthDriver.quit();
    } catch (err) {
      // If the OAuth flow fails, ensure we grab a screenshot for debugging.
      const title = testTitle
        .replace(/\s+/g, '_')
        .replace(/[/\\?%*:|"<>]/g, '-');
      await takeScreenshot(oauthDriver, `${title}_oauth_window_failure`);
      throw err;
    }
  }
});

/**
 * Creates a new WebDriver instance for the OAuth flow.
 */
async function getOAuthDriver(): Promise<WebDriver> {
  const authDriverArgsPrefix = '--auth-driver:';
  const authDriverArgs = process.argv
    .filter((a) => a.startsWith(authDriverArgsPrefix))
    .map((a) => a.substring(authDriverArgsPrefix.length));

  let serviceBuilder: chrome.ServiceBuilder;

  if (process.env.CHROMEDRIVER_PATH) {
    serviceBuilder = new chrome.ServiceBuilder(process.env.CHROMEDRIVER_PATH);
    console.log(
      'DEBUG: Using CHROMEDRIVER_PATH env:',
      process.env.CHROMEDRIVER_PATH,
    );
  } else {
    // Fallback to finding it in /tmp/test-resources
    // if not set (e.g. running via debug config)
    // We explicitly look for version 144 first as that
    // is the current system version.
    const possiblePaths = [
      '/tmp/test-resources/chromedriver-144/chromedriver-linux64/chromedriver', // Created by our script
      '/tmp/test-resources/chromedriver-linux64/chromedriver', // Default extest (often outdated/142)
    ];

    let foundPath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (foundPath) {
      serviceBuilder = new chrome.ServiceBuilder(foundPath);
      console.log('DEBUG: Found ChromeDriver fallback:', foundPath);
    } else {
      serviceBuilder = new chrome.ServiceBuilder();
      console.log(
        'DEBUG: No local ChromeDriver found, relying on Selenium Manager',
      );
    }
  }

  return new Builder()
    .forBrowser('chrome')
    .setChromeService(serviceBuilder)
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
    until.elementIsVisible(await driver.findElement(locator)),
    ELEMENT_WAIT_MS,
    errorMsg,
  );
  const element = await driver.findElement(locator);
  await element.click();
}

/**
 * Takes a screenshot and saves it to the screenshots directory.
 */
async function takeScreenshot(driver: WebDriver, name: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  const fileName = `${String(screenshotStep)}_${name}.png`;
  screenshotStep++;
  const screenshotPath = path.join(SCREENSHOTS_DIR, fileName);
  const image = await driver.takeScreenshot();
  fs.writeFileSync(screenshotPath, image, 'base64');
}
