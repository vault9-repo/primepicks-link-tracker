/**
 * server.js
 * Express server for PrimePicks link tracker.
 *
 * Endpoints:
 *  - POST /api/register    -> { userId }
 *  - POST /api/click       -> { success, alreadyClicked?, totalCount? }
 *     body: { userId, linkId, linkUrl }
 *  - GET  /api/stats       -> { success, stats: { <linkId>: { linkUrl, totalCount } } }
 *
 * Serves static files from /public
 */

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;

if (!MONGO_URI) {
  console.error("Missing MONGO_URI in environment. See .env.example");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = new MongoClient(MONGO_URI, {});

function getNairobiDateString() {
  // Returns YYYY-MM-DD for Africa/Nairobi (local day)
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

async function start() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("primepicks_linktracker");
    const userClicks = db.collection("user_clicks");
    const counts = db.collection("counts");

    // Ensure indexes
    await userClicks.createIndex({ userId: 1, linkId: 1, date: 1 }, { unique: true });
    await counts.createIndex({ linkId: 1 }, { unique: true });

    // Register endpoint - returns uuid for the browser if it doesn't have one
    app.post("/api/register", (req, res) => {
      const id = uuidv4();
      return res.json({ userId: id });
    });

    // Record a click
    app.post("/api/click", async (req, res) => {
      try {
        const { userId, linkId, linkUrl } = req.body || {};

        if (!userId || !linkId || !linkUrl) {
          return res.status(400).json({ success: false, message: "userId, linkId and linkUrl are required" });
        }

        const date = getNairobiDateString();
        const ts = new Date();

        // Try to insert record into user_clicks. Unique index will prevent duplicates.
        try {
          await userClicks.insertOne({ userId, linkId, linkUrl, date, ts });
        } catch (err) {
          // Duplicate key => user already clicked this link today
          if (err && err.code === 11000) {
            return res.json({ success: false, alreadyClicked: true, message: "Already clicked today" });
          }
          console.error("user_clicks insert error:", err);
          return res.status(500).json({ success: false, message: "DB insert error" });
        }

        // Atomically increment the global count for this link
        const updateRes = await counts.findOneAndUpdate(
          { linkId },
          { $inc: { totalCount: 1 }, $setOnInsert: { linkId, linkUrl, createdAt: ts } },
          { upsert: true, returnDocument: "after" }
        );

        const totalCount = updateRes.value ? updateRes.value.totalCount : 1;

        return res.json({ success: true, alreadyClicked: false, totalCount });
      } catch (err) {
        console.error("/api/click error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Get stats
    app.get("/api/stats", async (req, res) => {
      try {
        // Optional filter by linkIds comma separated ?links=website,apk
        const linksQuery = req.query.links;
        const filter = linksQuery ? { linkId: { $in: linksQuery.split(",") } } : {};
        const docs = await counts.find(filter).toArray();
        const stats = {};
        docs.forEach(d => {
          stats[d.linkId] = { linkUrl: d.linkUrl, totalCount: d.totalCount || 0, createdAt: d.createdAt };
        });
        return res.json({ success: true, stats, fetchedAt: new Date() });
      } catch (err) {
        console.error("/api/stats error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Optional: endpoint to view recent click logs (admin) - limited to 200 entries
    app.get("/api/recent", async (req, res) => {
      try {
        const docs = await db.collection("user_clicks")
          .find({})
          .sort({ ts: -1 })
          .limit(200)
          .toArray();
        return res.json({ success: true, recent: docs });
      } catch (err) {
        console.error("/api/recent error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });

  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
