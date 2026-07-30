const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/usr/local/bin/chrome",
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  try {
    const out = require("child_process").execSync(
      "which google-chrome || which chromium || which chromium-browser || which chrome",
      { encoding: "utf8" }
    );
    const p = out.trim().split("\n")[0];
    if (p && fs.existsSync(p)) return p;
  } catch {}
  throw new Error("Chrome not found");
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/audio-test", { waitUntil: "networkidle0" });
  await page.waitForSelector("audio", { timeout: 10000 });

  const runTest = async (selector, label) => {
    const section = await page.$(selector);
    if (!section) throw new Error(`${label} section not found`);

    // pause audio first
    await page.evaluate((sel) => {
      const audio = document.querySelector(sel).querySelector("audio");
      audio.pause();
      audio.currentTime = 0;
    }, selector);
    await new Promise((r) => setTimeout(r, 300));

    const bar = await page.evaluateHandle((sel) => {
      return document.querySelector(sel).querySelector(".group\\/aprog");
    }, selector);

    const barBox = await bar.boundingBox();
    console.log(`\n[${label}] progress bar box:`, JSON.stringify(barBox));
    if (!barBox || barBox.width < 20) throw new Error(`${label} progress bar too narrow/invisible`);

    const startX = barBox.x + 5;
    const endX = barBox.x + barBox.width * 0.5;
    const y = barBox.y + barBox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 200));

    const result = await page.evaluate((sel) => {
      const audio = document.querySelector(sel).querySelector("audio");
      return {
        currentTime: audio.currentTime,
        duration: audio.duration,
        paused: audio.paused,
      };
    }, selector);

    const expected = result.duration * 0.5;
    const diff = Math.abs(result.currentTime - expected);
    console.log(
      `[${label}] currentTime:`,
      result.currentTime.toFixed(3),
      "expected:",
      expected.toFixed(3),
      "diff:",
      diff.toFixed(3)
    );
    console.log(`[${label}] DRAG_OK:`, diff < 0.5 ? "YES" : "NO");

    // check visibility/contrast: get progress bar fill color
    const styles = await page.evaluate((sel) => {
      const prog = document.querySelector(sel).querySelector(".group\\/aprog");
      const track = prog.children[0];
      const fill = prog.children[1];
      return {
        trackColor: window.getComputedStyle(track).backgroundColor,
        fillWidth: window.getComputedStyle(fill).width,
        fillColor: window.getComputedStyle(fill).backgroundImage,
      };
    }, selector);
    console.log(`[${label}] styles:`, styles);
  };

  try {
    await runTest("#light-section", "LIGHT");
    await runTest("#dark-section", "DARK");
    console.log("\nALL TESTS PASSED");
  } catch (e) {
    console.error("TEST FAILED:", e.message);
  }

  await browser.close();
})();
