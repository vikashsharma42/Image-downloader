Image Downloader (Puppeteer + Socket.IO) — Full Documentation
#Overview

This project is a real-time web-based image downloader that scrapes images from a given gallery URL, downloads them to a local folder, and shows live progress in a modern web UI.

It uses web scraping + real-time socket communication to create a live download dashboard similar to a SaaS application.

⚙️ Technologies Used
Backend
Node.js (Runtime)
Express.js (Web server)
Socket.IO (Real-time communication)
Puppeteer (Headless browser automation & scraping)
Axios (HTTP image downloading)
FS module (File system handling)
Path module (File path management)
Frontend
HTML5
CSS3 (Dark modern UI design)
JavaScript (Vanilla JS)
Socket.IO Client
🧠 How It Works (Architecture)
1. Client Input

User enters a gallery URL in the frontend UI and clicks "Start".

2. Socket Connection

Frontend sends event:

start-download → server
3. Browser Automation (Puppeteer)

Server:

Opens headless Chromium
Loads the provided URL
Scrolls page automatically to load lazy images
4. Image Extraction

The system extracts images from:

<img> tags
data-src attributes
CSS background-image

All URLs are stored in a Set to avoid duplicates.

5. Download Process

Each image is:

Downloaded using Axios stream
Saved into /downloads folder
Renamed into structured format:
saadi-image-1.jpg
saadi-image-2.png
6. Real-Time Updates (Socket.IO)

Server sends live updates:

status updates (launching, scraping, downloading)
total images found
progress updates (current/total)
completion event
📡 Socket Events
From Client → Server
start-download

Payload:

{
  "url": "https://example.com/gallery"
}
From Server → Client
status
Launching browser...
Scrolling page...
Downloading images...
total
1054
progress
{
  "current": 120,
  "total": 1054
}
completed
134
done-reset

Used to re-enable UI button and reset state.

📁 File Structure
project/
│
├── server.js
├── package.json
├── downloads/          (auto-created)
│
└── public/
    └── index.html
🔄 Workflow Summary
User enters URL
Puppeteer opens page
Page scrolls automatically
Images extracted
Images downloaded via Axios
Progress sent via Socket.IO
Files saved locally
UI updates in real time
📦 Output Example
downloads/
 ├── saadi-image-1.jpg
 ├── saadi-image-2.png
 ├── saadi-image-3.webp
⚡ Key Features
Real-time download tracking
Automatic infinite scroll scraping
Duplicate image filtering
Dynamic progress bar
Clean UI dashboard
Automatic file naming
Error handling for failed downloads
⚠️ Limitations
Some websites block scraping (hotlink protection)
Blob URLs cannot be downloaded
Lazy-loaded images may not always be captured
No retry mechanism for failed downloads (can be improved)
🚀 Possible Improvements
Retry failed downloads automatically
Multi-threaded downloads (faster performance)
ZIP file export after completion
Cloud deployment (Render / VPS)
Login system for users
Download speed tracking
Smart gallery title detection
🧪 Development Notes
Uses headless Chromium (Puppeteer)
Uses streaming downloads (memory efficient)
Uses Socket.IO for low-latency UI updates
Uses Set() to remove duplicate images
🏁 Conclusion

This project demonstrates a real-time scraping + download system using modern Node.js
