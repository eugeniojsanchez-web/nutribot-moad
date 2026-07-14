const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Inicialización del Bot con Webhook o Polling según tu configuración
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Instancia optimizada de Axios para la comunicación con Google Sheets (vía Apps Script o API)
const api = axios.create({
  timeout: 10000, // Evita cuelgues indefinidos si la hoja tarda en responder
  headers: { 'Content-Type': 'application/json' }
});

// Almacenamiento en memoria de las sesiones de los usuarios
const userSessions = {};

// Teclado principal persistente en la parte inferior
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

/**
 * Envia mensajes de manera segura controlando fallos de red o de API de Telegram
 */
async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Error enviando mensaje a ${chatId}:`, err.message);
    return null;
  }
}

/**
 * Solicita el segmento/zona de conservación al registrar un alimento
 */
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
// LISTENER PRINCIPAL DE MENSAJES (MÁQUINA DE ESTADOS ANTI-BLOQUEOS)
// ====================================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Comando de emergencia: Si se escribe /start, se destruye cualquier bloqueo de sesión al instante
  if (text === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los panels inferiores para registrar o gestionar sin bloqueos.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // --- CONTROLADORES DEL TECLADO PRINCIPAL ---
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { try { await bot.deleteMessage(chatId, msgWait.message_id); } catch(dErr){} }

      console.log("Respuesta de Google al leer:", res.data); // Log para depuración

      // Comprobación estricta de éxito desde Google Sheets
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
        safeSendMessage(chatId, "⚠️ Error de comunicación: Google Sheets no devolvió los datos correctamente. Revisa los permisos de Apps Script y la consola de Node.");
      }
    } catch (e) { 
      console.error("Error en petición de inventario:", e.message);
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
        safeSendMessage(chatId, "⚠️ No se han podido calcular los balances actuales. Revisa que Google Sheets responda correctamente.");
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

  // --- PROCESAMIENTO PASO A PASO (FLUJO SECUENCIAL PROTEGIDO) ---
  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text; 
      session.step = "CANTIDAD";
      await safeSendMessage(chatId, `¿Cantidad para "${text}"? (Solo número):`);
      return;
    }
    
    if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return safeSendMessage(chatId, "⚠️ Número no válido. Introduce un número válido:");
      session.cantidad = cNum; 
      session.step = "UNIDAD";
      await safeSendMessage(chatId, "Indica unidad (ej: Kg, Litros, Uds):");
      return;
    }
    
    if (session.step === "UNIDAD") {
      session.unidad = text; 
      session.step = "PRECIO";
      await safeSendMessage(chatId, `Introduce el PRECIO TOTAL pagado por estos ${session.cantidad} ${session.unidad} (ej: 7 o 0 si es gratis):`);
      return;
    }
    
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número válido:");
      
      session.precio = pNum; 
      session.step = "CADUCIDAD_OPCION"; 
      
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      await safeSendMessage(chatId, "Por favor, selecciona una opción usando los botones en línea:", opCad);
      return;
    }

    if (session.step === "CADUCIDAD_OPCION") {
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      return safeSendMessage(chatId, "⚠️ Acción requerida: Debes pulsar uno de los botones inferiores para definir la caducidad:", opCad);
    }
    
    if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text; 
      session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }

    if (session.step === "SEGMENTO") {
      return solicitarSegmento(chatId);
    }
    
    if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return safeSendMessage(chatId, "⚠️ Cantidad incorrecta. Introduce un número:");
      session.cantidadRetirar = rNum; 
      session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      await safeSendMessage(chatId, `Destino para ${rNum} unidades:`, opDest);
      return;
    }

    if (session.step === "RETIRAR_DESTINO") {
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      return safeSendMessage(chatId, "⚠️ Acción requerida: Pulsa un botón para definir el destino:", opDest);
    }
    
    if (session.step === "INPUT_SOBRAS") {
      await safeSendMessage(chatId, "🍳 *Respuesta del Chef MOAD:* Con los ingredientes indicados, te sugiero realizar un salteado rápido en sartén bien caliente con ajo y un huevo batido por encima.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }
  } catch(err) {
    console.error("Error crítico en la máquina de estados:", err.message);
    safeSendMessage(chatId, "⚠️ Ocurrió un error procesando los datos. Cancelando operación.", mainKeyboard);
    delete userSessions[chatId];
  }
});

// ====================================================================
// CONTROLADOR DE LLAMADAS CALLBACK (BOTONES EN LÍNEA / INLINE KEYBOARDS)
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
      solicitarSegmento(chatAquí tienes el código completo de tu `bot.js`. He integrado las correcciones tanto en la lectura del inventario como en las funciones de escritura (altas y bajas), para que el bot valide siempre que Google Sheets ha respondido con un éxito real antes de confirmarte las operaciones.

Puedes copiar y pegar este bloque íntegro para sustituir tu archivo actual:

```javascript
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Inicialización del Bot con Webhook o Polling según tu configuración
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Instancia optimizada de Axios para la comunicación con Google Sheets (vía Apps Script o API)
const api = axios.create({
  timeout: 10000, // Evita cuelgues indefinidos si la hoja tarda en responder
  headers: { 'Content-Type': 'application/json' }
});

