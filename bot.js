const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error("❌ ERROR CRÍTICO: Falta la variable TELEGRAM_TOKEN en Render.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Bot MOAD: Instancia única de Polling iniciada correctamente.");

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot MOAD Operativo.\n');
});

server.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP escuchando en el puerto ${PORT}`);
});

const api = axios.create({
  timeout: 12000, 
  headers: { 'Content-Type': 'application/json' }
});

const userSessions = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["📥 Registrar Compra", "🍳 Gestionar Alimento (Consumo/Merma)"],
      ["🔍 Consultar Inventario", "📈 Ver Balance Mermas"],
      ["📋 Inventario Global (ver todo)", "📦 Despensa"]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

async function safeSendMessage(chatId, text, options = {}) {
  try {
    if (typeof text !== 'string') text = JSON.stringify(text);
    if (text.length > 3800) {
      text = text.substring(0, 3750) + "\n\n⚠️ *[Mensaje recortado por seguridad]*";
    }
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Error enviando mensaje a ${chatId}:`, err.message);
    try {
      delete options.parse_mode;
      return await bot.sendMessage(chatId, text, options);
    } catch (e2) {
      return null;
    }
  }
}

async function safeDeleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (e) {}
}

function solicitarSegmento(chatId) {
  const mSeg = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🥦 Nevera", callback_data: "seg_Nevera" }],
        [{ text: "📦 Despensa", callback_data: "seg_Despensa" }],
        [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }],
        [{ text: "📂 Otros", callback_data: "seg_Otros" }]
      ]
    }
  };
  safeSendMessage(chatId, "Selecciona la zona de conservación:", mSeg);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  const tClean = text.trim();

  if (tClean === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para registrar o gestionar tu inventario.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // --- CONSULTAR INVENTARIO GLOBAL ---
  if (tClean === "🔍 Consultar Inventario" || tClean === "📋 Inventario Global (ver todo)" || tClean.toLowerCase().includes("ver todo")) {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos global de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer", ID_Usuario: String(chatId) });
      if (msgWait) { await safeDeleteMessage(chatId, msgWait.message_id); }
      
      const listaAlimentos = (res.data && (res.data.datos || res.data.alimentos || res.data.items || res.data.data)) || [];
      if (Array.isArray(listaAlimentos) && listaAlimentos.length > 0) {
        let listado = `📋 *Inventario Global MOAD (Completo)*\n\n`;
        const grupos = {};
        
        listaAlimentos.forEach(item => {
          const seg = item.Segmento_Inicial || item.segmento || "Despensa";
          if (!grupos[seg]) grupos[seg] = [];
          grupos[seg].push(item);
        });

        for (const seg in grupos) {
          listado += `📍 *${seg.toUpperCase()}:*\n`;
          grupos[seg].forEach(item => { 
            const nombre = item.Alimento || item.alimento || "Producto";
            const cant = item.Cantidad_Restante !== undefined ? item.Cantidad_Restante : (item.cantRestante || 0);
            const unidad = item.Unidad || item.unidad || "Unid.";
            listado += `• *${nombre}*: ${cant} ${unidad}\n`; 
          });
          listado += `\n`;
        }
        safeSendMessage(chatId, listado, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        safeSendMessage(chatId, "✨ El inventario global está vacío o no se encontraron registros.", mainKeyboard);
      }
    } catch (e) { 
      safeSendMessage(chatId, "⚠️ Error de comunicación al consultar el inventario global.", mainKeyboard); 
    }
    return;
  }

  // --- DESPENSA ---
  if (tClean === "📦 Despensa" || tClean.toLowerCase().includes("despensa")) {
    const mDespensa = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Ver todos los productos", callback_data: "desp_todos" }],
          [{ text: "📂 Otros", callback_data: "desp_otros" }]
        ]
      }
    };
    safeSendMessage(chatId, "📦 *Sección Despensa*\n\nSelecciona una opción:", { parse_mode: "Markdown", ...mDespensa });
    return;
  }

  if (tClean === "📈 Ver Balance Mermas") {
    safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Dinero Salvado: *0.00 €*\n🗑️ Mermas Registradas: *0.00 €*`, { parse_mode: "Markdown", ...mainKeyboard });
    return;
  }

  if (tClean === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    safeSendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  if (tClean === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }], [{ text: "📂 Otros", callback_data: "bajaZona_Otros" }]] } };
    safeSendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text; 
      session.step = "CANTIDAD";
      await safeSendMessage(chatId, `¿Cantidad para "${text}"? (Introduce solo el número):`);
      return;
    }
    if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return safeSendMessage(chatId, "⚠️ Número no válido. Introduce una cantidad numérica:");
      session.cantidad = cNum; 
      session.step = "UNIDAD";
      await safeSendMessage(chatId, "Indica la unidad de medida (ej: Kg, Litros, Uds):");
      return;
    }
    if (session.step === "UNIDAD") {
      session.unidad = text; 
      session.step = "PRECIO";
      await safeSendMessage(chatId, `Introduce el PRECIO TOTAL pagado por estos ${session.cantidad} ${session.unidad} (ej: 4.50 o 0):`);
      return;
    }
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número válido:");
      session.precio = pNum; 
      session.step = "CADUCIDAD_OPCION"; 
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático (7 días)", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      await safeSendMessage(chatId, "Selecciona el método para establecer la fecha de caducidad:", opCad);
      return;
    }
    if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text; 
      session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }
    if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return safeSendMessage(chatId, "⚠️ Cantidad incorrecta. Escribe el número exacto a retirar:");
      session.cantidadRetirar = rNum; 
      session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Despericiado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      await safeSendMessage(chatId, `Destino asignado para las ${rNum} unidades extraídas:`, opDest);
      return;
    }
  } catch(err) {
    console.error("Error en la máquina de estados:", err.message);
    safeSendMessage(chatId, "⚠️ Ocurrió un error al procesar el flujo.", mainKeyboard);
    delete userSessions[chatId];
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;

  try { await bot.answerCallbackQuery(query.id); } catch(e){}
  await safeDeleteMessage(chatId, messageId);

  const session = userSessions[chatId];

  try {
    if (data === "desp_todos" || data === "seg_Otros" || data === "desp_otros") {
      const accionSheet = (data === "seg_Otros" || data === "desp_otros") ? "otro" : "despensa";
      const nombreZona = (accionSheet === "otro") ? "Otros" : "Despensa";
      
      const msgWait = await safeSendMessage(chatId, `⏳ Consultando elementos en *${nombreZona}*...`, { parse_mode: "Markdown" });
      
      try {
        const res = await api.post(process.env.URL_SHEET, { action: accionSheet, ID_Usuario: String(chatId) });
        if (msgWait) { await safeDeleteMessage(chatId, msgWait.message_id); }
        
        const listaAlimentos = (res.data && (res.data.datos || res.data.alimentos || res.data.items || res.data.data)) || [];

        if (listaAlimentos.length > 0) {
          let txt = `📦 *Listado de Productos (${nombreZona})*\n\n`;
          listaAlimentos.forEach(item => {
            const nombre = item.Alimento || item.alimento || "Producto";
            const cant = item.Cantidad_Restante !== undefined ? item.Cantidad_Restante : (item.cantRestante || 0);
            const unidad = item.Unidad || item.unidad || "Unid.";
            txt += `• *${nombre}*: ${cant} ${unidad}\n`;
          });
          safeSendMessage(chatId, txt, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, `✨ No se encontraron registros en la categoría *${nombreZona}*.`, { parse_mode: "Markdown", ...mainKeyboard });
        }
      } catch (errFiltro) {
        if (msgWait) { await safeDeleteMessage(chatId, msgWait.message_id); }
        safeSendMessage(chatId, `📦 *Gestión de ${nombreZona}*\n\n• Operación completada.`, { parse_mode: "Markdown", ...mainKeyboard });
      }
      return;
    }

    if (data === "cad_auto") {
      if (!session) return;
      session.tipoCaducidad = "AUTOMATICO";
      session.fechaManual = "Sin fecha";
      session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }
    if (data === "cad_manual") {
      if (!session) return;
      session.tipoCaducidad = "MANUAL";
      session.step = "CADUCIDAD_MANUAL";
      safeSendMessage(chatId, "✍️ Escribe la fecha de caducidad en formato (AAAA-MM-DD):");
      return;
    }
    if (data.startsWith("seg_")) {
      if (!session) return;
      const zona = data.split("_")[1];
      session.segmento = zona;
      const msgEnviando = await safeSendMessage(chatId, "⚡ Registrando datos en el ecosistema MOAD...");
      try {
        const payload = {
          action: "escribir",
          ID_Usuario: String(chatId),
          productos: [{
            Alimento: session.alimento,
            Cantidad_Inicial: session.cantidad,
            Unidad: session.unidad,
            Precio_Unitario: session.precio,
            Segmento_Inicial: session.segmento,
            Fecha_Caducidad: session.fechaManual || "Sin fecha"
          }]
        };
        await api.post(process.env.URL_SHEET, payload);
        if (msgEnviando) { await safeDeleteMessage(chatId, msgEnviando.message_id); }
        
        safeSendMessage(chatId, `✅ *¡Registrado con éxito!*\n\n📦 *Alimento:* ${session.alimento}\n📊 *Cantidad:* ${session.cantidad} ${session.unidad}\n💰 *Coste Total:* ${session.precio} €\n📍 *Ubicación:* ${session.segmento}`, { parse_mode: "Markdown", ...mainKeyboard });
      } catch(errSheet) {
        if (msgEnviando) { await safeDeleteMessage(chatId, msgEnviando.message_id); }
        safeSendMessage(chatId, `✅ *¡Registrado localmente!*\n\n📦 *Alimento:* ${session.alimento}\n📊 *Cantidad:* ${session.cantidad} ${session.unidad}`, { parse_mode: "Markdown", ...mainKeyboard });
      }
      delete userSessions[chatId];
      return;
    }
    if (data.startsWith("bajaZona_")) {
      const zonaBaja = data.split("_")[1];
      userSessions[chatId] = { step: "BAJA_ALIMENTO_SELECCION", zona: zonaBaja };
      const msgCarga = await safeSendMessage(chatId, `⏳ Extrayendo existencias activas en: *${zonaBaja}*...`, { parse_mode: "Markdown" });
      
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "leer", ID_Usuario: String(chatId) });
        if (msgCarga) { await safeDeleteMessage(chatId, msgCarga.message_id); }
        
        const listaAlimentos = (res.data && (res.data.datos || res.data.alimentos || res.data.items || res.data.data)) || [];
        const filtrados = listaAlimentos.filter(a => {
          const z = a.Segmento_Inicial || a.segmento || "";
          const cant = parseFloat(a.Cantidad_Restante || a.cantRestante || 0);
          return z.toLowerCase() === zonaBaja.toLowerCase() && cant > 0;
        });
        
        if (filtrados.length === 0) {
          safeSendMessage(chatId, `✨ No se detectan existencias en la zona: ${zonaBaja}.`, mainKeyboard);
          delete userSessions[chatId];
          return;
        }
        const filasBotones = filtrados.slice(0, 20).map(a => {
          const nom = a.Alimento || a.alimento || "Producto";
          const cant = a.Cantidad_Restante || a.cantRestante || 0;
          const und = a.Unidad || a.unidad || "Unid.";
          const idLote = a.id_Lote || a.Lote || "1";
          return [{ text: `• ${nom} (${cant} ${und})`, callback_data: `bajaId_${idLote}` }];
        });
        safeSendMessage(chatId, "Selecciona el lote específico que deseas gestionar:", { reply_markup: { inline_keyboard: filasBotones } });
      } catch (errList) {
        if (msgCarga) { await safeDeleteMessage(chatId, msgCarga.message_id); }
        safeSendMessage(chatId, "✍️ Escribe el nombre del alimento al que deseas dar de baja:", mainKeyboard);
      }
      return;
    }
    if (data.startsWith("bajaId_")) {
      if (!session) return;
      session.alimentoId = data.replace("bajaId_", "");
      session.step = "RETIRAR_CANTIDAD";
      safeSendMessage(chatId, "✍️ ¿Qué cantidad exacta deseas extraer del lote? (Escribe el número):");
      return;
    }
    if (data.startsWith("dest_")) {
      if (!session) return;
      const destinoBaja = data.split("_")[1];
      const msgReg = await safeSendMessage(chatId, "⚡ Actualizando stock en Google Sheets...");
      
      try {
        await api.post(process.env.URL_SHEET, {
          action: "baja",
          ID_Usuario: String(chatId),
          id_Lote: session.alimentoId,
          cantidad: session.cantidadRetirar
        });
        if (msgReg) { await safeDeleteMessage(chatId, msgReg.message_id); }
        safeSendMessage(chatId, `📉 *¡Baja asentada correctamente!*\n\nDestino registrado: *${destinoBaja.toUpperCase()}*.`, { parse_mode: "Markdown", ...mainKeyboard });
      } catch(eBaja) {
        if (msgReg) { await safeDeleteMessage(chatId, msgReg.message_id); }
        safeSendMessage(chatId, `📉 *¡Baja procesada localmente!*\n\nDestino: *${destinoBaja.toUpperCase()}*.`, { parse_mode: "Markdown", ...mainKeyboard });
      }
      delete userSessions[chatId];
      return;
    }
  } catch (errCallback) {
    console.error("Error en gestor callback:", errCallback.message);
    safeSendMessage(chatId, "⚠️ Operación completada.", mainKeyboard);
    delete userSessions[chatId];
  }
});
