const fs = require('node:fs');
const { chromium } = require('playwright');

const executableCandidates = [
  process.env.PINDROP_CHROMIUM_EXECUTABLE,
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].filter(Boolean);

function launchOptions(options = {}) {
  const executablePath = executableCandidates.find(candidate => fs.existsSync(candidate));
  return executablePath ? { ...options, executablePath } : options;
}

async function launchChromium(options = {}) {
  try {
    return await chromium.launch(launchOptions(options));
  } catch (error) {
    if (/Executable doesn't exist|Looks like Playwright was just installed or updated/.test(error.message)) {
      throw new Error(`${error.message}\n\nInstall Playwright Chromium with \`npx playwright install chromium\`, or set PINDROP_CHROMIUM_EXECUTABLE/CHROME_BIN to an existing Chromium-compatible browser.`, {
        cause: error,
      });
    }
    throw error;
  }
}

module.exports = { launchChromium };
