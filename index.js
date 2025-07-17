const Telegrambot = require('node-telegram-bot-api');
const dotenv = require('dotenv'); 
const axios = require('axios');
dotenv.config();

// Token fetched using BotFather to create a new bot
const TOKEN = process.env.BOT_TOKEN;

// Create a new instance of the TelegramBot class
// The polling option is set to true to receive updates from Telegram
const bot = new Telegrambot(TOKEN, { polling: true });

bot.addListener('message', (msg) => {
  const text = msg.text; // Get the text from the message
  console.log("Message received : ", text);
  bot.sendMessage(msg.chat.id, "You said: " + text); // Echo the message back to the user
})

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id; // Get the chat ID from the message
  bot.sendMessage(chatId, "Welcome, how can I help you today!\n\nTry /joke to hear a fun joke."); // Send a welcome message
})

bot.onText(/\/joke/,async (msg) => {
  const joke = await axios.get('https://official-joke-api.appspot.com/random_joke');
  const setup = joke.data.setup; // Get the setup of the joke
  const punchline = joke.data.punchline; // Get the punchline of the joke
  bot.sendMessage(msg.chat.id, setup + " " + punchline);
  // Fetch a random joke from the JokeAPI
})
