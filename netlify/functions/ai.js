/* ================================================================
   Mere -- AI assistant backend (Netlify Function, replaces Code.gs)
   ------------------------------------------------------------
   Receives { messages } as a POST body from askMereAi()/
   callMereAiBackend() in index.html -- messages is the recent
   conversation history as [{ role: 'user'|'assistant', content }],
   built by buildAiHistory() -- and returns { reply: "..." }. Runs on
   the same Netlify site as the app itself, so there's no
   cross-service round trip and no cold-start delay the way there
   was calling out to Apps Script.

   Sending the whole recent history (not just the newest message) on
   every call is what gives the assistant conversation memory --
   Groq, like any chat completion API, has no memory of its own
   between requests; the illusion of memory comes entirely from the
   caller re-sending prior turns each time.

   The Groq API key never appears in any file in this project -- it
   lives only in Netlify's environment variables (Site settings ->
   Environment variables -> GROQ_API_KEY), which this function reads
   at request time via process.env.GROQ_API_KEY.
   ================================================================ */

// Groq deprecated llama-3.3-70b-versatile in June 2026 (their
// official migration recommendation is openai/gpt-oss-120b, which
// is what's used here). If Groq deprecates this one too down the
// line, the fix is just changing this one string -- check
// console.groq.com/docs/models for whatever's current.
const GROQ_MODEL = 'openai/gpt-oss-120b';

// Optional personality/context for the assistant. Edit this to
// change how Mere AI responds -- e.g. its name, tone, or anything
// it should always know. Kept server-side so it can't be edited or
// removed from the browser.
//
// Developer contact details below are copied directly from the
// app's own "Developer" page (index.html, #page-developer) so this
// stays in sync with what's shown in-app -- if that page ever
// changes, update this to match.
const SYSTEM_PROMPT = `You are Mere AI, a helpful, friendly assistant built into the Mere messaging app. Keep replies conversational and concise.

About Mere (the app you're built into): a WhatsApp-style messaging app with one-on-one chat, media attachments (photos, camera, voice notes), Status/Stories, swipe-to-reply, and you -- the built-in AI assistant. If someone asks what the app can do, answer from this.

If someone asks who built the app, who the developers are, or how to contact them, share these details:
- Destiny -- Lead Developer & Architect. Email: destinydesigns.studios@gmail.com. Phone: +255 612 613 745.
- Kuroh -- Co-Creator & Product Designer. Email: Khyrakhamis@gmail.com. Phone: +255 665 129 054.
- Built by Destiny & Kuroh.
Only share these when asked about the developers/app -- don't bring them up unprompted.

When a reply calls for tabular or side-by-side comparison data, format it as a standard markdown pipe table (e.g. "| Column | Column |" with a "|---|---|" separator row) so it renders as a real table in the chat, rather than describing it in prose.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      // Expected shape going forward: the client sends the recent
      // conversation history directly.
      messages = body.messages
        .filter(m => m && typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ role: m.role, content: m.content.trim() }));
    } else if (typeof body.prompt === 'string' && body.prompt.trim()) {
      // Backwards-compatible fallback for a single-prompt request
      // (no history) -- shouldn't normally be hit anymore, but kept
      // so an older cached copy of the client doesn't hard-fail.
      messages = [{ role: 'user', content: body.prompt.trim() }];
    }
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }
  if (!messages || messages.length === 0) {
    return jsonResponse(400, { error: 'Missing "messages" (or "prompt").' });
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
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
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
