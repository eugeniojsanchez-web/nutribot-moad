const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Inicialización del Bot
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Instancia optimizada de Axios
const api = axios.create({
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

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
  catch (err) { console.error(`Error enviando mensaje a ${chatId}:`, err.message); return null; }
}

function solicitarSegmento(chatId) {
  const mSeg = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🥦 Nevera", callback_data: "seg_Nevera" }],
        [{ text: "📦 Despensa", callback_data: "seg_Despensa" }],
        [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }]
      ]
    }
  };
  safeSendMessage(chatId, "Selecciona la zona de conservación:", mSeg);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (text === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para registrar o gestionar sin bloqueos.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { try { await bot.deleteMessage(chatId, msgWait.message_id); } catch(dErr){} }

      if (res.data && res.data.status === "success") {
        if (Array.isArray(res.data.alimentos) && res.data.alimentos.length > 0) {
          let listado = `📋 *Inventario Actual MOAD*\n\n`;
          const grupos = {};
          res.data.alimentos.forEach(item => {
            if (!item.segmento) return;
            if (!grupos[item.segmento]) grupos[item.segmento] = [];
            grupos[item.segmento].push(item);
          });
          for (const seg in grupos) {
            listado += `📍 *${seg.toUpperCase()}:*\n`;
            grupos[seg].forEach(item => { listado += `• *${item.alimento}*: ${item.cantRestante} ${item.unidad}\n`; });
            listado += `\n`;
          }
          safeSendMessage(chatId, listado, { parse_mode: "Markdown" });
        } else {
          safeSendMessage(chatId, "✨ El inventario está vacío actualmente.");
        }
      } else {
        safeSendMessage(chatId, "⚠️ Error de comunicación: Google Sheets no devolvió los datos correctamente.");
      }
    } catch (e) {
      safeSendMessage(chatId, "❌ La consulta tardó demasiado o la base de datos no responde.");
    }
    return;
  }

  if (text === "📈 Ver Balance Mermas") {
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "balance" });
      if (res.data && res.data.balance) {
        safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Aprovechado: *${(res.data.balance.dineroSalvado || 0).toFixed(2)} €*\n🗑️ Mermas: *${(res.data.balance.dineroPerdido || 0).toFixed(2)} €*`, { parse_mode: "Markdown" });
      } else {
        safeSendMessage(chatId, "⚠️ No se han podido calcular los balances actuales.");
      }
    } catch(err) {
      safeSendMessage(chatId, "❌ Error al obtener el balance desde Google Sheets.");
    }
    return;
  }

  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    safeSendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]] } };
    safeSendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  if (text === "🥗 Menú Recetas") {
    const tRec = { reply_markup: { inline_keyboard: [[{ text: "🚨 Uso Inmediato", callback_data: "rec_urgente" }], [{ text: "🍲 Ideas por Zona", callback_data: "rec_zona" }], [{ text: "✨ Receta con Sobras", callback_data: "rec_sobras" }]] } };
    safeSendMessage(chatId, "🥗 *Planificación y Aprovechamiento:*", tRec);
    return;
  }

  if (text === "📊 Optimizar Cesta (IA)") {
    const tAnalisis = { reply_markup: { inline_keyboard: [[{ text: "🗓️ Última Semana (7 días)", callback_data: "an_7" }, { text: "📅 Último Mes (30 días)", callback_data: "an_30" }], [{ text: "📊 Trimestre (90 días)", callback_data: "an_90" }, { text: "📈 Año Completo (365 días)", callback_data: "an_365" }]] } };
    safeSendMessage(chatId, "📊 *Inteligencia de Consumo*\n\nSelecciona la ventana temporal para evaluar existencias:", { parse_mode: "Markdown", ...tAnalisis });
    return;
  }

  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text;
      session.step = "CANTIDAD";
      await safeSendMessage(chatId, `¿Cantidad para "${text}"? (Solo número):`);
    } else if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return safeSendMessage(chatId, "⚠️ Número no válido. Introduce un número válido:");
      session.cantidad = cNum;
      session.step = "UNIDAD";
      await safeSendMessage(chatId, "Indica unidad (ej: Kg, Litros, Uds):");
    } else if (session.step === "UNIDAD") {
      session.unidad = text;
      session.step = "PRECIO";
      await safeSendMessage(chatId, `Introduce el PRECIO TOTAL para ${session.cantidad} ${session.unidad} (ej: 7 o 0 si es gratis):`);
    } else if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número válido:");
      session.precio = pNum;
      session.step = "CADUCIDAD_OPCION";
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      await safeSendMessage(chatId, "Selecciona el método de caducidad:", opCad);
    } else if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text;
      session.step = "SEGMENTO";
      solicitarSegmento(chatId);
    } else if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return safeSendMessage(chatId, "⚠️ Cantidad incorrecta. Introduce un número:");
      session.cantidadRetirar = rNum;
      session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      await safeSendMessage(chatId, `Destino para ${rNum} unidades:`, opDest);
    } else if (session.step === "INPUT_SOBRAS") {
      await safeSendMessage(chatId, "🍳 *Respuesta del Chef MOAD:* Con los ingredientes indicados, te sugiero realizar un salteado rápido en sartén con ajo y un huevo batido.", mainKeyboard);
      delete userSessions[chatId];
    }
  } catch(err) {
    safeSendMessage(chatId, "⚠️ Error procesando los datos. Cancelando.", mainKeyboard);
    delete userSessions[chatId];
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;
  try { await bot.answerCallbackQuery(query.id); } catch(e){}
  const session = userSessions[chatId];
  
  if (data === "cad_auto" && session) {
    session.tipoCaducidad = "AUTOMATICO";
    session.step = "SEGMENTO";
    try { await bot.deleteMessage(chatId, messageId); } catch(e){}
    solicitarSegmento(chatId);
  } else if (data === "cad_manual" && session) {
    session.tipoCaducidad = "MANUAL";
    session.step = "CADUCIDAD_MANUAL";
    try { await bot.deleteMessage(chatId, messageId); } catch(e){}
    safeSendMessage(chatId, "✍️ Introduce la fecha de caducidad (ej: 2026-07-20):");
  } else if (data.startsWith("seg_") && session) {
    session.segmento = data.split("_")[1];
    try { await bot.deleteMessage(chatId, messageId); } catch(e){}
    const res = await api.post(process.env.URL_SHEET, { action: "escribir", ...session });
    if (res.data?.status === "success") {
      safeSendMessage(chatId, "✅ ¡Registrado con éxito!", { ...mainKeyboard });
    } else {
      safeSendMessage(chatId, "⚠️ Error al guardar en Sheets.", mainKeyboard);
    }
    delete userSessions[chatId];
  } else if (data.startsWith("bajaZona_")) {
    const zona = data.split("_")[1];
    const res = await api.post(process.env.URL_SHEET, { action: "leer" });
    const filtrados = res.data?.alimentos?.filter(a => a.segmento === zona && a.cantRestante > 0) || [];
    if (filtrados.length === 0) return safeSendMessage(chatId, "✨ Sin existencias en esta zona.");
    const kb = filtrados.map(a => [{ text: `• ${a.alimento} (${a.cantRestante})`, callback_data: `bajaId_${a.id}` }]);
    safeSendMessage(chatId, "Selecciona el artículo:", { reply_markup: { inline_keyboard: kb } });
  } else if (data.startsWith("bajaId_")) {
    userSessions[chatId] = { step: "RETIRAR_CANTIDAD", alimentoId: data.split("_")[1] };
    safeSendMessage(chatId, "✍️ ¿Qué cantidad vas a retirar?");
  } else if (data.startsWith("dest_") && session) {
    const res = await api.post(process.env.URL_SHEET, { action: "baja", id: session.alimentoId, cantidadRetirar: session.cantidadRetirar, destino: data.split("_")[1] });
    if (res.data?.status === "success") safeSendMessage(chatId, "📉 ¡Retirada procesada!", mainKeyboard);
    delete userSessions[chatId];
  }
});
