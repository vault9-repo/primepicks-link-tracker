import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- MongoDB setup ---
const client = new MongoClient(MONGO_URI);
let db, userClicks, counts;

async function connectDB() {
  await client.connect();
  db = client.db("primepicks");
  userClicks = db.collection("user_clicks");
  counts = db.collection("counts");

  // Ensure unique index per user per link per day
  await userClicks.createIndex({ userId: 1, linkId: 1, date: 1 }, { unique: true });
}
connectDB().catch(console.error);

// --- Helper: Nairobi date string ---
function getNairobiDateString() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const nairobiOffset = 3 * 60 * 60 * 1000;
  const nairobi = new Date(utc + nairobiOffset);
  return nairobi.toISOString().split("T")[0]; // YYYY-MM-DD
}

// --- Register visitor ---
app.post("/api/register", async (req, res) => {
  try {
    const userId = uuidv4();
    return res.json({ success: true, userId });
  } catch (err) {
    console.error("/api/register error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Track click ---
app.post("/api/click", async (req, res) => {
  try {
    const { userId, linkId, linkUrl } = req.body;
    if (!userId || !linkId || !linkUrl) {
      return res.status(400).json({ success: false, message: "Missing parameters" });
    }

    const date = getNairobiDateString();

    // Insert into user_clicks (will fail if already clicked today)
    try {
      await userClicks.insertOne({ userId, linkId, linkUrl, date, timestamp: new Date() });
    } catch (e) {
      // Duplicate key error = already clicked today
      if (e.code === 11000) {
        return res.json({ success: false, alreadyClicked: true });
      }
      throw e;
    }

    // Increment global count
    await counts.updateOne(
      { linkId },
      { $inc: { totalCount: 1 }, $set: { linkUrl } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("/api/click error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Global stats ---
app.get("/api/stats", async (req, res) => {
  try {
    const allCounts = await counts.find({}).toArray();
    const stats = {};
    allCounts.forEach(c => {
      stats[c.linkId] = { totalCount: c.totalCount || 0, linkUrl: c.linkUrl };
    });
    return res.json({ success: true, stats });
  } catch (err) {
    console.error("/api/stats error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Which links this user clicked today ---
app.get("/api/hasClicked", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const date = getNairobiDateString();
    const clicks = await userClicks.find({ userId, date }).toArray();
    const clickedLinks = clicks.map(c => c.linkId);
    return res.json({ success: true, clickedLinks });
  } catch (err) {
    console.error("/api/hasClicked error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
