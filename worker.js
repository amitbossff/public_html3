export default {
  async fetch(request, env) {
    const result = await generateEarning(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function generateEarning(env) {
  const keywords = [
    'earning apps',
    'online earning',
    'paise kamane wala app',
    'work from home'
  ];

  const apiKey = env.GROQ_EARNING_1;
  if (!apiKey) {
    return { error: 'GROQ_EARNING_1 not set' };
  }

  let totalAdded = 0;
  const results = [];

  for (const keyword of keywords) {
    try {
      const comments = await callGroq(keyword, apiKey);
      const saveResult = await saveToPHP(comments, env);
      totalAdded += comments.length;
      results.push({ keyword, generated: comments.length, saved: saveResult });
    } catch (e) {
      results.push({ keyword, error: e.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  return {
    success: true,
    total_added: totalAdded,
    details: results,
    timestamp: new Date().toISOString()
  };
}

async function callGroq(keyword, apiKey) {
  const prompt = `Generate 25 UNIQUE YouTube comments about "${keyword}" in Hinglish (Hindi + English mix).

Rules:
- Each comment 15-25 words
- Mix styles: praise, thanks, question, feedback
- Use 1-2 emojis (🔥 💰 👍 💯 ✅)
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
        { role: 'system', content: 'Return ONLY valid JSON arrays.' },
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

async function saveToPHP(comments, env) {
  const formData = new URLSearchParams();
  formData.append('action', 'save');
  formData.append('secret', env.PHP_SECRET);
  formData.append('topic', 'earning');
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