import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import twilio from 'twilio';

// ── Config ──────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM || '';
const PORT = parseInt(process.env.PORT || process.env.WHATSAPP_BOT_PORT || '3001');

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const twilioClient = twilio(twilioSid, twilioToken);

// ── Per-user chat history (in-memory) ───────────────────────────────────
const chatHistories = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();
const MAX_HISTORY = 20; // keep last 20 messages per user

function getChatHistory(userId: string) {
  if (!chatHistories.has(userId)) chatHistories.set(userId, []);
  return chatHistories.get(userId)!;
}

function addToHistory(userId: string, role: 'user' | 'assistant', content: string) {
  const history = getChatHistory(userId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// ── AI Prompts ──────────────────────────────────────────────────────────
const CLASSIFY_PROMPT = `
You are an AI assistant for a student opportunity tracker platform.
Analyze the user's message and determine if they are:
1. trying to ADD/FORWARD a new opportunity — this is ONLY when the message contains a DETAILED job posting with specifics like company name, role description, requirements, salary, deadline, etc. (a full paragraph or forwarded message).
2. trying to QUERY/ASK about existing opportunities — this is when the user sends a SHORT message searching for opportunities, like "amazon internships", "google jobs", "any updates from TCS?", "data science roles", "latest internships".
3. having a general CHAT/CONVERSATION — greetings, casual talk, asking for advice, career guidance, etc.
4. if some one forwards you a message about new internship opportunity add it to supabase database using CREATE TABLE IF NOT EXISTS public.opportunities in the supabase-schema.sql file
IMPORTANT: Short messages (1-5 words) like "Amazon Internship", "Google jobs", "TCS openings" are ALWAYS queries, NOT adds.
Only classify as "add_opportunity" if the message is a DETAILED description (usually 20+ words) of a specific opportunity.

Return ONLY a JSON object:
{
  "intent": "add_opportunity" | "query_opportunities" | "chat",
  "reason": "short explanation"
}
`;

const CHAT_SYSTEM_PROMPT = `You are OppBot 🤖, a friendly and witty AI assistant on WhatsApp for the OppTracker student opportunity platform.

Your personality:
- Warm, encouraging, and supportive — like a helpful senior student or mentor
- Use emojis naturally but don't overdo it
- Keep responses concise (under 1000 characters) — this is WhatsApp, not an essay!
- Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~

Your capabilities:
- Friendly conversation, career advice, motivation
- Helping students with interview tips, resume advice, career guidance
- Suggesting they search for opportunities (e.g. "Try sending *Amazon internships* to find openings!")

Rules:
- Always be positive and supportive
- If someone seems stressed about placements/jobs, encourage them
- Naturally weave in suggestions to search for opportunities when relevant
- If asked who you are, say you're OppBot by OppTracker — a student opportunity tracker
- Never reveal you are an LLM or AI model, just say you're OppBot
- Keep it short and conversational for WhatsApp
`;

const EXTRACT_PROMPT = `
Extract the key information from the opportunity message into a strict JSON format.
IMPORTANT: If the message contains any URLs/links (like https://... or http://... or bit.ly/... etc.), extract them into the "apply_link" field.
Always return ONLY valid JSON matching this exact schema:
{
  "company": "string",
  "role": "string",
  "type": "string ('Job' or 'Internship')",
  "field": "string",
  "location": "string",
  "mode": "string",
  "duration": "string",
  "package_stipend": "string",
  "required_skill": "string",
  "eligibility": "string",
  "application_deadline": "string",
  "apply_link": "string (the application URL if found, or empty string)"
}
`;

// Extract URLs from text as a fallback
function extractUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

// ── Parse URL-encoded body ──────────────────────────────────────────────
function parseBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const params: Record<string, string> = {};
      body.split('&').forEach((pair) => {
        const [key, ...rest] = pair.split('=');
        const val = rest.join('=');
        if (key) params[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent((val || '').replace(/\+/g, ' '));
      });
      resolve(params);
    });
    req.on('error', reject);
  });
}

