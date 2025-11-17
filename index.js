
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env values into process.env
dotenv.config();

// fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------
// Configuration / Environment
// -----------------------------
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ BOT_TOKEN missing in environment variables');
  process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // e.g. https://your-service.onrender.com
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const USE_WEBHOOK = !!WEBHOOK_URL; // if WEBHOOK_URL provided, use webhook mode

// -----------------------------
// In-memory chat state & logging
// -----------------------------
// Simple per-chat memory while process runs (reset on restart)
const chatState = new Map(); // key: chatId -> { awaitingAnother: boolean }

// Joke log file path (ignored via .gitignore)
const LOG_FILE = path.join(__dirname, 'jokes.log');

// Append a simple log line for each sent joke
function logJoke(chatId, jokeText) {
  const line = `[${new Date().toISOString()}] chat:${chatId} - ${jokeText.replace(/\n/g, ' / ')}\n`;
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) console.error('Failed to write joke log:', err.message || err);
  });
}

// State helpers
function setAwaitingAnother(chatId, value) {
  const st = chatState.get(chatId) || {};
  st.awaitingAnother = !!value;
  chatState.set(chatId, st);
}
function isAwaitingAnother(chatId) {
  const st = chatState.get(chatId);
  return !!(st && st.awaitingAnother);
}
function clearState(chatId) {
  chatState.delete(chatId);
}
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// -----------------------------
// Register handlers (used for both webhook/polling modes)
// -----------------------------
function registerHandlers(botInstance) {

  // Fetch a joke from the external API and return text
  async function fetchJoke() {
    const resp = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 6000 });
    return `${resp.data.setup}\n\n${resp.data.punchline}`;
  }

  // Send a joke and then show inline buttons for Another / Stop
  async function sendJokeWithButtons(chatId, bot) {
    try {
      const text = await fetchJoke();
      await bot.sendMessage(chatId, text);
      logJoke(chatId, text);

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '😂 Another', callback_data: 'JOKE_ANOTHER' },
              { text: '🛑 Stop', callback_data: 'JOKE_STOP' }
            ]
          ]
        }
      };
      await bot.sendMessage(chatId, 'Want another joke?', opts);
      setAwaitingAnother(chatId, true);
    } catch (err) {
      console.error('Joke fetch error:', err && err.message ? err.message : err);
      setAwaitingAnother(chatId, false);
      await bot.sendMessage(chatId, "Sorry, couldn't fetch a joke right now.");
    }
  }

  // Answer an inline query (when user types @yourbot in another chat)
  async function handleInlineQuery(inlineQuery) {
    try {
      const text = await fetchJoke();
      logJoke(inlineQuery.from.id || inlineQuery.id, text);

      const result = [{
        type: 'article',
        id: '' + Date.now() + Math.floor(Math.random() * 1000),
        title: 'Random Joke',
        input_message_content: { message_text: text },
        description: text.length > 80 ? text.slice(0, 77) + '...' : text
      }];
      // no cache so results stay fresh
      await botInstance.answerInlineQuery(inlineQuery.id, result, { cache_time: 0 });
    } catch (err) {
      console.error('inline_query handler error:', err && err.message ? err.message : err);
    }
  }

  // Main message listener: greetings, typed intents, follow-ups, fallback echo
  botInstance.on('message', async (msg) => {
    try {
      if (!msg || !msg.text) return;
      const raw = msg.text;
      const text = raw.trim();
      console.log('Message received (raw):', JSON.stringify(raw));

      // If it's a slash command, leave it to onText handlers
      if (text.startsWith('/')) return;

      // If bot recently asked "Want another?" treat typed replies (yes/no)
      if (isAwaitingAnother(msg.chat.id)) {
        const lowered = text.toLowerCase().trim();
        if (/^(yes|y|another|more|again|please)$/i.test(lowered)) {
          setAwaitingAnother(msg.chat.id, false);
          await botInstance.sendMessage(msg.chat.id, 'Fetching another joke...');
          await sendJokeWithButtons(msg.chat.id, botInstance);
          return;
        }
        if (/^(no|stop|nah|nope|cancel)$/i.test(lowered)) {
          const stopReplies = [
            'Fine. Here’s a little thought: “A smile is a curve that sets everything straight.”',
            'Alright. Remember: “Laughter is timeless, imagination has no age.”',
            'Okay — keeping it quiet. Thought for the day: “Small smiles make big days.”',
            'Fine. Take care — “Happiness often sneaks in through a door you didn’t know you left open.”',
            'Silent mode on. “Even silence has its own melody.”'
          ];
          await botInstance.sendMessage(msg.chat.id, randomFrom(stopReplies));
          setAwaitingAnother(msg.chat.id, false);
          return;
        }
        // otherwise fall through to normal intent detection
      }

      // Greeting detection: hi, hello, hey, etc.
      const greetingRe = /^\s*(?:hi|hello|hey|hiya|hii|howdy)(?:[!\.,\?\s].*)?$/i;
      if (greetingRe.test(text)) {
        // show reply keyboard for ease-of-use
        const replyOptions = {
          reply_markup: {
            keyboard: [
              [{ text: 'Tell me a joke' }, { text: 'Help' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        };
        await botInstance.sendMessage(msg.chat.id,
          "Welcome, how can I help you today?\n\nTap 'Tell me a joke' or type /joke.",
          replyOptions
        );
        setAwaitingAnother(msg.chat.id, false);
        return;
      }

      // Detect plain-text joke requests (various natural forms)
      const jokeIntentRe = /\b(joke|tell me a joke|give me a joke|make me laugh|another joke|one more joke|tell me one|say a joke)\b/i;
      if (jokeIntentRe.test(text) || /^\s*joke\s*$/i.test(text)) {
        await sendJokeWithButtons(msg.chat.id, botInstance);
        return;
      }

      // Reply-keyboard buttons mapped to intents
      if (/^tell me a joke$/i.test(text)) {
        await sendJokeWithButtons(msg.chat.id, botInstance);
        return;
      }
      if (/^help$/i.test(text)) {
        await botInstance.sendMessage(msg.chat.id,
          "Commands:\n/start - Start the bot\n/joke - Get a random joke\n/help - This help message\n/about - About the bot"
        );
        return;
      }

      // fallback: helpful echo so user isn't left with silence
      await botInstance.sendMessage(msg.chat.id, `You said: ${text}`).catch(err => {
        console.error('sendMessage error:', err && err.message ? err.message : err);
      });

    } catch (err) {
      console.error('message handler error:', err && err.message ? err.message : err);
    }
  });

  // /start command - greeting and quick reply keyboard
  botInstance.onText(/\/start/, (msg) => {
    const replyOptions = {
      reply_markup: {
        keyboard: [
          [{ text: 'Tell me a joke' }, { text: 'Help' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    botInstance.sendMessage(
      msg.chat.id,
      "Welcome, how can I help you today!\n\nTry /joke to hear a fun joke.",
      replyOptions
    );
    setAwaitingAnother(msg.chat.id, false);
  });

  // /help command - user-friendly instructions
  botInstance.onText(/\/help/, (msg) => {
    const helpText = `
🤖 *Tele-Joke Bot Help*

Here's how you can use me:

✨ Type or tap:
- /start — To begin chatting and see options
- /joke — Get a random fun joke instantly
- "Tell me a joke" — Works even without the slash
- "Hi" or "Hello" — I’ll greet you and show quick buttons

💡 You can also press "😂 Another" after a joke to get a new one, or "🛑 Stop" to end the session.

Made to keep your mood light — one smile at a time! 😄
`;
    botInstance.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  // /about command - brief info
  botInstance.onText(/\/about/, (msg) => {
    botInstance.sendMessage(msg.chat.id,
      "Tele-Joke Bot — a small friendly bot that tells random jokes. Built with node-telegram-bot-api."
    );
  });

  // /joke command - primary action
  botInstance.onText(/\/joke/, async (msg) => {
    const chatId = msg.chat.id;
    await sendJokeWithButtons(chatId, botInstance);
  });

  // Inline button presses (callback_query)
  botInstance.on('callback_query', async (callbackQuery) => {
    try {
      const data = callbackQuery.data;
      // Note: callbackQuery.message may be undefined for some types; guard accordingly
      if (!callbackQuery.message) {
        await botInstance.answerCallbackQuery(callbackQuery.id);
        return;
      }
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;

      if (data === 'JOKE_ANOTHER') {
        // Edit the follow-up message (the "Want another?" message) to show progress
        await botInstance.editMessageText('Fetching another joke...', {
          chat_id: chatId,
          message_id: messageId
        });
        // Send the new joke (this will post a new joke and a new follow-up)
        await sendJokeWithButtons(chatId, botInstance);
        await botInstance.answerCallbackQuery(callbackQuery.id);
      } else if (data === 'JOKE_STOP') {
        // Choose a gentle stop reply (no laughing emoji required)
        const stopReplies = [
          'Fine. Here’s a little thought: “A smile is a curve that sets everything straight.”',
          'Alright. Remember: “Laughter is timeless, imagination has no age.”',
          'Okay — keeping it quiet. Thought for the day: “Small smiles make big days.”',
          'Fine. Take care — “Happiness often sneaks in through a door you didn’t know you left open.”',
          'Silent mode on. “Even silence has its own melody.”'
        ];
        const chosen = randomFrom(stopReplies);
        // Replace the follow-up question with the chosen stop message
        await botInstance.editMessageText(chosen, {
          chat_id: chatId,
          message_id: messageId
        });
        setAwaitingAnother(chatId, false);
        await botInstance.answerCallbackQuery(callbackQuery.id, { text: 'Stopped' });
      } else {
        await botInstance.answerCallbackQuery(callbackQuery.id);
      }
    } catch (err) {
      console.error('callback_query handler error:', err && err.message ? err.message : err);
    }
  });

  // Inline query handler - allow @bot usage in other chats
  botInstance.on('inline_query', async (inlineQuery) => {
    try {
      await handleInlineQuery(inlineQuery);
    } catch (err) {
      console.error('inline_query outer error:', err && err.message ? err.message : err);
    }
  });

} // end registerHandlers

// -----------------------------
// Startup: Webhook mode OR Polling mode
// -----------------------------
if (USE_WEBHOOK) {
  // Webhook mode (suitable for Render, Cloud Run, etc.)
  const bot = new TelegramBot(TOKEN);
  registerHandlers(bot);

  const app = express();
  app.use(bodyParser.json());

  // Telegram will POST updates here
  app.post(`/webhook/${TOKEN}`, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error('processUpdate error:', err && err.message ? err.message : err);
      res.sendStatus(500);
    }
  });

  // A simple root endpoint to check the service
  app.get('/', (req, res) => res.send('Bot webhook is running.'));

  // Start HTTP server and set webhook at Telegram
  app.listen(PORT, async () => {
    console.log(`Express server listening on port ${PORT}. Attempting to set webhook...`);
    try {
      const webhookUrlFull = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${TOKEN}`;
      await bot.setWebHook(webhookUrlFull);
      console.log('Webhook set to:', webhookUrlFull);
    } catch (err) {
      console.error('Failed to set webhook:', err && err.message ? err.message : err);
    }
  });

  // graceful shutdown
  process.on('SIGINT', () => {
    console.log('SIGINT - shutting down webhook server.');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM - shutting down webhook server.');
    process.exit(0);
  });

} else {
  // Polling mode (good for local development or background worker)
  const bot = new TelegramBot(TOKEN, { polling: true });
  registerHandlers(bot);

  bot.on('polling_error', (err) => {
    console.error('Polling error:', err && err.message ? err.message : err);
  });

  console.log('🤖 Bot started in polling mode.');

  // graceful shutdown for polling
  const shutdown = async () => {
    console.log('Shutting down polling...');
    try {
      await bot.stopPolling(true);
      console.log('Polling stopped.');
    } catch (err) {
      console.error('Error while stopping polling:', err && err.message ? err.message : err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const http = require('http');

const PORT2 = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // simple healthcheck and root response so Render sees an open port
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT2, () => {
  console.log(`HTTP server listening on port ${PORT2}`);
});