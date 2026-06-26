import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client if API key is present
let ai: GoogleGenAI | null = null;
const apiKey = process.env.GEMINI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (err) {
    console.error("Failed to initialize GoogleGenAI client:", err);
  }
}

// API: AI Dispatch Briefing Route
app.post("/api/dispatch-brief", async (req, res) => {
  const {
    startHubName,
    endHubName,
    totalDistance,
    totalDuration,
    boardedCount,
    waitingCount,
    absentCount,
    activeAlerts,
    buildingBreakdown,
    customSystemPrompt,
    temperature
  } = req.body;

  const prompt = `
    ${customSystemPrompt || "You are the 'Roxy Smart School Bus Dispatch Co-pilot' for Heliopolis Cairo school routes."}
    Analyze the current trip parameters and generate an efficient 3-sentence dispatch audio-ready brief in a friendly, professional tone.

    Current Trip Parameters:
    - Departure point: ${startHubName || 'Roxy Square'}
    - Destination: ${endHubName || 'St. Mary Church Complex'}
    - Planned route metrics: ${totalDistance?.toFixed(2) || '4.5'} km total, estimated ${totalDuration?.toFixed(1) || '15'} minutes.
    - Attendance summary: ${boardedCount || 0} students boarded, ${waitingCount || 0} waiting at upcoming stops, ${absentCount || 0} marked absent.
    - Active traffic alerts: ${JSON.stringify(activeAlerts || [])}
    - Classroom Target Buildings and count: ${JSON.stringify(buildingBreakdown || {})}
      (Note: 'hadra' building is for KG/Grade 1-2, 'wanas' building is for Grade 1-3, 'nagar' building is for Grade 4-6, 'demiana' is for girls/Rahab class, 'new' is for Prep girls).

    Guidelines for the dispatch brief:
    1. Assess the route start/end points and highlight if traffic conditions require starting from an alternative hub or taking a specific street.
    2. Suggest which children to take to class first (which building drop sequence) to optimize the teacher's drop-off flow (e.g. drop Hadra/KG first to avoid separation anxiety, or drop Nagar first to avoid blockage).
    3. Keep it to exactly 3 sentences. Be extremely objective, precise, and supportive. Use English language, but feel free to refer to Cairo street names (Selahdar, Mokrizi, Khalifa El Mamoun, Al Ashgar, Abu El Nour) naturally.
  `;

  // Fallback if AI is not configured or fails
  const fallbackBrief = `Roxy Dispatch Co-pilot status: Route is scheduled from ${startHubName || 'Roxy Square'} to ${endHubName || 'St. Mary Church Complex'} with ${boardedCount || 0} students onboard. Due to congestion on Khalifa El Mamoun, we suggest taking El Selahdar St and prioritizing dropping off KG students at the Anba Hadra building first, followed by Anba Wanas. Live navigation and traffic trackers are active to ensure an efficient trip.`;

  if (!ai) {
    return res.json({
      brief: fallbackBrief,
      isRealAI: false,
      message: "AI Dispatch Co-pilot is running in fallback mode. To enable dynamic Gemini briefs, please configure your GEMINI_API_KEY in the Settings > Secrets menu."
    });
  }

  const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
  let responseText = "";
  let successModel = "";
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Attempting briefing generation with model: ${modelName}`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: temperature !== undefined ? { temperature } : undefined
      });
      if (response && response.text) {
        responseText = response.text;
        successModel = modelName;
        break;
      }
    } catch (err: any) {
      console.warn(`Failed with model ${modelName}:`, err.message || err);
      lastError = err;
    }
  }

  if (responseText) {
    res.json({
      brief: responseText,
      isRealAI: true,
      modelUsed: successModel
    });
  } else {
    console.error("All Gemini models failed. Falling back to local template response. Last error:", lastError);
    res.json({
      brief: fallbackBrief,
      isRealAI: false,
      hasKeyButFailed: !!ai,
      error: lastError ? (lastError.message || JSON.stringify(lastError)) : "All selected Gemini models failed."
    });
  }
});

app.get("/api/resolve-maps", async (req, res) => {
  try {
    const response = await fetch("https://maps.app.goo.gl/hTUUoMkmw1D28ZaJ9", {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    res.json({ url: response.url });
  } catch (err: any) {
    res.json({ error: err.message });
  }
});

// Vite middleware setup or static production assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
