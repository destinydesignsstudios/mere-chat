/* ================================================================
   Mere -- AI assistant backend (Netlify Function, replaces Code.gs)
   ------------------------------------------------------------
   Receives { prompt } as a POST body from askMereAi() in index.html
   and returns { reply: "..." }. Runs on the same Netlify site as
   the app itself, so there's no cross-service round trip and no
   cold-start delay the way there was calling out to Apps Script.

   The Groq API key never appears in any file in this project -- it
   lives only in Netlify's environment variables (Site settings ->
   Environment variables -> GROQ_API_KEY), which this function reads
   at request time via process.env.GROQ_API_KEY.
   ================================================================ */

const GROQ_MODEL = 'llama-3.3-70b-versatile';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  let prompt;
  try {
    const body = JSON.parse(event.body || '{}');
    prompt = (body.prompt || '').toString().trim();
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }
  if (!prompt) {
    return jsonResponse(400, { error: 'Missing "prompt".' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: 'GROQ_API_KEY is not set in Netlify environment variables.' });
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `Groq API error (HTTP ${res.status})`;
      return jsonResponse(502, { error: msg });
    }

    const reply = data
      && data.choices
      && data.choices[0]
      && data.choices[0].message
      && data.choices[0].message.content;

    if (!reply) {
      return jsonResponse(502, { error: 'Groq returned no reply text.' });
    }

    return jsonResponse(200, { reply });

  } catch (err) {
    return jsonResponse(500, { error: 'Server error: ' + err.message });
  }
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
