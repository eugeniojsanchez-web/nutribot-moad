const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

// Configuración de variables de entorno
const token = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 10000;
const url = 'https://nutribot-moad.onrender.com'; // URL de tu servicio en Render

// Inicialización del bot en modo Webhook para Render
const bot = new TelegramBot(token, { webHook: { port: PORT } });
bot.setWebHook(`${url}/bot${token}`);

// Configuración de la API para conectar con Google Sheets
const api = axios.create({
  timeout: 15000, 
  headers: { 'Content-Type': 'application/json' }
});

// Almacenamiento temporal de estados de usuario
const userSessions = {};

// Teclado principal de la aplicación
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

// Función auxiliar segura para el envío de mensajes
async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Error enviando mensaje a ${chatId}:`, err.message);
    return null;
  }
}

// Función auxiliar para solicitar la zona de almacenamiento
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

// ====================================================================
// 📥 GESTOR DE MENSAJES ENTRANTE (TEXTO)
// ====================================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (text === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para registrar o gestionar tu inventario sin bloqueos.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // 🔍 MENU: Consultar Inventario
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

  // 📈 MENU: Ver Balance de Mermas
  if (text === "📈 Ver Balance Mermas") {
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "balance" });
      if (res.data && res.data.balance) {
        safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Aprovechado: *${(res.data.balance.dineroSalvado || 0).toFixed(2)} €*\n🗑️ Mermas (Desperdiciado): *${(res.data.balance.dineroPerdido || 0).toFixed(2)} €*`, { parse_mode: "Markdown" });
      } else {
        safeSendMessage(chatId, "⚠️ No se han podido calcular los balances actuales.");
      }
    } catch(err) {
      safeSendMessage(chatId, "❌ Error al obtener el balance desde Google Sheets.");
    }
    return;
  }

  // 📥 MENU: Registrar Compra
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    safeSendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  // 🍳 MENU: Gestionar Alimento (Consumo/Baja)
  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]] } };
    safeSendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  // 🥗 MENU: Recetas (Informativo de flujo)
  if (text === "🥗 Menú Recetas") {
    const tRec = { reply_markup: { inline_keyboard: [[{ text: "🚨 Uso Inmediato", callback_data: "rec_urgente" }], [{ text: "🍲 Ideas por Zona", callback_data: "rec_zona" }], [{ text: "✨ Receta con Sobras", callback_data: "rec_sobras" }]] } };
    safeSendMessage(chatId, "🥗 *Planificación y Aprovechamiento:*", tRec);
    return;
  }

  // 📊 MENU: Optimizar Cesta por IA (Informativo de flujo)
  if (text === "📊 Optimizar Cesta (IA)") {
    const tAnalisis = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗓️ Última Semana (7 días)", callback_data: "an_7" }, { text: "📅 Último Mes (30 días)", callback_data: "an_30" }],
          [{ text: "📊 Trimestre (90 días)", callback_data: "an_90" }, { text: "📈 Año Completo (365 días)", callback_data: "an_365" }]
        ]
      }
    };
    safeSendMessage(chatId, "📊 *Inteligencia de Consumo*\n\nSelecciona la ventana temporal para evaluar existencias:", { parse_mode: "Markdown", ...tAnalisis });
    return;
  }

  // Máquina de estados conversacionales (Flujos guiados)
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
      await safeSendMessage(chatId, `Introduce el PRECIO TOTAL pagado por estos ${session.cantidad} ${session.unidad} (ej: 4.50 o 0 si es un regalo):`);
      return;
    }
    
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Por favor introduce un número válido:");
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
    safeSendMessage(chatId, "⚠️ Ocurrió un error al procesar el flujo. Operación cancelada.", mainKeyboard);
    delete userSessions[chatId];
  }
});