// ── Friendly Chat with Groq ─────────────────────────────────────────────
async function handleChat(text: string, from: string): Promise<string> {
  const history = getChatHistory(from);

  // Build messages with history for context
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...history.slice(-10), // last 10 messages for context
    { role: 'user', content: text },
  ];

  const chatResult = await groq.chat.completions.create({
    messages,
    model: 'llama-3.1-8b-instant',
    temperature: 0.7,
    max_tokens: 500,
  });

  return chatResult.choices[0]?.message?.content || "Hey! I'm here to help. Try asking me about careers or search for opportunities like *Amazon internships* 🚀";
}

// ── Process incoming WhatsApp message ───────────────────────────────────
async function handleMessage(text: string, from: string): Promise<string> {
  // Skip sandbox join messages
  const lower = text.toLowerCase().trim();
  if (lower.startsWith('join ')) {
    return "👋 Welcome to OppTracker Bot!\n\nYou can:\n• Search: *Amazon internships*\n• Chat: Ask me anything about careers!\n• Add: Paste a job description to save it";
  }

  try {
    // 1. Classify Intent
    const classifyResult = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: text },
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const intentData = JSON.parse(classifyResult.choices[0]?.message?.content || '{}');
    console.log(`   Intent: ${intentData.intent} (${intentData.reason})`);

    let reply: string;

    if (intentData.intent === 'query_opportunities') {
      reply = await handleQuery(text);
    } else if (intentData.intent === 'add_opportunity') {
      reply = await handleAdd(text);
    } else {
      // Friendly conversational chat with Groq
      reply = await handleChat(text, from);
    }

    // Save to chat history
    addToHistory(from, 'user', text);
    addToHistory(from, 'assistant', reply);

    return reply;
  } catch (err: any) {
    console.error('Error processing message:', err);
    return `⚠️ Sorry, something went wrong: ${err.message}`;
  }
}

// ── Query Opportunities ─────────────────────────────────────────────────
async function handleQuery(text: string): Promise<string> {
  // Broad keyword search instead of strict extraction
  // 1. Remove common conversational words
  const stopWords = ['any', 'internships', 'internship', 'jobs', 'job', 'for', 'in', 'at', 'related', 'to', 'can', 'you', 'provide', 'me', 'show', 'search', 'find'];
  const words = text.toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));

  let opps: any[] = [];

  // If no specific keywords left, just fetch latest 10
  if (words.length === 0) {
    const { data, error } = await supabase.from('opportunities').select('*').limit(10);
    opps = data || [];
    if (error) console.error(error);
  } else {
    // Search Supabase: for each word, check if it's in Company OR Job Role OR Field
    // We'll fetch a larger set and rank/filter in memory to keep it simple but effective
    const { data, error } = await supabase.from('opportunities').select('*').limit(100);
    if (!error && data) {
      // Score each opportunity based on how many keywords match
      const scored = data.map(opp => {
        let score = 0;
        const searchableText = [opp.Company, opp['Job Role'], opp.Field, opp.Type].join(' ').toLowerCase();

        words.forEach(w => {
          if (searchableText.includes(w)) score++;
        });

        return { ...opp, matchScore: score };
      });

      // Filter out score 0 and sort by highest score
      opps = scored
        .filter(o => o.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore);
    }
  }

  if (opps.length === 0) {
    return `😔 No opportunities found${words.length > 0 ? ` for "${words.join(' ')}"` : ''}. Try a different search!`;
  }

  // Format and summarize with AI (keep it short for WhatsApp)
  const formatted = opps.slice(0, 10).map((o: any) => ({
    Company: o['Company'],
    Type: o['Type'] || 'Job',
    Role: o['Job Role'],
    Location: o['Location'],
    'Package/Stipend': o['Package (Stipend)'],
    Deadline: o['Application Deadline'],
    Field: o['Field'],
  }));

  const answerResult = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant for students. Here are matching opportunities:\n\n${JSON.stringify(formatted, null, 2)}\n\nAnswer using ONLY this data. Format each opportunity as:\n🏢 *Company* — Role\n📌 Type | 📍 Location\n💰 Package | 📅 Deadline\n\nKeep the response under 1500 characters. Show at most 8 opportunities. Use WhatsApp markdown (*bold*, _italic_).`,
      },
      { role: 'user', content: text },
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.3,
    max_tokens: 800,
  });

  return (
    answerResult.choices[0]?.message?.content ||
    `Found ${opps.length} opportunities but couldn't format the reply.`
  );
}

