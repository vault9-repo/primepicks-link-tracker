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

// Helpers for ES module __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- MongoDB ---
const client = new MongoClient(MONGO_URI);
let db, userClicks, counts;

async function connectDB() {
  await client.connect();
  db = client.db("primepicks");
  userClicks = db.collection("user_clicks");
  counts = db.collection("counts");
  await userClicks.createIndex({ userId: 1, linkId: 1, date: 1 }, { unique: true });
  console.log("✅ MongoDB connected");
}
connectDB().catch(console.error);

// --- Helper Functions ---
function getNairobiDateString() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const nairobiOffset = 3 * 60 * 60 * 1000;
  const nairobi = new Date(utc + nairobiOffset);
  return nairobi.toISOString().split("T")[0];
}

// --- API Routes ---
// Register visitor
app.post("/api/register", async (req, res) => {
  try {
    const userId = uuidv4();
    return res.json({ success: true, userId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success:false, message:"Server error" });
  }
});

// Track click
app.post("/api/click", async (req, res) => {
  const origin = req.headers.origin || "";
  if(origin.includes("localhost") || origin.includes("127.0.0.1")){
    return res.json({ success:false, message:"Localhost clicks ignored" });
  }

  const { userId, linkId, linkUrl } = req.body;
  if(!userId || !linkId || !linkUrl) return res.status(400).json({ success:false, message:"Missing parameters" });

  const date = getNairobiDateString();

  try {
    await userClicks.insertOne({ userId, linkId, linkUrl, date, timestamp: new Date() });
  } catch(e) {
    if(e.code === 11000) return res.json({ success:false, alreadyClicked:true });
    throw e;
  }

  await counts.updateOne(
    { linkId },
    { $inc:{ totalCount:1 }, $set:{ linkUrl } },
    { upsert:true }
  );

  return res.json({ success:true });
});

// Global stats
app.get("/api/stats", async (req,res)=>{
  try{
    const allCounts = await counts.find({}).toArray();
    const stats = {};
    allCounts.forEach(c => stats[c.linkId] = { totalCount: c.totalCount || 0, linkUrl: c.linkUrl });
    return res.json({ success:true, stats });
  }catch(err){
    console.error(err);
    return res.status(500).json({ success:false, message:"Server error" });
  }
});

// Which links clicked today by user
app.get("/api/hasClicked", async (req,res)=>{
  try{
    const userId = req.query.userId;
    if(!userId) return res.status(400).json({ success:false, message:"userId required" });
    const date = getNairobiDateString();
    const clicks = await userClicks.find({ userId, date }).toArray();
    const clickedLinks = clicks.map(c=>c.linkId);
    return res.json({ success:true, clickedLinks });
  }catch(err){
    console.error(err);
    return res.status(500).json({ success:false, message:"Server error" });
  }
});

// Catch-all for SPA frontend routing
app.get("*", (req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

// Start server
app.listen(PORT, ()=>console.log(`✅ Server running on http://localhost:${PORT}`));
