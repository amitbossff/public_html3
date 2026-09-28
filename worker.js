// ============================================================
// EARNING TEST - 1 API KEY
// ============================================================

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 6000;

const KEYWORDS = [
  'earning apps',
  'online earning',
  'paise kamane wala app',
  'work from home',
  'free earning app'
];

export default {
  async fetch(request, env) {
    const result = await generateEarning(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

async function generateEarning(env) {
  const apiKey = env.GROQ_EARNING_1;

  if (!apiKey) {
    return { error: 'GROQ_EARNING_1 not set in secrets' };
  }

  let totalAdded = 0;
  const details = [];

  for (const keyword of KEYWORDS) {
    try {
      const comments = await callGroq(keyword, apiKey, 25);
      const saveResult = await saveToPHP(comments, 'earning', env);
      totalAdded += comments.length;
      details.push({
        keyword,
        generated: comments.length,
        saved: saveResult
      });
    } catch (e) {
      details.push({
        keyword,
        error: e.message
      });
    }

    // Rate limit: 2 sec wait
    await sleep(2000);
  }

  return {
    success: true,
    topic: 'earning',
    total_added: totalAdded,
    details,
    timestamp: new Date().toISOString()
  };
}

async function callGroq(keyword, apiKey, count) {
  const prompt = `Generate ${count} UNIQUE YouTube comments about "${keyword}" in Hinglish (Hindi + English mix).

Rules:
- Each comment 15-25 words
- Mix styles: praise, thanks, question, feedback, personal experience
- Use 1-2 emojis per comment (🔥 💰 👍 💯 ✅ 🎯)
- Sound like a real Indian YouTube user
- NO repetition between comments
- Return ONLY a valid JSON array of strings, no markdown, no explanation

Example: ["Bhai video bahut helpful thi 🔥", "Nice explanation, keep it up 👍"]`;

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a YouTube comment generator. Return ONLY valid JSON arrays. No markdown, no extra text.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.95,
      max_tokens: MAX_TOKENS
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from Groq');
  }

  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error('No JSON array: ' + content.substring(0, 100));
  }

  const parsed = JSON.parse(arrayMatch[0]);

  if (!Array.isArray(parsed)) {
    throw new Error('Not an array');
  }

  return parsed.filter(c => typeof c === 'string' && c.trim().length > 10);
}

async function saveToPHP(comments, topic, env) {
  const formData = new URLSearchParams();
  formData.append('action', 'save');
  formData.append('secret', env.PHP_SECRET);
  formData.append('topic', topic);
  formData.append('comments', JSON.stringify(comments));

  const response = await fetch(env.PHP_API_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PHP ${response.status}: ${err.substring(0, 300)}`);
  }

  return await response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}