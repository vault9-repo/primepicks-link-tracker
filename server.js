import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- MongoDB Setup ---
const client = new MongoClient(MONGO_URI);
let db, userClicks, counts;

async function connectDB() {
  await client.connect();
  db = client.db("primepicks");
  userClicks = db.collection("user_clicks");
  counts = db.collection("counts");
  await userClicks.createIndex(
    { userId: 1, linkId: 1, date: 1 },
    { unique: true }
  );
  console.log("✅ MongoDB connected");
}
connectDB().catch(console.error);

// --- Helper: Nairobi Date ---
function getNairobiDateString() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const nairobiOffset = 3 * 60 * 60 * 1000;
  const nairobi = new Date(utc + nairobiOffset);
  return nairobi.toISOString().split("T")[0];
}

// --- Register visitor ---
app.post("/api/register", async (req, res) => {
  const userId = uuidv4();
  return res.json({ success: true, userId });
});

// --- Redirect & track clicks globally ---
app.get("/go/:linkId", async (req, res) => {
  const linkId = req.params.linkId;
  const links = {
    website: "https://primepickstip.onrender.com/",
    apk: "https://median.co/share/rdejjdb#apk",
    telegram: "https://t.me/primepicks254",
    facebook: "https://www.facebook.com/profile.php?id=61581288185889"
  };

  const linkUrl = links[linkId];
  if (!linkUrl) return res.status(404).send("Link not found");

  const userId = req.query.userId || "anonymous-" + uuidv4();
  const date = getNairobiDateString();

  try {
    await userClicks.insertOne({ userId, linkId, linkUrl, date, timestamp: new Date() });
    await counts.updateOne(
      { linkId },
      { $inc: { totalCount: 1 }, $set: { linkUrl } },
      { upsert: true }
    );
  } catch (e) {
    // Ignore duplicates (already clicked today)
  }

  res.redirect(linkUrl);
});

// --- Global stats ---
app.get("/api/stats", async (req, res) => {
  try {
    const allCounts = await counts.find({}).toArray();
    const stats = {};
    allCounts.forEach(c => stats[c.linkId] = { totalCount: c.totalCount || 0, linkUrl: c.linkUrl });
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- SPA catch-all ---
app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
