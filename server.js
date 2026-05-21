const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- SCROLL FUNCTION ---------------- */
async function autoScroll(page, socket) {
  let previousHeight = 0;
  let noChangeCount = 0;
  const maxNoChange = 5;
  let scrollCount = 0;

  socket.emit("status", "Loading images...");

  while (noChangeCount < maxNoChange) {
    scrollCount++;
    socket.emit("status", `Loading complete (${scrollCount} scrolls)...`);

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      noChangeCount++;
    } else {
      noChangeCount = 0;
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await sleep(2000);

    previousHeight = currentHeight;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
}

/* ---------------- IMAGE EXTRACTION ---------------- */
async function extractAllImages(page) {
  return await page.evaluate(() => {
    const urls = new Set();

    document.querySelectorAll("img").forEach((img) => {
      if (img.src) urls.add(img.src);
      if (img.dataset.src) urls.add(img.dataset.src);
    });

    document.querySelectorAll("[data-src]").forEach((el) => {
      if (el.dataset.src) urls.add(el.dataset.src);
    });

    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        const match = style.backgroundImage.match(/url\\(["']?(.*?)["']?\\)/);
        if (match && match[1]) urls.add(match[1]);
      }
    });

    return Array.from(urls).filter((url) => url);
  });
}

/* ---------------- SOCKET ---------------- */
io.on("connection", (socket) => {
  socket.on("start-download", async (galleryUrl) => {
    let browser;

    try {
      socket.emit("status", "Launching browser...");

      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });

      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      );

      socket.emit("status", "Opening page...");
      await page.goto(galleryUrl, {
        waitUntil: "networkidle2",
        timeout: 0,
      });

      await sleep(2000);

      await autoScroll(page, socket);

      socket.emit("status", "Extracting images...");
      let imageUrls = await extractAllImages(page);

      imageUrls = [...new Set(imageUrls)];

      socket.emit("total", imageUrls.length);

      if (imageUrls.length === 0) {
        socket.emit("status", "No images found");
        socket.emit("done-reset");
        await browser.close();
        return;
      }

      if (!fs.existsSync("downloads")) {
        fs.mkdirSync("downloads");
      }

      let downloaded = 0;
      const baseName = "image";

      for (let i = 0; i < imageUrls.length; i++) {
        let imgUrl = imageUrls[i];

        try {
          if (imgUrl.startsWith("//")) {
            imgUrl = "https:" + imgUrl;
          }

          if (imgUrl.startsWith("data:")) continue;

          const response = await axios({
            url: imgUrl,
            method: "GET",
            responseType: "stream",
            timeout: 20000,
            headers: {
              Referer: galleryUrl,
            },
          });

          const contentType = response.headers["content-type"];
          if (!contentType || !contentType.includes("image")) continue;

          downloaded++;

          let ext = ".jpg";
          if (contentType.includes("png")) ext = ".png";
          if (contentType.includes("webp")) ext = ".webp";
          if (contentType.includes("gif")) ext = ".gif";

          const filename = `${baseName}-${downloaded}${ext}`;
          const filepath = path.join("downloads", filename);

          const writer = fs.createWriteStream(filepath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
          });

          socket.emit("progress", {
            current: downloaded,
            total: imageUrls.length,
          });
        } catch (err) {
          console.log("Skip image:", imgUrl);
        }
      }

      // SAFE BROWSER CLEANUP
      try {
        await browser.close();
      } catch (e) {}

      socket.emit("status", "Finalizing...");
      socket.emit("progress", {
        current: imageUrls.length,
        total: imageUrls.length,
      });

      socket.emit("completed", downloaded);
      socket.emit("done-reset");
    } catch (err) {
      console.log("ERROR:", err.message);

      socket.emit("status", "Error: " + err.message);
      socket.emit("done-reset");

      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
