// ============================================================
// CONFIG
// ============================================================
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 3000;
const COMMENTS_PER_CALL = 30;
const ADMIN_PASSWORD = 'amittg_admin_2024';

const KEYWORDS = [
  'earning apps', 'online earning', 'paise kamane wala app', 'work from home', 'free earning app',
  'gaming earning tricks', 'slots game winning', 'game winning strategy', 'winning tricks', 'jeetne ka tarika'
];

const TOPIC = 'earning';

// ============================================================
// MAIN
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

    ctx.waitUntil(processBatch(env, event.cron));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const adminActions = ['keys-list', 'key-add', 'key-delete', 'keys-status', 'reset', 'logs', 'logs-clear'];
    if (adminActions.includes(action)) {
      const pass = url.searchParams.get('pass');
      if (pass !== ADMIN_PASSWORD) return jsonResponse({ error: 'Unauthorized' }, 403);
    }

    switch (action) {
      case 'reset': return jsonResponse(await resetFlags(env));
      case 'keys-status': return jsonResponse(await getKeysStatus(env));
      case 'keys-list': return jsonResponse(await listKeys(env));
      case 'key-add': return jsonResponse(await addKey(request, env));
      case 'key-delete': return jsonResponse(await deleteKey(request, env));
      case 'logs': return jsonResponse(await getLogs(env));
      case 'logs-clear': return jsonResponse(await clearLogs(env));
      case 'status': return jsonResponse(await getStatus(env));
      default: return jsonResponse(await processBatch(env, 'manual'));
    }
  }
};

// ============================================================
// LOGS
// ============================================================
async function addLog(env, logEntry) {
  let logs = await env.API_DATA.get('cron_logs', { type: 'json' }) || [];
  logs.unshift({ time: new Date().toISOString(), ...logEntry });
  if (logs.length > 50) logs = logs.slice(0, 50);
  await env.API_DATA.put('cron_logs', JSON.stringify(logs), { expirationTtl: 604800 });
}

async function getLogs(env) {
  const logs = await env.API_DATA.get('cron_logs', { type: 'json' }) || [];
  return { success: true, total: logs.length, logs };
}

async function clearLogs(env) {
  await env.API_DATA.delete('cron_logs');
  return { success: true, message: 'Logs cleared' };
}

// ============================================================
// PROCESS
// ============================================================
async function processBatch(env, cronInfo = 'unknown') {
  const startTime = Date.now();
  const results = { success: true, timestamp: new Date().toISOString(), cron: cronInfo, details: [] };
  let totalAdded = 0;

  const availableKeys = await getAvailableKeys(env);
  if (availableKeys.length === 0) {
    await addLog(env, { cron: cronInfo, status: 'error', error: 'All keys blocked' });
    return { success: false, error: 'All API keys blocked', timestamp: new Date().toISOString() };
  }

  const shuffled = [...KEYWORDS].sort(() => Math.random() - 0.5);
  const selectedKeywords = shuffled.slice(0, 2);

  for (let i = 0; i < selectedKeywords.length; i++) {
    const keyword = selectedKeywords[i];
    const keyName = availableKeys[i % availableKeys.length];
    const apiKey = await env.API_DATA.get(`key_value_${keyName}`);
    if (!apiKey) continue;

    try {
      const comments = await callGroq(keyword, TOPIC, apiKey);
      if (comments && comments.length > 0) {
        const saveResult = await saveToPHP(comments, TOPIC, env);
        totalAdded += comments.length;
        results.details.push({ topic: TOPIC, keyword, key: keyName, generated: comments.length, saved: saveResult });
      }
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('rate_limit')) {
        await env.API_DATA.put(`blocked_${keyName}`, 'true', { expirationTtl: 86400 });
        await env.API_DATA.put(`blocked_at_${keyName}`, new Date().toISOString(), { expirationTtl: 86400 });
        await addLog(env, { cron: cronInfo, status: 'key_blocked', key: keyName });
      }
      results.details.push({ topic: TOPIC, keyword, key: keyName, error: e.message.substring(0, 200) });
    }
    if (i < selectedKeywords.length - 1) await sleep(5000);
  }

  results.total_added = totalAdded;
  results.duration_ms = Date.now() - startTime;

  await addLog(env, {
    cron: cronInfo,
    status: totalAdded > 0 ? 'success' : 'no_comments',
    keywords: selectedKeywords,
    total_added: totalAdded,
    duration_ms: results.duration_ms
  });

  return results;
}

