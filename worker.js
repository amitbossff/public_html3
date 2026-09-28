// ============================================================
// CONFIG
// ============================================================
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 3000;
const COMMENTS_PER_CALL = 30;

const ALL_API_KEYS = [
  'GROQ_API_1', 'GROQ_API_2', 'GROQ_API_3', 'GROQ_API_4', 'GROQ_API_5',
  'GROQ_API_6', 'GROQ_API_7', 'GROQ_API_8', 'GROQ_API_9', 'GROQ_API_10'
];

const KEYWORDS = [
  'earning apps',
  'online earning',
  'paise kamane wala app',
  'work from home',
  'free earning app',
  'gaming earning tricks',
  'slots game winning',
  'game winning strategy',
  'winning tricks',
  'jeetne ka tarika'
];

const TOPIC = 'earning';

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    if (hour === 18 && minute === 30) {
      ctx.waitUntil(resetFlags(env));
      return;
    }

    ctx.waitUntil(processBatch(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (action === 'reset') {
      return jsonResponse(await resetFlags(env));
    }

    if (action === 'keys-status') {
      return jsonResponse(await getKeysStatus(env));
    }

    if (action === 'status') {
      return jsonResponse(await getStatus(env));
    }

    return jsonResponse(await processBatch(env));
  }
};

// ============================================================
// KEYS STATUS — Kaunsi API Block Hai, Kaunsi Nahi
// ============================================================
async function getKeysStatus(env) {
  const keys = [];

  for (const keyName of ALL_API_KEYS) {
    const isBlocked = await env.API_DATA.get(`blocked_${keyName}`);
    const blockedAt = await env.API_DATA.get(`blocked_at_${keyName}`);

    keys.push({
      name: keyName,
      status: isBlocked === 'true' ? 'blocked' : 'active',
      blocked_at: blockedAt || null,
      has_key: !!env[keyName]
    });
  }

  const total = keys.length;
  const active = keys.filter(k => k.status === 'active').length;
  const blocked = keys.filter(k => k.status === 'blocked').length;
  const missing = keys.filter(k => !k.has_key).length;

  return {
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      total,
      active,
      blocked,
      missing
    },
    keys
  };
}

// ============================================================
// FLAG RESET
// ============================================================
async function resetFlags(env) {
  const deleted = [];
  for (const keyName of ALL_API_KEYS) {
    await env.API_DATA.delete(`blocked_${keyName}`);
    await env.API_DATA.delete(`blocked_at_${keyName}`);
    deleted.push(keyName);
  }
  console.log(`🔄 Reset at ${new Date().toISOString()}`);
  return {
    success: true,
    action: 'reset',
    reset: deleted,
    timestamp: new Date().toISOString()
  };
}

// ============================================================
// PROCESS BATCH
// ============================================================
async function processBatch(env) {
  const results = {
    success: true,
    timestamp: new Date().toISOString(),
    details: []
  };

  let totalAdded = 0;

  const availableKeys = await getAvailableKeys(env);

  if (availableKeys.length === 0) {
    return {
      success: false,
      error: 'All API keys blocked. Reset at midnight.',
      timestamp: new Date().toISOString()
    };
  }

  const shuffled = [...KEYWORDS].sort(() => Math.random() - 0.5);
  const selectedKeywords = shuffled.slice(0, 2);

  for (let i = 0; i < selectedKeywords.length; i++) {
    const keyword = selectedKeywords[i];
    const keyName = availableKeys[i % availableKeys.length];
    const apiKey = env[keyName];

    if (!apiKey) continue;

    try {
      const comments = await callGroq(keyword, TOPIC, apiKey);

      if (comments && comments.length > 0) {
        const saveResult = await saveToPHP(comments, TOPIC, env);
        totalAdded += comments.length;

        results.details.push({
          topic: TOPIC,
          keyword,
          key: keyName,
          generated: comments.length,
          saved: saveResult
        });
      }
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('rate_limit')) {
        await env.API_DATA.put(`blocked_${keyName}`, 'true', {
          expirationTtl: 86400
        });
        await env.API_DATA.put(`blocked_at_${keyName}`, new Date().toISOString(), {
          expirationTtl: 86400
        });
        console.log(`🚫 Blocked: ${keyName}`);
      }

      results.details.push({
        topic: TOPIC,
        keyword,
        key: keyName,
        error: e.message.substring(0, 200)
      });
    }

    if (i < selectedKeywords.length - 1) {
      await sleep(5000);
    }
  }

  results.total_added = totalAdded;
  return results;
}

// ============================================================
// AVAILABLE KEYS
// ============================================================
async function getAvailableKeys(env) {
  const available = [];
  for (const keyName of ALL_API_KEYS) {
    const isBlocked = await env.API_DATA.get(`blocked_${keyName}`);
    if (isBlocked !== 'true') {
      available.push(keyName);
    }
  }
  return available;
}

// ============================================================
// GROQ CALL
// ============================================================
async function callGroq(keyword, topic, apiKey) {
  const seed = Math.floor(Math.random() * 1000000);
  const ts = Date.now();

  const prompt = `Generate ${COMMENTS_PER_CALL} UNIQUE YouTube comments in Hinglish (Hindi + English mix) for a video about "${keyword}" (topic: ${topic}).

Random Seed: ${seed}-${ts}

STRICT RULES:
- Every comment MUST be unique
- ONLY POSITIVE comments (praise, thanks, appreciation)
- NO questions, NO complaints, NO feedback
- SHORT comments (5-12 words each)
- 1 emoji per comment (🔥 💰 👍 💯 ✅ 🎯 🎮)
- Sound like a real happy Indian YouTube user
- Return ONLY a valid JSON array of strings`;

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.95,
      max_tokens: MAX_TOKENS
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (!arrayMatch) throw new Error('No JSON array in response');

  const parsed = JSON.parse(arrayMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Not an array');

  const negativeWords = ['kya', 'kaise', 'kab', 'kahan', '?', 'low', 'outdated', 'request', 'suggest', 'improve', 'nahi', 'mat'];
  return parsed.filter(c => {
    if (typeof c !== 'string' || c.trim().length < 5) return false;
    const lower = c.toLowerCase();
    return !negativeWords.some(w => lower.includes(w));
  });
}

// ============================================================
// SAVE TO PHP
// ============================================================
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
    throw new Error(`PHP ${response.status}: ${err.substring(0, 200)}`);
  }

  return await response.json();
}

// ============================================================
// STATUS
// ============================================================
async function getStatus(env) {
  try {
    const resp = await fetch(
      `${env.PHP_API_URL}?action=status&secret=${env.PHP_SECRET}`
    );
    const data = await resp.json();
    return {
      success: true,
      php_status: data,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    };
  }
}

// ============================================================
// HELPERS
// ============================================================
function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}