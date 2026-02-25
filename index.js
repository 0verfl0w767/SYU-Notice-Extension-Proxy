const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");

const app = express();
app.use(cors());
app.set("trust proxy", true);

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function nowStr() {
  return formatDate(new Date());
}

app.use(async (req, res, next) => {
  const now = nowStr();
  const forwarded = req.headers["x-forwarded-for"];
  const userIP = forwarded
    ? forwarded.split(",")[0].trim()
    : req.ip || (req.socket && req.socket.remoteAddress) || "unknown";

  const logLine = `[${now}] ${req.method} ${req.originalUrl} - From: ${userIP}`;
  console.log(logLine);
  const logFile = path.join(__dirname, "server.log");
  try {
    await fs.promises.appendFile(logFile, `${logLine}\n`);
  } catch (err) {
    console.error(`[${now}] Failed to write log: ${err.message}`);
  }
  next();
});

const NOTICE_URLS = {
  academic: "https://www.syu.ac.kr/academic/academic-notice/",
  event: "https://www.syu.ac.kr/university-square/notice/event/",
  scholarship:
    "https://www.syu.ac.kr/academic/scholarship-information/scholarship-notice/",
};

const CACHE_TTL_SEC = 60 * 60;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redisClient = createClient({ url: REDIS_URL });
redisClient.on("error", (err) => {
  console.error(`[${nowStr()}] Redis error: ${err.message}`);
});
redisClient
  .connect()
  .then(() => console.log(`[${nowStr()}] Redis connected: ${REDIS_URL}`))
  .catch((err) =>
    console.error(`[${nowStr()}] Redis connect failed: ${err.message}`),
  );

app.get("/notices/:type", async (req, res) => {
  try {
    const noticeType = req.params.type;
    const url = NOTICE_URLS[noticeType];

    if (!url) {
      console.log(
        `[${nowStr()}] Invalid notice type requested: ${noticeType} from ${req.ip}`,
      );
      return res.status(400).json({ ok: false, error: "Invalid notice type" });
    }

    if (redisClient.isReady) {
      const cacheKey = `notice:${noticeType}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ ok: true, html: cached, cached: true });
      }
    }

    console.log(`[${nowStr()}] Fetching URL: ${url} for user ${req.ip}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = await response.text();

    console.log(
      `[${nowStr()}] Fetched ${html.length} characters from ${url} for ${req.ip}`,
    );

    if (redisClient.isReady) {
      const cacheKey = `notice:${noticeType}`;
      await redisClient.setEx(cacheKey, CACHE_TTL_SEC, html);
    }

    res.json({ ok: true, html, cached: false });
  } catch (err) {
    console.error(
      `[${nowStr()}] Error fetching notice for ${req.ip}: ${err.message}`,
    );
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(9090, () => {
  console.log(`[${nowStr()}] Proxy running on http://localhost:9090`);
});
