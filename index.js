// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ BOT_TOKEN missing in environment variables");
  process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL || ""; // e.g. https://your-service.onrender.com
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const USE_WEBHOOK = !!WEBHOOK_URL; // if WEBHOOK_URL is provided, use webhook mode

// Simple in-memory per-chat state (works while the process runs)
const chatState = new Map(); // key: chatId, value: { awaitingAnother: boolean }

// simple logger for jokes (file in project root)
const LOG_FILE = path.join(__dirname, 'jokes.log');
function logJoke(chatId, jokeText) {
  const line = `[${new Date().toISOString()}] chat:${chatId} - ${jokeText.replace(/\n/g, ' / ')}\n`;
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) console.error('Failed to write joke log:', err.message || err);
  });
}

function setAwaitingAnother(chatId, value) {
  const st = chatState.get(chatId) || {};
  st.awaitingAnother = !!value;
  chatState.set(chatId, st);
}
function isAwaitingAnother(chatId) {
  const st = chatState.get(chatId);
  return st && st.awaitingAnother;
}
function clearState(chatId) {
  chatState.delete(chatId);
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// register your bot handlers in one place so both modes reuse them
function registerHandlers(botInstance) {

  // helper function to fetch a joke (returns string) and log
  async function fetchJoke() {
    const resp = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 5000 });
    return `${resp.data.setup}\n\n${resp.data.punchline}`;
  }

  // helper function to send a joke with buttons and set state
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
      console.error('Joke fetch error:', err.message || err);
      setAwaitingAnother(chatId, false);
      await bot.sendMessage(chatId, "Sorry, couldn't fetch a joke right now.");
    }
  }

  // Helper to send a joke inline result (for inline_query)
  async function answerInlineQuery(inlineQueryId) {
    try {
      const text = await fetchJoke();
      // Build a single article result
      const result = [{
        type: 'article',
        id: '' + Date.now() + Math.floor(Math.random() * 1000),
        title: 'Random Joke',
        input_message_content: { message_text: text },
        description: text.length > 80 ? text.slice(0, 77) + '...' : text
      }];
      await botInstance.answerInlineQuery(inlineQueryId, result, { cache_time: 0 });
    } catch (err) {
      console.error('Inline joke fetch error:', err.message || err);
    }
  }

  // handle greetings, typed intents and follow-ups
  botInstance.on('message', async (msg) => {
    if (!msg || !msg.text) return;
    const raw = msg.text;
    const text = raw.trim();
    console.log("Message received (raw):", JSON.stringify(raw));

    // commands handled elsewhere
    if (text.startsWith('/')) return;

    // If bot recently asked "Want another?" handle typed replies (yes/no)
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
      // if not handled, fall through to intent detection
    }

    // greeting detection
    const greetingRe = /^\s*(?:hi|hello|hey|hiya|hii|howdy)(?:[!\.,\?\s].*)?$/i;
    if (greetingRe.test(text)) {
      // show a reply keyboard for easy actions (will disappear if user selects)
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
      setAwaitingAnother(msg.chat.id, false); // clear just in case
      return;
    }

    // Detect plain-text joke requests (natural forms)
    const jokeIntentRe = /\b(joke|tell me a joke|give me a joke|make me laugh|another joke|one more joke|tell me one|say a joke)\b/i;
    if (jokeIntentRe.test(text) || /^\s*joke\s*$/i.test(text) || /^tell me a joke$/i.test(text) || /^tell me one$/i.test(text)) {
      await sendJokeWithButtons(msg.chat.id, botInstance);
      return;
    }

    // If user pressed reply-keyboard "Tell me a joke" or "Help"
    if (/^tell me a joke$/i.test(text)) {
      await sendJokeWithButtons(msg.chat.id, botInstance);
      return;
    }
    if (/^help$/i.test(text)) {
      await botInstance.sendMessage(msg.chat.id, "Commands:\n/start - Start the bot\n/joke - Get a random joke\n/help - This help message\n/about - About the bot");
      return;
    }

    // fallback: echo other messages
    await botInstance.sendMessage(msg.chat.id, `You said: ${text}`).catch(err => {
      console.error('sendMessage error:', err.message || err);
    });
  });

  // /start command — show greeting and reply keyboard
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

  // /help command
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
    botInstance.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
  });

  // /about command
  botInstance.onText(/\/about/, (msg) => {
    botInstance.sendMessage(msg.chat.id, "Tele-Joke Bot — a small friendly bot that tells random jokes. Built with node-telegram-bot-api.");
  });

  // /joke command
  botInstance.onText(/\/joke/, async (msg) => {
    const chatId = msg.chat.id;
    await sendJokeWithButtons(chatId, botInstance);
  });

  // handle inline button presses
  botInstance.on('callback_query', async (callbackQuery) => {
    try {
      const data = callbackQuery.data;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;

      if (data === 'JOKE_ANOTHER') {
        await botInstance.editMessageText('Fetching another joke...', {
          chat_id: chatId,
          message_id: messageId
        });
        await sendJokeWithButtons(chatId, botInstance);
        await botInstance.answerCallbackQuery(callbackQuery.id);

      } else if (data === 'JOKE_STOP') {
        const stopReplies = [
          'Fine. Here’s a little thought: “A smile is a curve that sets everything straight.”',
          'Alright. Remember: “Laughter is timeless, imagination has no age.”',
          'Okay — keeping it quiet. Thought for the day: “Small smiles make big days.”',
          'Fine. Take care — “Happiness often sneaks in through a door you didn’t know you left open.”',
          'Silent mode on. “Even silence has its own melody.”'
        ];
        const chosen = randomFrom(stopReplies);
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
      console.error('callback_query handler error:', err.message || err);
    }
  });

  // inline_query handler - lets your bot respond to @yourbot queries in other chats
  botInstance.on('inline_query', async (inlineQuery) => {
    try {
      // Provide a single random joke as an inline article result
      const text = await fetchJoke();
      logJoke(inlineQuery.from.id || inlineQuery.id, text);

      const result = [{
        type: 'article',
        id: '' + Date.now() + Math.floor(Math.random() * 1000),
        title: 'Random Joke',
        input_message_content: { message_text: text },
        description: text.length > 80 ? text.slice(0, 77) + '...' : text
      }];
      // answer with no caching so users get fresh jokes
      await botInstance.answerInlineQuery(inlineQuery.id, result, { cache_time: 0 });
    } catch (err) {
      console.error('inline_query handler error:', err.message || err);
    }
  });

} // end registerHandlers