// ============================================================
// ADMIN
// ============================================================
async function listKeys(env) {
  const keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  const keys = [];
  for (const keyName of keysList) {
    const value = await env.API_DATA.get(`key_value_${keyName}`);
    const isBlocked = await env.API_DATA.get(`blocked_${keyName}`);
    const blockedAt = await env.API_DATA.get(`blocked_at_${keyName}`);
    keys.push({
      name: keyName,
      value: value ? maskKey(value) : null,
      status: isBlocked === 'true' ? 'blocked' : 'active',
      blocked_at: blockedAt || null
    });
  }
  return { success: true, total: keys.length, keys };
}

async function addKey(request, env) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const value = url.searchParams.get('value');

  if (!name || !value) return { error: 'name and value required' };
  if (!name.startsWith('GROQ_API_')) return { error: 'Name must start with GROQ_API_' };
  if (!value.startsWith('gsk_')) return { error: 'Invalid Groq key format' };

  let keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  if (!keysList.includes(name)) {
    keysList.push(name);
    await env.API_DATA.put('keys_list', JSON.stringify(keysList));
  }
  await env.API_DATA.put(`key_value_${name}`, value);
  await addLog(env, { status: 'key_added', key: name });
  return { success: true, action: 'add', name };
}

async function deleteKey(request, env) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return { error: 'name required' };

  let keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  keysList = keysList.filter(k => k !== name);
  await env.API_DATA.put('keys_list', JSON.stringify(keysList));
  await env.API_DATA.delete(`key_value_${name}`);
  await env.API_DATA.delete(`blocked_${name}`);
  await env.API_DATA.delete(`blocked_at_${name}`);
  await addLog(env, { status: 'key_deleted', key: name });
  return { success: true, action: 'delete', name };
}

async function getKeysStatus(env) {
  const keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  const keys = [];
  for (const keyName of keysList) {
    const isBlocked = await env.API_DATA.get(`blocked_${keyName}`);
    const blockedAt = await env.API_DATA.get(`blocked_at_${keyName}`);
    keys.push({ name: keyName, status: isBlocked === 'true' ? 'blocked' : 'active', blocked_at: blockedAt || null });
  }
  const active = keys.filter(k => k.status === 'active').length;
  const blocked = keys.filter(k => k.status === 'blocked').length;
  return { success: true, timestamp: new Date().toISOString(), summary: { total: keys.length, active, blocked }, keys };
}

async function resetFlags(env) {
  const keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  const deleted = [];
  for (const keyName of keysList) {
    await env.API_DATA.delete(`blocked_${keyName}`);
    await env.API_DATA.delete(`blocked_at_${keyName}`);
    deleted.push(keyName);
  }
  await addLog(env, { status: 'flags_reset', count: deleted.length });
  return { success: true, action: 'reset', reset: deleted, timestamp: new Date().toISOString() };
}

async function getAvailableKeys(env) {
  const keysList = await env.API_DATA.get('keys_list', { type: 'json' }) || [];
  const available = [];
  for (const keyName of keysList) {
    const isBlocked = await env.API_DATA.get(`blocked_${keyName}`);
    if (isBlocked !== 'true') available.push(keyName);
  }
  return available;
}

// ============================================================
// GROQ
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
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
    headers: { 'X-Worker-Auth': env.WORKER_SECRET },
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PHP ${response.status}: ${err.substring(0, 200)}`);
  }
  return await response.json();
}

// ============================================================
// HELPERS
// ============================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function maskKey(key) {
  if (!key || key.length < 12) return '***';
  return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

async function getStatus(env) {
  try {
    const resp = await fetch(`${env.PHP_API_URL}?action=status&secret=${env.PHP_SECRET}`, {
      headers: { 'X-Worker-Auth': env.WORKER_SECRET }
    });
    const data = await resp.json();
    return { success: true, php_status: data, timestamp: new Date().toISOString() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}