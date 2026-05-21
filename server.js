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

app.use(express.static("public"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IMPROVED SCROLLING FOR LAZY-LOADED IMAGES
async function autoScroll(page, socket) {
  let previousHeight = 0;
  let noChangeCount = 0;
  const maxNoChange = 5; // Stop after 5 scrolls with no new content
  let scrollCount = 0;

  socket.emit("status", "Loading images (this may take a while)...");

  while (noChangeCount < maxNoChange) {
    scrollCount++;
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      noChangeCount++;
      socket.emit("status", `Loading complete (${scrollCount} scrolls)...`);
    } else {
      noChangeCount = 0;
    }

    // Scroll down
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));

    // Wait for lazy-loaded content to render
    await sleep(2000);

    previousHeight = currentHeight;
  }

  // Go back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
}

// BETTER IMAGE EXTRACTION
async function extractAllImages(page) {
  return await page.evaluate(() => {
    const urls = new Set();

    // 1. Extract from img src attributes
    document.querySelectorAll("img").forEach((img) => {
      if (img.src && img.src.trim()) urls.add(img.src);
      if (img.dataset.src && img.dataset.src.trim()) urls.add(img.dataset.src);
    });

    // 2. Extract from lazy-loading attributes
    document.querySelectorAll("[data-src]").forEach((el) => {
      if (el.dataset.src && el.dataset.src.trim()) urls.add(el.dataset.src);
    });

    // 3. Extract from background images
    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        const match = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1]) urls.add(match[1]);
      }
    });

    // 4. Extract from picture elements
    document.querySelectorAll("picture source").forEach((source) => {
      if (source.srcset) {
        const urls_from_srcset = source.srcset.split(",").map((item) => {
          return item.split(" ")[0].trim();
        });
        urls_from_srcset.forEach((url) => {
          if (url) urls.add(url);
        });
      }
    });

    // Filter out invalid URLs
    return Array.from(urls).filter(
      (url) =>
        url &&
        (url.startsWith("http") ||
          url.startsWith("//") ||
          url.startsWith("/") ||
          url.startsWith("data:")),
    );
  });
}

io.on("connection", (socket) => {
  socket.on("start-download", async (galleryUrl) => {
    let browser;

    try {
      socket.emit("status", "Launching browser...");

      browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });

      const page = await browser.newPage();

      // Set realistic user agent
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      );

      socket.emit("status", "Navigating to gallery...");
      await page.goto(galleryUrl, {
        waitUntil: "networkidle2",
        timeout: 0,
      });

      // Wait for images to start loading
      await sleep(2000);

      // SCROLL AND LOAD ALL IMAGES
      await autoScroll(page, socket);

      socket.emit("status", "Extracting image URLs...");
      let imageUrls = await extractAllImages(page);

      // Remove duplicates
      imageUrls = [...new Set(imageUrls)];

      socket.emit("total", imageUrls.length);
      socket.emit("status", `Found ${imageUrls.length} images`);

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
      const baseName = "saadi-image";

      socket.emit("status", "Downloading images...");

      for (let i = 0; i < imageUrls.length; i++) {
        let imgUrl = imageUrls[i];

        try {
          // Handle protocol-relative URLs
          if (imgUrl.startsWith("//")) {
            imgUrl = "https:" + imgUrl;
          }

          // Skip data URLs
          if (imgUrl.startsWith("data:")) {
            continue;
          }

          const response = await axios({
            url: imgUrl,
            method: "GET",
            responseType: "stream",
            timeout: 20000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: galleryUrl,
            },
            maxRedirects: 5,
          });

          // Check content type
          const contentType = response.headers["content-type"];
          if (!contentType || !contentType.includes("image")) {
            continue;
          }

          downloaded++;

          // Extract file extension
          const cleanUrl = imgUrl.split("?")[0];
          let ext = ".jpg";

          const extMatch = cleanUrl.match(/\.(jpg|jpeg|png|webp|gif|bmp)/i);
          if (extMatch) {
            ext = "." + extMatch[1].toLowerCase();
          } else if (contentType.includes("webp")) {
            ext = ".webp";
          } else if (contentType.includes("png")) {
            ext = ".png";
          } else if (contentType.includes("gif")) {
            ext = ".gif";
          }

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
          // Silent fail for individual image errors
          console.log(`Failed to download: ${imgUrl}`);
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
      console.log("Error:", err.message);

      socket.emit("status", "Error occurred: " + err.message);
      socket.emit("done-reset");

      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
