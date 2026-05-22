import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function capture() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Create screenshots directory
  const screenshotsDir = path.join(process.cwd(), 'public', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Use a local server or assuming the dev server might be running?
  // Actually, I can't guarantee a dev server is running.
  // I'll try to start it if needed, but better if I can just use the tool.
  // The user instruction says I'm responsible for the sandbox.

  const url = 'http://localhost:5173';

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Skip auth if possible or just take a screenshot of the auth screen as a fallback
    // But it's better to have a screenshot of the actual app.
    // For now, I'll take what I can get.

    // Desktop screenshot
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(screenshotsDir, 'desktop.png') });
    console.log('Desktop screenshot captured.');

    // Mobile screenshot
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone 8 size
    await page.screenshot({ path: path.join(screenshotsDir, 'mobile.png') });
    console.log('Mobile screenshot captured.');

  } catch (error) {
    console.error('Failed to capture screenshots:', error);
  } finally {
    await browser.close();
  }
}

capture();
