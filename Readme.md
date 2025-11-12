# 🤖 Tele-Joke Bot

A fun, lightweight Telegram bot that delivers random jokes instantly! Built with Node.js, Express, and the official Telegram Bot API.

## 🌟 Features

* /start → Welcomes users and shows quick buttons.
* /joke → Sends a random joke from the Official Joke API.
* /help → Shows how to use the bot in a friendly, formatted guide.
* /about → Displays bot info and credits.
* Smart natural replies — users an simply type “hi”, “hello”, or “tell me a joke” without using slash commands.
* Inline buttons: 😂 Another (fetches a new joke) and 🛑 Stop (stops and shows a positive quote).
* Inline query support — type @tele611bot in any Telegram chat to get jokes without leaving the chat. Automatic joke logging (jokes.log).

## 🧰 Tech Stack

1. Node.js
2. Express
3. Axios
4. node-telegram-bot-api
5. dotenv

## 🛠️ Run

Locally

1. Clone the repository:

```
git clone https://github.com/Karthik-Kathari/Telejoke_bot.git
cd Telejoke_bot
```

2. Install dependencies:

```
npm install
```

3. Create a .env file in the project root and add:

```
BOT_TOKEN=your_telegram_bot_token 
WEBHOOK_URL= PORT=3000
```

4. Run locally (polling mode):

```
npm start
```

## 💬 Example Commands

* /start — Start the bot and get a greeting
* /joke — Get a random joke instantly
* /help — See how to use the bot
* /about — About Tele-Joke Bot

## 🧑‍💻 Owner & Developer

**Karthik Kathari**

[🔗 LinkedIn Profile](https://www.linkedin.com/in/karthikkathari/)

## 📜 License

This project is licensed under the MIT
License — free to use and modify with attribution.