// ====================================================================
// 🎛️ GESTOR DE LLAMADAS CALLBACK (BOTONES EN LÍNEA)
// ====================================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;
  try { await bot.answerCallbackQuery(query.id); } catch(e){}
  const session = userSessions[chatId];

  try {
    if (data === "cad_auto") {
      if (!session) return;
      session.tipoCaducidad = "AUTOMATICO";
      session.step = "SEGMENTO";
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      solicitarSegmento(chatId);
      return;
    }
    if (data === "cad_manual") {
      if (!session) return;
      session.tipoCaducidad = "MANUAL";
      session.step = "CADUCIDAD_MANUAL";
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      safeSendMessage(chatId, "✍️ Escribe la fecha de caducidad en formato (AAAA-MM-DD):");
      return;
    }
    if (data.startsWith("seg_")) {
      if (!session) return;
      const zona = data.split("_")[1];
      session.segmento = zona;
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgEnviando = await safeSendMessage(chatId, "⚡ Registrando datos en el ecosistema MOAD...");
      try {
        const payload = {
          action: "escribir",
          alimento: session.alimento,
          cantidad: session.cantidad,
          unidad: session.unidad,
          precio: session.precio, 
          tipoCaducidad: session.tipoCaducidad,
          fechaManual: session.fechaManual || "",
          segmento: session.segmento
        };
        
        const res = await api.post(process.env.URL_SHEET, payload);
        if (msgEnviando) { try { await bot.deleteMessage(chatId, msgEnviando.message_id); } catch(e){} }
        
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `✅ *¡Registrado con éxito!*\n\n📦 *Alimento:* ${session.alimento}\n📊 *Cantidad:* ${session.cantidad} ${session.unidad}\n💰 *Coste Total:* ${session.precio} €\n📍 *Ubicación:* ${session.segmento}`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, "⚠️ Google Sheets no pudo procesar la inserción.", mainKeyboard);
        }
      } catch(errSheet) {
        if (msgEnviando) { try { await bot.deleteMessage(chatId, msgEnviando.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ Falla de red severa al intentar persistir los datos en Google Sheets.", mainKeyboard);
      }
      delete userSessions[chatId];
      return;
    }
    if (data.startsWith("bajaZona_")) {
      const zonaBaja = data.split("_")[1];
      userSessions[chatId] = { step: "BAJA_ALIMENTO_SELECCION", zona: zonaBaja };
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgCarga = await safeSendMessage(chatId, `⏳ Extrayendo existencias activas en: *${zonaBaja}*...`, { parse_mode: "Markdown" });
      
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "leer" });
        if (msgCarga) { try { await bot.deleteMessage(chatId, msgCarga.message_id); } catch(e){} }
        if (res.data && res.data.status === "success" && Array.isArray(res.data.alimentos)) {
          const filtrados = res.data.alimentos.filter(a => a.segmento === zonaBaja && parseFloat(a.cantRestante) > 0);
          
          if (filtrados.length === 0) {
            safeSendMessage(chatId, `✨ No se detectan existencias remanentes en la zona: ${zonaBaja}.`, mainKeyboard);
            delete userSessions[chatId];
            return;
          }
          const filasBotones = filtrados.map(a => [{ text: `• ${a.alimento} (${a.cantRestante} ${a.unidad})`, callback_data: `bajaId_${a.id}` }]);
          safeSendMessage(chatId, "Selecciona el lote específico que deseas gestionar:", { reply_markup: { inline_keyboard: filasBotones } });
        } else {
          safeSendMessage(chatId, "⚠️ Error estructural al interrogar el inventario activo.", mainKeyboard);
        }
      } catch (errList) {
        if (msgCarga) { try { await bot.deleteMessage(chatId, msgCarga.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ Error crítico de comunicación al recuperar listados.", mainKeyboard);
        delete userSessions[chatId];
      }
      return;
    }
    if (data.startsWith("bajaId_")) {
      if (!session) return;
      session.alimentoId = data.split("_")[1];
      session.step = "RETIRAR_CANTIDAD";
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      safeSendMessage(chatId, "✍️ ¿Qué cantidad exacta deseas extraer del lote? (Escribe el número):");
      return;
    }
    if (data.startsWith("dest_")) {
      if (!session) return;
      const destinoBaja = data.split("_")[1];
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgProcesandoBaja = await safeSendMessage(chatId, "📉 Sincronizando modificaciones de stock...");
      try {
        const res = await api.post(process.env.URL_SHEET, {
          action: "baja",
          id: session.alimentoId,
          cantidadRetirar: session.cantidadRetirar,
          destino: destinoBaja
        });
        
        if (msgProcesandoBaja) { try { await bot.deleteMessage(chatId, msgProcesandoBaja.message_id); } catch(e){} }
        
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `📉 *¡Baja asentada correctamente!*\n\nSe extrajeron *${session.cantidadRetirar}* unidades. Destino contable: *${destinoBaja.toUpperCase()}*.`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, `⚠️ Denegado por la base de datos: ${res.data.message || 'Error desconocido'}.`, mainKeyboard);
        }
      } catch(errBajaEj) {
        if (msgProcesandoBaja) { try { await bot.deleteMessage(chatId, msgProcesandoBaja.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ Error de sincronización extrema: El servidor Sheets no responde.", mainKeyboard);
      }
      delete userSessions[chatId];
      return;
    }
  } catch (errCallback) {
    console.error("Error en gestor callback:", errCallback.message);
    safeSendMessage(chatId, "⚠️ Operación interrumpida prematuramente.", mainKeyboard);
    delete userSessions[chatId];
  }
});

// ====================================================================
// 🌐 SERVIDOR DE WEBHOOKS INTEGRADO (Para Render Web Service)
// ====================================================================
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === `/bot${token}`) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        bot.processUpdate(obj);
      } catch (e) {
        console.error("Fallo crítico parseando Update de Telegram:", e.message);
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MOAD Engine Activo y Operando en Modo Webhook Nivel Emisario\n');
  }
});

server.listen(PORT, () => {
  console.log(`📡 Servidor de Webhooks MOAD escuchando en el puerto ${PORT}`);
});
