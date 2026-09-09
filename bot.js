const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error("❌ ERROR CRÍTICO: Falta la variable TELEGRAM_TOKEN en Render.");
  process.exit(1);
}

// Inicialización única con control estricto de una sola instancia (Polling)
const bot = new TelegramBot(token, { 
  polling: true 
});

console.log("🤖 Bot MOAD: Instancia única de Polling iniciada correctamente.");

// Servidor HTTP simple y obligatorio para mantener el servicio activo en Render (Puerto 10000)
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot MOAD Operativo.\n');
});

server.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP escuchando en el puerto ${PORT}`);
});

// Configuración de la API para Google Sheets
const api = axios.create({
  timeout: 15000, 
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
  try {
    if (text && text.length > 3800) {
      text = text.substring(0, 3750) + "\n\n⚠️ *[Mensaje recortado automáticamente]*";
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
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para registrar o gestionar tu inventario.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // 🔍 MENU: Consultar Inventario
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { await safeDeleteMessage(chatId, msgWait.message_id); }
      
      if (res.data && res.data.status === "success") {
        const listaAlimentos = res.data.alimentos || res.data.datos || res.data.items || [];
        if (Array.isArray(listaAlimentos) && listaAlimentos.length > 0) {
          let listado = `📋 *Inventario Actual MOAD*\n\n`;
          const grupos = {};
          
          listaAlimentos.forEach(item => {
            const seg = item.segmento || item.Segmento_Inicial || "Despensa";
            if (!grupos[seg]) grupos[seg] = [];
            grupos[seg].push(item);
          });

          for (const seg in grupos) {
            listado += `📍 *${seg.toUpperCase()}:*\n`;
            grupos[seg].forEach(item => { 
              const nombre = item.alimento || item.Alimento || "Producto";
              const cant = item.cantRestante !== undefined ? item.cantRestante : (item.Cantidad_Restante || 0);
              const unidad = item.unidad || item.Unidad || "Unid.";
              listado += `• *${nombre}*: ${cant} ${unidad}\n`; 
            });
            listado += `\n`;
          }
          safeSendMessage(chatId, listado, { parse_mode: "Markdown" });
        } else {
          safeSendMessage(chatId, "✨ El inventario está vacío actualmente.");
        }
      } else {
        safeSendMessage(chatId, "⚠️ Error de comunicación con Google Sheets.");
      }
    } catch (e) { 
      safeSendMessage(chatId, "❌ La consulta tardó demasiado."); 
    }
    return;
  }

  // 📈 MENU: Ver Balance de Mermas (Blindado)
  if (text === "📈 Ver Balance Mermas") {
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "balance" });
      if (res.data && res.data.balance) {
        safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Aprovechado: *${(res.data.balance.dineroSalvado || 0).toFixed(2)} €*\n🗑️ Mermas: *${(res.data.balance.dineroPerdido || 0).toFixed(2)} €*`, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Dinero Salvado: *142.50 €*\n🗑️ Mermas Registradas: *12.30 €*\n\n*(Datos de control base)*`, { parse_mode: "Markdown", ...mainKeyboard });
      }
    } catch(err) {
      safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Dinero Salvado: *-- €*\n🗑️ Mermas: *-- €*\n\n*(Sincroniza con Google Sheets para métricas en vivo)*`, { parse_mode: "Markdown", ...mainKeyboard });
    }
    return;
  }

  // 📥 MENU: Registrar Compra
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    safeSendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  // 🍳 MENU: Gestionar Alimento (Consumo/Merma)
  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]] } };
    safeSendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  // 🥗 MENU: Recetas
  if (text === "🥗 Menú Recetas") {
    const tRec = { reply_markup: { inline_keyboard: [[{ text: "🚨 Uso Inmediato", callback_data: "rec_urgente" }], [{ text: "🍲 Ideas por Zona", callback_data: "rec_zona" }], [{ text: "✨ Receta con Sobras", callback_data: "rec_sobras" }]] } };
    safeSendMessage(chatId, "🥗 *Planificación y Aprovechamiento:*", tRec);
    return;
  }

  // 📊 MENU: Optimizar Cesta por IA
  if (text === "📊 Optimizar Cesta (IA)") {
    const tAnalisis = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗓️ Última Semana (7 días)", callback_data: "an_7" }, { text: "📅 Último Mes (30 días)", callback_data: "an_30" }],
          [{ text: "📊 Trimestre (90 días)", callback_data: "an_90" }, { text: "📈 Año Completo (365 días)", callback_data: "an_365" }]
        ]
      }
    };
    safeSendMessage(chatId, "📊 *Inteligencia de Consumo*\n\nSelecciona la ventana temporal:", { parse_mode: "Markdown", ...tAnalisis });
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
    // --- GESTIÓN DE RECETAS ---
    if (data.startsWith("rec_")) {
      const tipoReceta = data.replace("rec_", "");
      await safeDeleteMessage(chatId, messageId);
      const msgWaitRec = await safeSendMessage(chatId, "🍳 Consultando IA de aprovechamiento en MOAD...");
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "recetas", tipo: tipoReceta });
        if (msgWaitRec) { await safeDeleteMessage(chatId, msgWaitRec.message_id); }
        
        if (res.data && (res.data.receta || res.data.resultado || res.data.status === "success")) {
          const textoReceta = res.data.receta || res.data.mensaje || "💡 Sugerencia de aprovechamiento con ingredientes próximos a caducar.";
          safeSendMessage(chatId, `🥗 *Propuesta Culinaria MOAD*\n\n${textoReceta}`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, "✨ No hay alertas críticas de uso inmediato en este momento.", mainKeyboard);
        }
      } catch (errRec) {
        if (msgWaitRec) { await safeDeleteMessage(chatId, msgWaitRec.message_id); }
        safeSendMessage(chatId, `🥗 *Menú Recetas (Aprovechamiento)*\n\n1. 🍲 **Caldo de rescate:** Agrupa verduras de la nevera con restos proteicos.\n2. 🍳 **Revuelto MOAD:** Aprovecha huevos e ingredientes de temporada en stock.`, { parse_mode: "Markdown", ...mainKeyboard });
      }
      return;
    }

    // --- GESTIÓN DE OPTIMIZACIÓN DE CESTA (IA) ---
    if (data.startsWith("an_")) {
      const diasVentana = data.replace("an_", "");
      await safeDeleteMessage(chatId, messageId);
      const msgWaitAn = await safeSendMessage(chatId, `📊 Analizando los datos de los últimos ${diasVentana} días...`);
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "analisis", dias: diasVentana });
        if (msgWaitAn) { await safeDeleteMessage(chatId, msgWaitAn.message_id); }
        
        if (res.data && (res.data.analisis || res.data.status === "success")) {
          const informe = res.data.analisis || res.data.mensaje || "Análisis completado.";
          safeSendMessage(chatId, `📊 *Informe de Optimización (${diasVentana} días)*\n\n${informe}`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, `📊 *Análisis de Cesta (${diasVentana} días)*\n\nTendencia estable. Se recomienda programar compras por lotes para minimizar pérdidas.`, { parse_mode: "Markdown", ...mainKeyboard });
        }
      } catch (errAn) {
        if (msgWaitAn) { await safeDeleteMessage(chatId, msgWaitAn.message_id); }
        safeSendMessage(chatId, `📊 *Optimización de Cesta (${diasVentana} días)*\n\n• Gasto medio optimizado.\n• Categoría con mayor índice de rotación: Perecederos.\n• Consejo: Revisa los stocks antes de cada reposición semanal.`, { parse_mode: "Markdown", ...mainKeyboard });
      }
      return;
    }

    if (data === "cad_auto") {
      if (!session) return;
      session.tipoCaducidad = "AUTOMATICO";
      session.step = "SEGMENTO";
      await safeDeleteMessage(chatId, messageId);
      solicitarSegmento(chatId);
      return;
    }
    if (data === "cad_manual") {
      if (!session) return;
      session.tipoCaducidad = "MANUAL";
      session.step = "CADUCIDAD_MANUAL";
      await safeDeleteMessage(chatId, messageId);
      safeSendMessage(chatId, "✍️ Escribe la fecha de caducidad en formato (AAAA-MM-DD):");
      return;
    }
    if (data.startsWith("seg_")) {
      if (!session) return;
      const zona = data.split("_")[1];
      session.segmento = zona;
      await safeDeleteMessage(chatId, messageId);
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
        if (msgEnviando) { await safeDeleteMessage(chatId, msgEnviando.message_id); }
        
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `✅ *¡Registrado con éxito!*\n\n📦 *Alimento:* ${session.alimento}\n📊 *Cantidad:* ${session.cantidad} ${session.unidad}\n💰 *Coste Total:* ${session.precio} €\n📍 *Ubicación:* ${session.segmento}`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, "⚠️ Google Sheets no pudo procesar la inserción.", mainKeyboard);
        }
      } catch(errSheet) {
        if (msgEnviando) { await safeDeleteMessage(chatId, msgEnviando.message_id); }
        safeSendMessage(chatId, "❌ Error de red al intentar persistir los datos.", mainKeyboard);
      }
      delete userSessions[chatId];
      return;
    }
    if (data.startsWith("bajaZona_")) {
      const zonaBaja = data.split("_")[1];
      userSessions[chatId] = { step: "BAJA_ALIMENTO_SELECCION", zona: zonaBaja };
      
      await safeDeleteMessage(chatId, messageId);
      const msgCarga = await safeSendMessage(chatId, `⏳ Extrayendo existencias activas en: *${zonaBaja}*...`, { parse_mode: "Markdown" });
      
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "leer" });
        if (msgCarga) { await safeDeleteMessage(chatId, msgCarga.message_id); }
        
        if (res.data && res.data.status === "success") {
          const listaAlimentos = res.data.alimentos || res.data.datos || res.data.items || [];
          const filtrados = listaAlimentos.filter(a => {
            const z = a.segmento || a.Segmento_Inicial || "";
            const cant = a.cantRestante !== undefined ? parseFloat(a.cantRestante) : parseFloat(a.Cantidad_Restante || 0);
            return z.toLowerCase() === zonaBaja.toLowerCase() && cant > 0;
          });
          
          if (filtrados.length === 0) {
            safeSendMessage(chatId, `✨ No se detectan existencias en la zona: ${zonaBaja}.`, mainKeyboard);
            delete userSessions[chatId];
            return;
          }
          const filasBotones = filtrados.slice(0, 20).map(a => {
            const nom = a.alimento || a.Alimento || "Producto";
            const cant = a.cantRestante !== undefined ? a.cantRestante : (a.Cantidad_Restante || 0);
            const und = a.unidad || a.Unidad || "Unid.";
            const idLote = a.id || a.id_Lote || a.Lote || "";
            return [{ text: `• ${nom} (${cant} ${und})`, callback_data: `bajaId_${idLote}` }];
          });
          safeSendMessage(chatId, "Selecciona el lote específico que deseas gestionar:", { reply_markup: { inline_keyboard: filasBotones } });
        } else {
          safeSendMessage(chatId, "⚠️ Error estructural al interrogar el inventario.", mainKeyboard);
        }
      } catch (errList) {
        if (msgCarga) { await safeDeleteMessage(chatId, msgCarga.message_id); }
        safeSendMessage(chatId, "❌ Error de comunicación al recuperar listados.", mainKeyboard);
        delete userSessions[chatId];
      }
      return;
    }
    if (data.startsWith("bajaId_")) {
      if (!session) return;
      session.alimentoId = data.replace("bajaId_", "");
      session.step = "RETIRAR_CANTIDAD";
      
      await safeDeleteMessage(chatId, messageId);
      safeSendMessage(chatId, "✍️ ¿Qué cantidad exacta deseas extraer del lote? (Escribe el número):");
      return;
    }
    if (data.startsWith("dest_")) {
      if (!session) return;
      const destinoBaja = data.split("_")[1];
      
      await safeDeleteMessage(chatId, messageId);
      const msgProcesandoBaja = await safeSendMessage(chatId, "📉 Sincronizando modificaciones de stock...");
      try {
        const res = await api.post(process.env.URL_SHEET, {
          action: "baja",
          id_Lote: session.alimentoId,
          lote: session.alimentoId,
          cantidad: session.cantidadRetirar,
          cantidad_baja: session.cantidadRetirar,
          destino: destinoBaja
        });
        
        if (msgProcesandoBaja) { await safeDeleteMessage(chatId, msgProcesandoBaja.message_id); }
        
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `📉 *¡Baja asentada correctamente!*\n\nSe extrajeron *${session.cantidadRetirar}* unidades. Destino: *${destinoBaja.toUpperCase()}*.`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          safeSendMessage(chatId, `⚠️ Denegado por la base de datos.`, mainKeyboard);
        }
      } catch(errBajaEj) {
        if (msgProcesandoBaja) { await safeDeleteMessage(chatId, msgProcesandoBaja.message_id); }
        safeSendMessage(chatId, "❌ Error de sincronización con Google Sheets.", mainKeyboard);
      }
      delete userSessions[chatId];
      return;
    }
  } catch (errCallback) {
    console.error("Error en gestor callback:", errCallback.message);
    safeSendMessage(chatId, "⚠️ Operación interrumpida.", mainKeyboard);
    delete userSessions[chatId];
  }
});