// ── Add Opportunity ─────────────────────────────────────────────────────
async function handleAdd(text: string): Promise<string> {
  const extractResult = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: text },
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const data = JSON.parse(extractResult.choices[0]?.message?.content || '{}');
  if (!data.company || !data.role) {
    return "🤔 Couldn't detect a clear company and role. Please provide more details about the opportunity.";
  }

  // Validate deadline is a real date, otherwise set to null
  let deadline: string | null = null;
  if (data.application_deadline) {
    const parsed = new Date(data.application_deadline);
    if (!isNaN(parsed.getTime())) {
      deadline = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
    }
  }

  // Extract apply link — from AI or fallback regex
  const applyLink = data.apply_link || extractUrl(text) || null;

  const { error } = await supabase
    .from('opportunities')
    .insert({
      Company: data.company,
      Type: data.type || 'Job',
      'Job Role': data.role,
      Field: data.field || 'Other',
      Location: data.location || null,
      Mode: data.mode || null,
      Duration: data.duration || null,
      'Package (Stipend)': data.package_stipend || null,
      'Required Skill': data.required_skill || null,
      Eligibility: data.eligibility || null,
      'Application Deadline': deadline,
      'Apply Link': applyLink,
    })
    .single();

  if (error) {
    console.error('Insert error:', error);
    return `❌ Failed to save: ${error.message}`;
  }

  return `✅ Saved to OppTracker!\n\n🏢 *${data.company}*\n💼 ${data.role}\n📌 ${data.type || 'Job'}\n📍 ${data.location || 'Not specified'}\n💰 ${data.package_stipend || 'Not specified'}${applyLink ? `\n🔗 ${applyLink}` : ''}`;
}

// ── HTTP Server ─────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OppTracker WhatsApp Bot is running! 🚀');
    return;
  }

  // Twilio webhook
  if (req.method === 'POST' && (req.url === '/whatsapp' || req.url === '/webhook')) {
    let from = '';
    let incomingMsg = '';
    try {
      const body = await parseBody(req);
      incomingMsg = body.Body || '';
      from = body.From || '';

      console.log(`📱 WhatsApp from ${from}: ${incomingMsg}`);

      // Acknowledge receipt to Twilio immediately so the webhook doesn't timeout
      const twiml = new twilio.twiml.MessagingResponse();
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString());

      // Process the message and send via Twilio API asynchronously
      const reply = await handleMessage(incomingMsg, from);
      console.log(`   ↳ Reply: ${reply.substring(0, 100)}...`);

      // Telegram has a 4096 char limit, WhatsApp has a 1600 char limit usually, but Twilio handles splitting.
      // We send it using the active client.
      await twilioClient.messages.create({
        body: reply,
        from: twilioWhatsAppFrom,
        to: from
      });

    } catch (err: any) {
      console.error('Webhook error:', err.message);
      try {
        await twilioClient.messages.create({
          body: '⚠️ Sorry, something went wrong processing your request. Please try again.',
          from: twilioWhatsAppFrom,
          to: from
        });
      } catch (e: any) {
        console.error('Failed to send error fallback:', e.message);
      }

      if (!res.headersSent) {
        const twiml = new twilio.twiml.MessagingResponse();
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
      }
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});


server.listen(PORT, () => {
  console.log(`\n📱 OppTracker WhatsApp Bot is live!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Webhook: http://localhost:${PORT}/whatsapp`);
  console.log(`\n⚠️  To connect with Twilio, expose this with ngrok:`);
  console.log(`   npx ngrok http ${PORT}`);
  console.log(`   Then set the ngrok URL + /whatsapp as your Twilio Sandbox inbound URL\n`);
});
