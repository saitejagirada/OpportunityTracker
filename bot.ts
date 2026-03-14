import TelegramBot from 'node-telegram-bot-api';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

// Use the VITE_ prefixed URL since it's already in .env
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://dmgjblmbmksvwvfnwmmd.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.warn("⚠️ SUPABASE_SERVICE_ROLE_KEY is not set in .env! Database inserts may fail due to RLS.");
}

// Create an admin client to bypass Row-Level Security
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || process.env.VITE_SUPABASE_ANON_KEY || '');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Please set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 AutoNotification Bot is live! Listening for Telegram messages...");

// ── Per-user chat history (in-memory) ───────────────────────────────────
const chatHistories = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();
const MAX_HISTORY = 20;

function getChatHistory(chatId: number) {
  const key = String(chatId);
  if (!chatHistories.has(key)) chatHistories.set(key, []);
  return chatHistories.get(key)!;
}

function addToHistory(chatId: number, role: 'user' | 'assistant', content: string) {
  const history = getChatHistory(chatId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// Prompt to classify the intent of the message
const CLASSIFY_PROMPT = `
You are an AI assistant for a student opportunity tracker platform.
Analyze the user's message and determine if they are:
1. trying to ADD/FORWARD a new opportunity — this is ONLY when the message contains a DETAILED job posting (usually 20+ words) with specifics like company name, role description, requirements, salary, deadline, etc.
2. trying to QUERY/ASK about existing opportunities (e.g. "any updates from google?", "what internships are available?", "amazon jobs").
3. having a general CHAT/CONVERSATION — greetings, casual talk, asking for advice, career guidance, etc.
4. if some one forwards you a message about new internship opportunity add it to supabase database using CREATE TABLE IF NOT EXISTS public.opportunities in the supabase-schema.sql file

IMPORTANT: Short messages (1-5 words) are ALWAYS queries or chat, NOT adds.

Return ONLY a JSON object:
{
  "intent": "add_opportunity" | "query_opportunities" | "chat",
  "reason": "short explanation"
}
`;

const CHAT_SYSTEM_PROMPT = `You are OppBot 🤖, a friendly and witty AI assistant on Telegram for the OppTracker student opportunity platform.

Your personality:
- Warm, encouraging, and supportive — like a helpful senior student or mentor
- Use emojis naturally but don't overdo it
- Keep responses concise

Your capabilities:
- Friendly conversation, career advice, motivation
- Helping students with interview tips, resume advice, career guidance
- Suggesting they search for opportunities (e.g. "Try sending 'Amazon internships' to find openings!")

Rules:
- Always be positive and supportive
- If someone seems stressed about placements/jobs, encourage them
- Naturally weave in suggestions to search for opportunities when relevant
- If asked who you are, say you're OppBot by StochasticGradients
- Keep it conversational
`;

// Prompt to extract a new opportunity
const EXTRACT_PROMPT = `
Extract the key information from the opportunity message into a strict JSON format.
Always return ONLY valid JSON matching this exact schema:
{
  "company": "string (name of the company or organization)",
  "role": "string (the specific job or internship title)",
  "type": "string ('Job' or 'Internship')",
  "field": "string (the domain or sector)",
  "location": "string (e.g., 'Bangalore', 'Remote', 'Pan India')",
  "mode": "string (e.g., 'On-site', 'Remote', 'Hybrid')",
  "duration": "string (e.g., '6 months', or empty string)",
  "package_stipend": "string (e.g., '12 LPA', '30k/month', or empty string)",
  "required_skill": "string (e.g., 'React, Node', 'Python', or empty string)",
  "eligibility": "string (e.g., '2024 batch B.Tech CS', 'All students')",
  "application_deadline": "string (deadline, or empty string)",
  "apply_link": "string (the application URL if found, or empty string)"
}
`;

// Extract URLs from text as a fallback
function extractUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (text.startsWith('/start')) {
    bot.sendMessage(chatId, "👋 Hi! I'm OppBot!\n\nI can:\n🔍 Find opportunities — e.g. 'Amazon internships'\n💾 Save opportunities — just forward a job posting\n💬 Chat — ask me anything about careers!\n\nWhat would you like to do?");
    return;
  }

  try {
    bot.sendChatAction(chatId, 'typing');

    // 1. Classify Intent
    const classifyCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: text }
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const intentData = JSON.parse(classifyCompletion.choices[0]?.message?.content || '{}');

    if (intentData.intent === 'query_opportunities') {
      // 2a. Handle query
      bot.sendMessage(chatId, "🔍 Let me check the database for you...");

      // Broad keyword search instead of strict extraction
      const stopWords = ['any', 'internships', 'internship', 'jobs', 'job', 'for', 'in', 'at', 'related', 'to', 'can', 'you', 'provide', 'me', 'show', 'search', 'find'];
      const words = text.toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w));

      let opps: any[] = [];
      let queryError: any = null;

      if (words.length === 0) {
        const { data, error } = await supabaseAdmin.from('opportunities').select('*').limit(10);
        opps = data || [];
        queryError = error;
      } else {
        const { data, error } = await supabaseAdmin.from('opportunities').select('*').limit(100);
        queryError = error;
        if (!error && data) {
          const scored = data.map(opp => {
            let score = 0;
            const searchableText = [opp.Company, opp['Job Role'], opp.Field, opp.Type].join(' ').toLowerCase();
            words.forEach(w => {
              if (searchableText.includes(w)) score++;
            });
            return { ...opp, matchScore: score };
          });

          opps = scored
            .filter(o => o.matchScore > 0)
            .sort((a, b) => b.matchScore - a.matchScore);
        }
      }

      if (queryError) throw queryError;

      if (opps.length === 0) {
        bot.sendMessage(chatId, `😔 No opportunities found${words.length > 0 ? ` for "${words.join(' ')}"` : ''}. Try a different search!`);
        return;
      }

      // Format data nicely for the AI, limited to 15 to avoid Groq Rate Limit (413 Payload Too Large)
      const formattedOpps = opps.slice(0, 15).map((o: any) => ({
        Company: o['Company'],
        Type: o['Type'] || 'Job',
        Role: o['Job Role'],
        Location: o['Location'],
        'Package/Stipend': o['Package (Stipend)'],
        Deadline: o['Application Deadline'],
        Eligibility: o['Eligibility'],
        Field: o['Field'],
        Mode: o['Mode'],
      }));

      // Ask Groq to answer based on the data
      const answerCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: `You are a helpful assistant for students. Here are the matching opportunities from our database:\n\n${JSON.stringify(formattedOpps, null, 2)}\n\nAnswer the user's question directly and in a friendly, concise way using ONLY this data. Format each opportunity clearly with Company, Role, Type (Job/Internship), Field, Location, Deadline, and Package/Stipend. If there are no matches, politely say so. Always include the deadline if available. Keep the response under 3500 characters. Show at most 10 opportunities.` },
          { role: 'user', content: text }
        ],
        model: 'llama-3.1-8b-instant',
        temperature: 0.3,
        max_tokens: 1500,
      });

      const reply = answerCompletion.choices[0]?.message?.content || "I couldn't find an answer to that.";

      // Telegram has a 4096 char limit — split if needed
      if (reply.length <= 4096) {
        bot.sendMessage(chatId, reply);
      } else {
        const chunks = reply.match(/[\s\S]{1,4000}/g) || [reply];
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk);
        }
      }

    } else if (intentData.intent === 'add_opportunity') {
      // 2b. Handle adding new opportunity
      bot.sendMessage(chatId, "🧠 Extracting opportunity details...");

      const extractCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: text }
        ],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      const data = JSON.parse(extractCompletion.choices[0]?.message?.content || '{}');
      if (!data.company || !data.role) {
        bot.sendMessage(chatId, "🤔 I couldn't detect a clear company and role in that message. If you are trying to add an opportunity, please provide more details.");
        return;
      }

      bot.sendMessage(chatId, `✅ Extracted successfully!\n\n🏢 Company: ${data.company}\n🎯 Role: ${data.role}\n📌 Type: ${data.type || 'Job'}\n📍 Location: ${data.location || 'Not specified'}\n💰 Package/Stipend: ${data.package_stipend || 'Not specified'}\n📅 Deadline: ${data.application_deadline || 'Not specified'}\n\nSaving to Supabase...`);

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

      // Insert into Supabase using the admin client to bypass RLS
      const { data: inserted, error } = await supabaseAdmin
        .from('opportunities')
        .insert({
          "Company": data.company,
          "Type": data.type || 'Job',
          "Job Role": data.role,
          "Field": data.field || 'Other',
          "Location": data.location || null,
          "Mode": data.mode || null,
          "Duration": data.duration || null,
          "Package (Stipend)": data.package_stipend || null,
          "Required Skill": data.required_skill || null,
          "Eligibility": data.eligibility || null,
          "Application Deadline": deadline,
          "Apply Link": applyLink
        })
        .select()
        .single();

      if (error) {
        console.error(error);
        if (error.code === '42501') {
          bot.sendMessage(chatId, `⚠️ RLS Error: Could not save to database due to permissions. (Make sure anon inserts are allowed)`);
        } else {
          bot.sendMessage(chatId, `❌ Failed to save to database: ${error.message}`);
        }
      } else {
        bot.sendMessage(chatId, `🎉 Saved to OppTracker! (ID: ${inserted?.id})${applyLink ? `\n🔗 Link: ${applyLink}` : ''}`);
      }
    } else {
      // 2c. Handle general chat with Groq
      bot.sendChatAction(chatId, 'typing');
      const history = getChatHistory(chatId);
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...history.slice(-10),
        { role: 'user', content: text },
      ];

      const chatResult = await groq.chat.completions.create({
        messages,
        model: 'llama-3.1-8b-instant',
        temperature: 0.7,
        max_tokens: 500,
      });

      const reply = chatResult.choices[0]?.message?.content || "Hey there! I'm OppBot — I can help you find opportunities or chat about careers! 🚀";
      addToHistory(chatId, 'user', text);
      addToHistory(chatId, 'assistant', reply);
      bot.sendMessage(chatId, reply);
    }

  } catch (error: any) {
    console.error("Error processing message:", error);
    bot.sendMessage(chatId, `⚠️ Sorry, there was an error processing your request: ${error.message}`);
  }
});