// Almacenamiento en memoria de las sesiones de los usuarios
const userSessions = {};

// Teclado principal persistente en la parte inferior
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

/**
 * Envia mensajes de manera segura controlando fallos de red o de API de Telegram
 */
async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error(`Error enviando mensaje a ${chatId}:`, err.message);
    return null;
  }
}

/**
 * Solicita el segmento/zona de conservación al registrar un alimento
 */
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
// LISTENER PRINCIPAL DE MENSAJES (MÁQUINA DE ESTADOS ANTI-BLOQUEOS)
// ====================================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Comando de emergencia: Si se escribe /start, se destruye cualquier bloqueo de sesión al instante
  if (text === '/start') {
    delete userSessions[chatId];
    return safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los panels inferiores para registrar o gestionar sin bloqueos.", { parse_mode: "Markdown", ...mainKeyboard });
  }

  // --- CONTROLADORES DEL TECLADO PRINCIPAL ---
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { try { await bot.deleteMessage(chatId, msgWait.message_id); } catch(dErr){} }

      console.log("Respuesta de Google al leer:", res.data); // Log para depurar errores silenciosos

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
        safeSendMessage(chatId, "⚠️ Error de comunicación: Google Sheets no devolvió los datos correctamente. Revisa la consola y los permisos del script.");
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

  // --- PROCESAMIENTO PASO A PASO (FLUJO SECUENCIAL PROTEGIDO) ---
  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text; 
      session.step = "CANTIDAD";
      await safeSendMessage(chatId, `¿Cantidad para "${text}"? (Solo número):`);
      return;
    }
    
    if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return safeSendMessage(chatId, "⚠️ Número no válido. Introduce un número válido:");
      session.cantidad = cNum; 
      session.step = "UNIDAD";
      await safeSendMessage(chatId, "Indica unidad (ej: Kg, Litros, Uds):");
      return;
    }
    
    if (session.step === "UNIDAD") {
      session.unidad = text; 
      session.step = "PRECIO";
      await safeSendMessage(chatId, `Introduce el PRECIO TOTAL pagado por estos ${session.cantidad} ${session.unidad} (ej: 7 o 0 si es gratis):`);
      return;
    }
    
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número válido:");
      
      session.precio = pNum; 
      session.step = "CADUCIDAD_OPCION"; 
      
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      await safeSendMessage(chatId, "Por favor, selecciona una opción usando los botones en línea:", opCad);
      return;
    }

    if (session.step === "CADUCIDAD_OPCION") {
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      return safeSendMessage(chatId, "⚠️ Acción requerida: Debes pulsar uno de los botones inferiores para definir la caducidad:", opCad);
    }
    
    if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text; 
      session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }

    if (session.step === "SEGMENTO") {
      return solicitarSegmento(chatId);
    }
    
    if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return safeSendMessage(chatId, "⚠️ Cantidad incorrecta. Introduce un número:");
      session.cantidadRetirar = rNum; 
      session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      await safeSendMessage(chatId, `Destino para ${rNum} unidades:`, opDest);
      return;
    }

    if (session.step === "RETIRAR_DESTINO") {
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      return safeSendMessage(chatId, "⚠️ Acción requerida: Pulsa un botón para definir el destino:", opDest);
    }
    
    if (session.step === "INPUT_SOBRAS") {
      await safeSendMessage(chatId, "🍳 *Respuesta del Chef MOAD:* Con los ingredientes indicados, te sugiero realizar un salteado rápido en sartén bien caliente con ajo y un huevo batido por encima.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }
  } catch(err) {
    console.error("Error crítico en la máquina de estados:", err.message);
    safeSendMessage(chatId, "⚠️ Ocurrió un error procesando los datos. Cancelando operación.", mainKeyboard);
    delete userSessions[chatId];
  }
});

