from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from config import settings
import asyncio
import logging

logger = logging.getLogger(__name__)


class TelegramChannel:
    def __init__(self, agent_runner_factory=None, ws_manager=None):
        self.app = None
        self.agent_runner_factory = agent_runner_factory
        self.ws_manager = ws_manager
        self._running = False

    async def start(self, token: str):
        if not token or token == "your-telegram-bot-token-here":
            logger.warning("Telegram bot token not configured, skipping.")
            return

        try:
            self.app = Application.builder().token(token).build()
            self.app.add_handler(CommandHandler("start", self._cmd_start))
            self.app.add_handler(CommandHandler("help", self._cmd_help))
            self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_message))

            await self.app.initialize()
            await self.app.start()
            self._running = True
            logger.info("Telegram bot started successfully.")

            # Start polling in background
            await self.app.updater.start_polling(drop_pending_updates=True)
        except Exception as e:
            logger.error(f"Failed to start Telegram bot: {e}")

    async def stop(self):
        if self.app and self._running:
            try:
                await self.app.updater.stop()
                await self.app.stop()
                await self.app.shutdown()
                self._running = False
            except Exception as e:
                logger.error(f"Error stopping Telegram bot: {e}")

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "Hello! I'm your AI Agent assistant. Send me a message and I'll process it through the configured workflow.\n\n"
            "Use /help for more information."
        )

    async def _cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "Available commands:\n"
            "/start - Start the bot\n"
            "/help - Show this help\n\n"
            "Just send any message to interact with the AI agents!"
        )

    async def _handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_message = update.message.text
        user_id = str(update.effective_user.id)
        chat_id = update.effective_chat.id

        await update.message.reply_text("Processing your request...")

        if self.ws_manager:
            await self.ws_manager.broadcast({
                "type": "telegram_message",
                "from": update.effective_user.username or user_id,
                "content": user_message,
            })

        if self.agent_runner_factory:
            try:
                runner, execution_id = await self.agent_runner_factory(user_message, user_id)
                if runner:
                    response, tokens = await runner.run(
                        user_message,
                        user_id=user_id,
                        thread_id=f"telegram-{user_id}",
                        broadcast=self.ws_manager.broadcast if self.ws_manager else None,
                        execution_id=execution_id,
                    )
                    await update.message.reply_text(response or "I processed your request but have no response.")
                else:
                    await update.message.reply_text("No Telegram-enabled agent could handle that request.")
            except Exception as e:
                logger.error(f"Agent error: {e}")
                await update.message.reply_text(f"Error processing your request: {str(e)[:200]}")
        else:
            await update.message.reply_text(
                "No agents are configured for Telegram yet. Please set up an agent in the platform UI."
            )
