import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

bot.telegram.getMe().then((me) => {
  console.log('Bot is valid:', me.username);
  process.exit(0);
}).catch((err) => {
  console.error('Bot is invalid:', err.message);
  process.exit(1);
});