// ====================================================================
// CONTROLADOR DE LLAMADAS CALLBACK (BOTONES EN LÍNEA / INLINE KEYBOARDS)
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
      safeSendMessage(chatId, "✍️ Introduce la fecha de caducidad (ej: 2026-07-20 o DD/MM/AAAA):");
      return;
    }

    if (data.startsWith("seg_")) {
      if (!session) return;
      const zona = data.split("_")[1];
      session.segmento = zona;

      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgEnviando = await safeSendMessage(chatId, "⚡ Transmitiendo datos a Google Sheets...");

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
        
        // Validación de éxito real en la escritura
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `✅ *¡Registrado con éxito!*\n\n📦 *Alimento:* ${session.alimento}\n📊 *Cantidad:* ${session.cantidad} ${session.unidad}\n💰 *Coste Total:* ${session.precio} €\n📍 *Ubicación:* ${session.segmento}`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          console.log("Respuesta de Google al escribir:", res.data);
          safeSendMessage(chatId, "⚠️ Error de comunicación: Google Sheets no guardó los datos. Revisa la consola y permisos.", mainKeyboard);
        }
      } catch(errSheet) {
        if (msgEnviando) { try { await bot.deleteMessage(chatId, msgEnviando.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ Hubo un problema de red al guardar en Google Sheets.", mainKeyboard);
      }

      delete userSessions[chatId];
      return;
    }

    if (data.startsWith("bajaZona_")) {
      const zonaBaja = data.split("_")[1];
      userSessions[chatId] = { step: "BAJA_ALIMENTO_SELECCION", zona: zonaBaja };
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgCarga = await safeSendMessage(chatId, `⏳ Cargando existencias de: *${zonaBaja}*...`, { parse_mode: "Markdown" });
      
      try {
        const res = await api.post(process.env.URL_SHEET, { action: "leer" });
        if (msgCarga) { try { await bot.deleteMessage(chatId, msgCarga.message_id); } catch(e){} }

        if (res.data && res.data.status === "success" && Array.isArray(res.data.alimentos)) {
          const filtrados = res.data.alimentos.filter(a => a.segmento === zonaBaja && parseFloat(a.cantRestante) > 0);
          
          if (filtrados.length === 0) {
            safeSendMessage(chatId, `✨ No hay alimentos disponibles para retirar en la ${zonaBaja}.`, mainKeyboard);
            delete userSessions[chatId];
            return;
          }

          const filasBotones = filtrados.map(a => [{ text: `• ${a.alimento} (${a.cantRestante} ${a.unidad})`, callback_data: `bajaId_${a.id}` }]);
          safeSendMessage(chatId, "Selecciona el artículo específico que deseas gestionar:", { reply_markup: { inline_keyboard: filasBotones } });
        } else {
          safeSendMessage(chatId, "⚠️ Error al leer el inventario para procesar la baja.", mainKeyboard);
        }
      } catch (errList) {
        if (msgCarga) { try { await bot.deleteMessage(chatId, msgCarga.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ Error de red al conectar con el inventario para la baja.", mainKeyboard);
        delete userSessions[chatId];
      }
      return;
    }

    if (data.startsWith("bajaId_")) {
      if (!session) return;
      const alimentoId = data.split("_")[1];
      session.alimentoId = alimentoId;
      session.step = "RETIRAR_CANTIDAD";
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      safeSendMessage(chatId, "✍️ ¿Qué cantidad vas a retirar? (Escribe el número):");
      return;
    }

    if (data.startsWith("dest_")) {
      if (!session) return;
      const destinoBaja = data.split("_")[1];
      
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      const msgProcesandoBaja = await safeSendMessage(chatId, "📉 Actualizando inventario global...");

      try {
        const res = await api.post(process.env.URL_SHEET, {
          action: "baja",
          id: session.alimentoId,
          cantidadRetirar: session.cantidadRetirar,
          destino: destinoBaja
        });
        
        if (msgProcesandoBaja) { try { await bot.deleteMessage(chatId, msgProcesandoBaja.message_id); } catch(e){} }
        
        // Validación de éxito real en la baja
        if (res.data && res.data.status === "success") {
          safeSendMessage(chatId, `📉 ¡Retirada procesada con éxito!\n\nSe han asignado ${session.cantidadRetirar} unidades a: *${destinoBaja.toUpperCase()}*.`, { parse_mode: "Markdown", ...mainKeyboard });
        } else {
          console.log("Respuesta de Google al procesar baja:", res.data);
          safeSendMessage(chatId, "⚠️ Error de comunicación: Google Sheets no procesó la baja de los datos.", mainKeyboard);
        }
      } catch(errBajaEj) {
        if (msgProcesandoBaja) { try { await bot.deleteMessage(chatId, msgProcesandoBaja.message_id); } catch(e){} }
        safeSendMessage(chatId, "❌ No se pudo conectar con Google Sheets para registrar la baja.", mainKeyboard);
      }

      delete userSessions[chatId];
      return;
    }

    if (data.startsWith("rec_") || data.startsWith("an_")) {
      try { await bot.deleteMessage(chatId, messageId); } catch(e){}
      if (data === "rec_sobras") {
        userSessions[chatId] = { step: "INPUT_SOBRAS" };
        safeSendMessage(chatId, "✍️ Enumera los restos o sobras que tienes a mano en este momento:");
      } else {
        safeSendMessage(chatId, "💡 *Módulo de Inteligencia Artificial Avanzado:* Procesando heurísticas de optimización de stock para este período...", { parse_mode: "Markdown", ...mainKeyboard });
      }
      return;
    }

  } catch (errCallback) {
    console.error("Error en gestor callback:", errCallback.message);
    safeSendMessage(chatId, "⚠️ Ocurrió una interrupción en la selección.", mainKeyboard);
    delete userSessions[chatId];
  }
});

console.log("🤖 Servidor MOAD activo. Parches de interceptación de texto inyectados de forma segura.");
