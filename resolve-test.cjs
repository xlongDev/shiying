const puppeteer = require("puppeteer-core");
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const AID = process.argv[2];

async function extractLivePhotosFromPage(page) {
  return await page.evaluate(() => {
    function isLiveImage(im) {
      return im.clipType === 5 || im.livePhotoType === 1;
    }
    function extractVideoUrl(video) {
      if (!video || typeof video !== "object") return "";
      const v = video;
      const bitRateList = Array.isArray(v.bitRateList) ? v.bitRateList : [];
      for (const item of bitRateList) {
        if (item && typeof item === "object") {
          const playAddr = item.playAddr;
          if (Array.isArray(playAddr)) {
            for (const p of playAddr) {
              if (typeof p === "object" && p.src) {
                if (p.src.includes("douyinvod")) return p.src;
              }
              if (typeof p === "string" && p.includes("douyinvod")) return p;
            }
          }
        }
      }
      const playAddr = v.playAddr;
      if (Array.isArray(playAddr)) {
        for (const p of playAddr) {
          if (typeof p === "object" && p.src) {
            if (p.src.includes("douyinvod")) return p.src;
          }
          if (typeof p === "string" && p.includes("douyinvod")) return p;
        }
      }
      let found = "";
      const visit = (obj) => {
        if (found || !obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach(visit);
          return;
        }
        for (const k of Object.keys(obj)) {
          if (k.startsWith("__react")) continue;
          const val = obj[k];
          if (typeof val === "string" && val.includes("douyinvod")) {
            found = val;
            return;
          }
          visit(val);
        }
      };
      visit(video);
      return found;
    }
    function extractImageUrl(img) {
      const urlList = img.urlList;
      if (Array.isArray(urlList)) {
        for (const u of urlList) {
          if (typeof u === "string" && u.includes("douyinpic")) return u;
        }
        for (const u of urlList) {
          if (typeof u === "string") return u;
        }
      }
      return "";
    }
    function getFiber(el) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
      return key ? el[key] : null;
    }
    const seedEl =
      document.querySelector(".dySwiperSlide") ||
      document.querySelector(".note-detail-container") ||
      document.querySelector("video") ||
      document.body;
    let start = getFiber(seedEl);
    if (!start) {
      let e = document.body;
      while (e && !start) {
        start = getFiber(e);
        e = e.firstElementChild;
      }
    }
    if (!start) return [];
    const visited = new Set();
    const candidates = [];
    const MAX = 100;
    let foundLiveCount = 0;
    function scanObj(obj) {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return;
      visited.add(obj);
      if (visited.size > 1000000) return;
      if (Array.isArray(obj)) {
        const isImageLike =
          obj.length > 0 &&
          obj.every(
            (x) =>
              x &&
              typeof x === "object" &&
              !("children" in x) &&
              ("clipType" in x || "livePhotoType" in x || "urlList" in x)
          );
        if (isImageLike) {
          const liveInArr = obj.filter((x) => isLiveImage(x)).length;
          if (liveInArr > 0) {
            foundLiveCount += liveInArr;
            if (candidates.length < MAX) candidates.push(obj);
          }
        }
        obj.forEach(scanObj);
        return;
      }
      for (const k of Object.keys(obj)) {
        if (k.startsWith("__react")) continue;
        scanObj(obj[k]);
      }
    }
    const stack = [start];
    let n = 0;
    while (stack.length && n < 200000) {
      const f = stack.pop();
      n++;
      if (!f || visited.has(f)) continue;
      scanObj(f.memoizedProps);
      scanObj(f.memoizedState);
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
      if (f.return) stack.push(f.return);
    }
    if (candidates.length === 0) return [];
    let best = null,
      bestLen = -1;
    for (const arr of candidates) {
      const live = arr.filter((x) => isLiveImage(x)).length;
      if (live > 0 && arr.length > bestLen) {
        bestLen = arr.length;
        best = arr;
      }
    }
    if (!best) return [];
    const out = [];
    best.forEach((img, i) => {
      const im = img;
      if (!isLiveImage(im)) return;
      const imageUrl = extractImageUrl(im);
      const videoUrl = extractVideoUrl(im.video);
      if (videoUrl) out.push({ index: i, imageUrl, videoUrl });
    });
    return out;
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
      "--disable-web-security",
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(DESKTOP_UA);
  await page.setViewport({ width: 1280, height: 800 });
  await page.setCacheEnabled(true);
  await page.goto("https://www.douyin.com/note/" + AID, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".dySwiperSlide") ||
        !!document.querySelector(".note-detail-container") ||
        !!document.querySelector("video"),
      { timeout: 8000 }
    );
  } catch {}
  await new Promise((r) => setTimeout(r, 800));
  const t0 = Date.now();
  const lives = await extractLivePhotosFromPage(page);
  console.log("RESULT count=", lives.length, "elapsed=", Date.now() - t0);
  console.log(JSON.stringify(lives.slice(0, 3), null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
