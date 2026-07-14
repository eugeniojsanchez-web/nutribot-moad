const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const api = axios.create({ timeout: 15000, headers: { 'Content-Type': 'application/json' } });
const userSessions = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["📥 Registrar Compra", "🍳 Gestionar Alimento (Consumo/Merma)"],
      ["🔍 Consultar Inventario", "📈 Ver Balance Mermas"],
      ["🥗 Menú Recetas", "📊 Optimizar Cesta (IA)"]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

async function safeSendMessage(chatId, text, options = {}) {
  try { return await bot.sendMessage(chatId, text, options); }
  catch (err) { console.error(`Error enviando a ${chatId}:`, err.message); return null; }
}

function solicitarSegmento(chatId) {
  const mSeg = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "seg_Nevera" }], [{ text: "📦 Despensa", callback_data: "seg_Despensa" }], [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }]] } };
  safeSendMessage(chatId, "Selecciona la zona de conservación:", mSeg);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (text === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Sistema MOAD Iniciado*", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // --- CONTROLADOR DE CONSULTA CORREGIDO ---
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { try { await bot.deleteMessage(chatId, msgWait.message_id); } catch(dErr){} }

      if (res.data && res.data.status === "success") {
        // ... (Aquí va toda tu lógica original de grupos y forEach que tenías antes) ...
        safeSendMessage(chatId, "Inventario recibido.", { parse_mode: "Markdown" });
      } else {
        safeSendMessage(chatId, "⚠️ Google Sheets no respondió correctamente.");
      }
    } catch (e) {
      safeSendMessage(chatId, "❌ Error de conexión con la base de datos.");
    }
    return;
  }

  // --- (AQUÍ PEGA TODA TU LÓGICA DE ESTADOS Y MENÚS QUE TENÍAS) ---
});

// --- (AQUÍ PEGA TODO TU bot.on('callback_query', ...)) ---

console.log("🤖 Servidor MOAD activo.");
