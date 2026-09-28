export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const topic = url.searchParams.get('topic') || 'earning';
    
    const result = await generateComments(topic, env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function generateComments(topic, env) {
  const keywords = {
    earning: ['earning apps', 'online earning', 'paise kamane wala app', 'work from home'],
    banking: ['banking app', 'bank account', 'UPI payment', 'net banking'],
    winning: ['winning tricks', 'jeetne ka tarika', 'winning strategy', 'game winning tips'],
    game: ['slots game', 'game tricks', 'gaming tips', 'game winning'],
    vlog: ['daily vlog', 'vlog video', 'life vlog', 'travel vlog']
  };

  const keyMap = {
    earning: 'GROQ_EARNING_1',
    banking: 'GROQ_BANKING_1',
    winning: 'GROQ_WINNING_1',
    game: 'GROQ_GAME_1',
    vlog: 'GROQ_VLOG_1'
  };

  const topicKeywords = keywords[topic];
  const keyName = keyMap[topic];
  const apiKey = env[keyName];

  if (!topicKeywords) {
    return { error: 'Invalid topic. Use: earning, banking, winning, game, vlog' };
  }

  if (!apiKey) {
    return { error: `${keyName} not set in secrets` };
  }

  let totalAdded = 0;
  const results = [];

  for (const keyword of topicKeywords) {
    try {
      const comments = await callGroq(keyword, topic, apiKey);
      const saveResult = await saveToPHP(comments, topic, env);
      totalAdded += comments.length;
      results.push({ keyword, generated: comments.length, saved: saveResult });
    } catch (e) {
      results.push({ keyword, error: e.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  return {
    success: true,
    topic,
    total_added: totalAdded,
    details: results,
    timestamp: new Date().toISOString()
  };
}

async function callGroq(keyword, topic, apiKey) {
  const prompt = `Generate 25 UNIQUE YouTube comments about "${keyword}" (topic: ${topic}) in Hinglish (Hindi + English mix).

Rules:
- Each comment 15-25 words
- Mix styles: praise, thanks, question, feedback
- Use 1-2 emojis (🔥 💰 👍 💯 ✅ 🎯 🏦 🎮)
- Sound like real Indian YouTube user
- NO repetition
- Return ONLY a valid JSON array of strings

Example: ["Bhai video bahut helpful thi 🔥", "Nice explanation, keep it up 👍"]`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON arrays. No markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.95,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (!arrayMatch) throw new Error('No JSON array in response');

  const parsed = JSON.parse(arrayMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Not an array');

  return parsed.filter(c => typeof c === 'string' && c.length > 10);
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
    throw new Error(`PHP ${response.status}: ${err.substring(0, 200)}`);
  }

  return await response.json();
}