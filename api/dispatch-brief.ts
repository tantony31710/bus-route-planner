import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  // Request body size limit
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr.length > 8000) {
    return res.status(413).json({ error: 'Request payload too large' });
  }

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

  // Input validation & sanitization
  const MAX_STRING_LENGTH = 500;
  const sanitizeStr = (s: any, maxLen = MAX_STRING_LENGTH): string => {
    if (typeof s !== 'string') return '';
    return s.replace(/<[^>]*>/g, '').replace(/[<>"'`]/g, '').trim().slice(0, maxLen);
  };
  const sanitizeNum = (n: any, min = 0, max = 9999): number => {
    const parsed = parseFloat(n);
    return isNaN(parsed) ? 0 : Math.min(max, Math.max(min, parsed));
  };

  const safeStartHub = sanitizeStr(startHubName);
  const safeEndHub = sanitizeStr(endHubName);
  const safeDist = sanitizeNum(totalDistance, 0, 200);
  const safeDuration = sanitizeNum(totalDuration, 0, 480);
  const safeBoarded = sanitizeNum(boardedCount, 0, 100);
  const safeWaiting = sanitizeNum(waitingCount, 0, 100);
  const safeAbsent = sanitizeNum(absentCount, 0, 100);
  const safeTemp = sanitizeNum(temperature, 0, 1);

  const safeAlerts = Array.isArray(activeAlerts)
    ? activeAlerts.slice(0, 10).map((a: any) => ({
        streetName: sanitizeStr(a?.streetName, 100),
        severity: ['moderate', 'severe'].includes(a?.severity) ? a.severity : 'moderate',
        message: sanitizeStr(a?.message, 200)
      }))
    : [];

  const fallbackBrief = `Roxy Dispatch Co-pilot status: Route is scheduled from ${safeStartHub || 'Roxy Square'} to ${safeEndHub || 'St. Mary Church Complex'} with ${safeBoarded || 0} students onboard. Due to congestion on Khalifa El Mamoun, we suggest taking El Selahdar St and prioritizing dropping off KG students at the Anba Hadra building first, followed by Anba Wanas. Live navigation and traffic trackers are active to ensure an efficient trip.`;

  const systemPrompt = customSystemPrompt || "You are the 'Roxy Smart School Bus Dispatch Co-pilot' for Heliopolis Cairo school routes.";

  const userPrompt = `${systemPrompt}
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
3. Keep it to exactly 3 sentences. Be extremely objective, precise, and supportive. Use English language, but feel free to refer to Cairo street names (Selahdar, Mokrizi, Khalifa El Mamoun, Al Ashgar, Abu El Nour) naturally.`;

  // Try Anthropic Claude API
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          temperature: temperature ?? 0.4,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text;
        if (text) {
          return res.json({ brief: text, isRealAI: true, modelUsed: 'claude-haiku-4-5' });
        }
      } else {
        const errText = await response.text();
        console.error('Anthropic API error:', response.status, errText);
      }
    } catch (err: any) {
      console.error('Anthropic fetch failed:', err.message);
    }
  }

  // Try Gemini API as secondary option
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
    // Valid Gemini model names as of 2025
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];
    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: temperature ?? 0.4, maxOutputTokens: 300 }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return res.json({ brief: text, isRealAI: true, modelUsed: modelName });
          }
        }
      } catch (err: any) {
        console.warn(`Gemini model ${modelName} failed:`, err.message);
      }
    }
  }

  // Fallback
  return res.json({
    brief: fallbackBrief,
    isRealAI: false,
    message: 'AI Dispatch running in fallback mode. Add ANTHROPIC_API_KEY or GEMINI_API_KEY in Vercel project settings to enable live AI briefs.'
  });
}
