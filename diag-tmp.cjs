const puppeteer = require("puppeteer-core");
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const AID = process.argv[2];
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
  try {
    await page.goto("https://www.douyin.com/note/" + AID, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
  } catch (e) {
    console.log("GOTO ERR", e.message);
  }
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".dySwiperSlide") ||
        !!document.querySelector(".note-detail-container") ||
        !!document.querySelector("video"),
      { timeout: 8000 }
    );
  } catch {}
  await new Promise((r) => setTimeout(r, 1500));
  const diag = await page.evaluate(() => {
    const out = {
      dySwiper: !!document.querySelector(".dySwiperSlide"),
      noteDetail: !!document.querySelector(".note-detail-container"),
      classes: {},
      totalClipType: 0,
      totalLivePhotoType: 0,
      totalDouyinvod: 0,
      sampleImage: null,
      sampleVideo: null,
    };
    const kws = ["swiper", "slide", "note", "album", "slider", "note-detail"];
    document.querySelectorAll("*").forEach((el) => {
      const c = el.className;
      if (typeof c === "string")
        for (const k of kws)
          if (c.toLowerCase().includes(k)) out.classes[c] = (out.classes[c] || 0) + 1;
    });
    const visited = new Set();
    const stack = [];
    const seed =
      document.querySelector(".dySwiperSlide") ||
      document.querySelector(".note-detail-container") ||
      document.querySelector("video") ||
      document.body;
    if (seed) {
      const k = Object.keys(seed).find((x) => x.startsWith("__reactFiber"));
      if (k) stack.push(seed[k]);
    }
    let n = 0;
    while (stack.length && n < 800000) {
      const f = stack.pop();
      n++;
      if (!f || typeof f !== "object" || visited.has(f)) continue;
      visited.add(f);
      const props = f.memoizedProps;
      if (props && typeof props === "object") {
        const walk = (o, depth) => {
          if (!o || typeof o !== "object" || depth > 40) return;
          if (Array.isArray(o)) {
            o.forEach((x) => walk(x, depth + 1));
            return;
          }
          if (visited.has(o)) return;
          visited.add(o);
          for (const k of Object.keys(o)) {
            if (k.startsWith("__react")) continue;
            const v = o[k];
            if (k === "clipType") out.totalClipType++;
            if (k === "livePhotoType") out.totalLivePhotoType++;
            if (typeof v === "string") {
              if (v.includes("douyinvod")) out.totalDouyinvod++;
            } else if (v && typeof v === "object") {
              if (k === "urlList" && Array.isArray(v) && v.length && typeof v[0] === "string") {
                if (out.sampleImage === null) {
                  out.sampleImage = {
                    keys: Object.keys(o).slice(0, 40),
                    clipType: o.clipType,
                    livePhotoType: o.livePhotoType,
                    hasVideo: !!o.video,
                    videoKeys:
                      o.video && typeof o.video === "object"
                        ? Object.keys(o.video).slice(0, 20)
                        : null,
                  };
                }
              }
              walk(v, depth + 1);
            }
          }
        };
        walk(props, 0);
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
      if (f.return) stack.push(f.return);
    }
    return out;
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