// ==========================
// BOT STARTUP (Polling / Webhook)
// ==========================

if (USE_WEBHOOK) {
  // Webhook mode (for Render, Cloud Run, etc.)
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
      console.error('processUpdate error:', err.message || err);
      res.sendStatus(500);
    }
  });

  app.get('/', (req, res) => res.send('Bot webhook is running.'));

  app.listen(PORT, async () => {
    console.log(`Express server listening on port ${PORT}. Attempting to set webhook...`);
    const webhookUrlFull = `${WEBHOOK_URL.replace(/\/$/, '')}/webhook/${TOKEN}`;
    try {
      await bot.setWebHook(webhookUrlFull);
      console.log('Webhook set to:', webhookUrlFull);
    } catch (err) {
      console.error('Failed to set webhook:', err.message || err);
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
  // Polling mode (for local testing or VPS)
  const bot = new TelegramBot(TOKEN, { polling: true });
  registerHandlers(bot);

  bot.on('polling_error', (err) => {
    console.error('Polling error:', err && err.message ? err.message : err);
  });

  console.log('🤖 Bot started in polling mode.');

  const shutdown = async () => {
    console.log('Shutting down polling...');
    try {
      await bot.stopPolling(true);
      console.log('Polling stopped.');
    } catch (err) {
      console.error('Error while stopping polling:', err.message || err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
