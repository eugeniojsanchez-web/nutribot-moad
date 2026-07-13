const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http'); 
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN || !process.env.URL_SHEET) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables de entorno TELEGRAM_TOKEN o URL_SHEET.");
  process.exit(1);
}

// Configuración de Axios con timeout de seguridad (10 segundos) para evitar bloqueos
const api = axios.create({
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

// Captura de seguridad global para evitar que CUALQUIER error tire el proceso de Node.js
process.on('uncaughtException', (err) => {
  console.error('🚨 [Error Global Capturado para Evitar Caída]:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 [Promesa Rechazada Capturada]:', reason);
});

// Servidor para Render
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MOAD Gestion Domestica Activa\n');
}).listen(PORT, () => {
  console.log(`🌐 Servidor web activo en el puerto ${PORT}`);
});

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userSessions = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📥 Registrar Compra" }, { text: "🔍 Consultar Inventario" }],
      [{ text: "🍳 Gestionar Alimento (Consumo/Merma)" }],
      [{ text: "🥗 Menú Recetas" }, { text: "📊 Optimizar Cesta (IA)" }],
      [{ text: "📈 Ver Balance Mermas" }]
    ],
    resize_keyboard: true
  }
};

const RECETARIO_MOAD = {
  "Nevera": [
    { plato: "Frittata Excélsior de Verduras", inc: ["huevos", "verduras", "queso"], prep: "Bate los huevos, saltea tus verduras e incorpóralo todo a la sartén 5 min por lado." },
    { plato: "Salteado Oriental de Proteínas", inc: ["pollo", "pimientos", "cebolla"], prep: "Corta todo en tiras y saltea fuerte con un chorrito de salsa de soja." }
  ],
  "Despensa": [
    { plato: "Arroz Meloso de la Casa", inc: ["arroz", "tomate", "conservas"], prep: "Haz un sofrito denso de cebolla/tomate, echa el arroz y cocina con el doble de agua 18 min." }
  ],
  "Congelador": [
    { plato: "Crema de Verduras Confort", inc: ["verduras", "patata"], prep: "Hierve las verduras directo del congelador con patata 15 min y tritura con aceite." }
  ]
};

// Función auxiliar para enviar mensajes de forma segura
async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (e) {
    console.error("Fallo al enviar mensaje por Telegram:", e.message);
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  safeSendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para gestionar tu inventario sin riesgo de desconexión.", { parse_mode: "Markdown", ...mainKeyboard });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name || "Usuario_MOAD";

  if (!text || text.startsWith('/')) return;

  // LECTURA INVENTARIO
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await safeSendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if (msgWait) { try { await bot.deleteMessage(chatId, msgWait.message_id); } catch(dErr){} }

      if (res.data && res.data.status === "success" && Array.isArray(res.data.alimentos) && res.data.alimentos.length > 0) {
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
        safeSendMessage(chatId, "✨ Inventario vacío.");
      }
    } catch (e) { 
      safeSendMessage(chatId, "❌ La consulta tardó demasiado o la base de datos no responde."); 
    }
    return;
  }

  // BALANCE MERMAS
  if (text === "📈 Ver Balance Mermas") {
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "balance" });
      if (res.data && res.data.balance) {
        safeSendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Aprovechado: *${(res.data.balance.dineroSalvado || 0).toFixed(2)} €*\n🗑️ Mermas: *${(res.data.balance.dineroPerdido || 0).toFixed(2)} €*`, { parse_mode: "Markdown" });
      } else {
        safeSendMessage(chatId, "⚠️ No se han podido calcular los balances actuales.");
      }
    } catch(err) {
      safeSendMessage(chatId, "❌ Error al obtener balance de mermas.");
    }
    return;
  }

  // REGISTRAR COMPRA
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    safeSendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  // GESTIONAR BAJAS
  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]] } };
    safeSendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  // MENÚ RECETAS
  if (text === "🥗 Menú Recetas") {
    const tRec = { reply_markup: { inline_keyboard: [[{ text: "🚨 Uso Inmediato", callback_data: "rec_urgente" }], [{ text: "🍲 Ideas por Zona", callback_data: "rec_zona" }], [{ text: "✨ Receta con Sobras", callback_data: "rec_sobras" }]] } };
    safeSendMessage(chatId, "🥗 *Planificación y Aprovechamiento:*", tRec);
    return;
  }

  // OPTIMIZACIÓN
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

  // CONTROLADORES DE FLUJOS PASO A PASO
  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text; session.step = "CANTIDAD";
      safeSendMessage(chatId, `¿Cantidad para "${text}"? (Solo número):`);
      return;
    }
    if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return safeSendMessage(chatId, "⚠️ Número no válido. Introduce un número:");
      session.cantidad = cNum; session.step = "UNIDAD";
      safeSendMessage(chatId, "Indica unidad (ej: Kg, Litros, Uds):");
      return;
    }
    if (session.step === "UNIDAD") {
      session.unidad = text; session.step = "PRECIO";
      safeSendMessage(chatId, "Introduce precio unitario (o 0):");
      return;
    }
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return safeSendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número:");
      session.precio = pNum; session.step = "CADUCIDAD_OPCION";
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      safeSendMessage(chatId, "Establecer caducidad:", opCad);
      return;
    }
    if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text; session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }
    if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return safeSendMessage(chatId, "⚠️ Cantidad incorrecta. Introduce un número:");
      session.cantidadRetirar = rNum; session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      safeSendMessage(chatId, `Destino para ${rNum} unidades:`, opDest);
      return;
    }
    if (session.step === "INPUT_SOBRAS") {
      safeSendMessage(chatId, "🍳 *Respuesta del Chef MOAD:* Con eso haz un salteado rápido en sartén caliente con ajo y un huevo batido por encima.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }
  } catch(err) {
    safeSendMessage(chatId, "⚠️ Ocurrió un error procesando los datos. Cancelando operación.", mainKeyboard);
    delete userSessions[chatId];
  }
});

function solicitarSegmento(chatId) {
  const opSeg = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "seg_Nevera" }], [{ text: "📦 Despensa", callback_data: "seg_Despensa" }], [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }]] } };
  safeSendMessage(chatId, "Zona destino:", opSeg);
}

// --- CALLBACK QUERIES (BOTONES INLINE CON COMPORTAMIENTO SEGURO) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || "Usuario_MOAD";

  // Responder siempre al callback inmediatamente para evitar que el botón se quede cargando
  try { await bot.answerCallbackQuery(query.id); } catch(e){}

  if (data.startsWith("an_")) {
    const dias = data.split("_")[1];
    try {
      try { await bot.editMessageText(`📊 Analizando consumos de los últimos *${dias} días*...`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" }); } catch(mErr){}
      
      const response = await api.post(process.env.URL_SHEET, { action: "analis_consumo", diasFiltro: dias });
      
      if (response.data && response.data.status === "success" && Array.isArray(response.data.analis) && response.data.analis.length > 0) {
        const datos = response.data.analis;
        let informe = `📊 *Informe de Cesta de la Compra*\n_(Periodo: ${dias} días)_\n\n`;
        let listaCompra = `🚨 *Alertas de Stock Crítico:*\n`;
        let hayAlertas = false;

        const etiquetas = []; const serieConsumo = []; const serieStock = [];

        datos.forEach(item => {
          if (!item.alimento) return;
          informe += `• *${item.alimento}*: Consumo: ${item.consumido} | Stock: ${item.stock} ${item.unidad}\n`;
          etiquetas.push(item.alimento);
          serieConsumo.push(item.consumido);
          serieStock.push(item.stock);
          if (item.alerta) {
            listaCompra += `⚠️ *${item.alimento}* (¡Reponer pronto!)\n`;
            hayAlertas = true;
          }
        });

        const chartConfig = {
          type: 'bar',
          data: {
            labels: etiquetas,
            datasets: [
              { label: 'Consumido', backgroundColor: 'rgba(54, 162, 235, 0.7)', data: serieConsumo },
              { label: 'Stock', backgroundColor: 'rgba(255, 99, 132, 0.7)', data: serieStock }
            ]
          }
        };

        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        try { await bot.sendPhoto(chatId, chartUrl); } catch (imgErr) {}
        if (!hayAlertas) listaCompra += "✅ Todo abastecido correctamente.";
        
        safeSendMessage(chatId, `${informe}\n${listaCompra}`, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        safeSendMessage(chatId, "✨ No hay consumos reales registrados en este periodo.", mainKeyboard);
      }
    } catch (err) {
      safeSendMessage(chatId, "⚠️ El análisis falló o tardó demasiado en responder.", mainKeyboard);
    }
    return;
  }

  if (data.startsWith("bajaZona_")) {
    const zElegida = data.split("_")[1];
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "leer" });
      if(!res.data || !Array.isArray(res.data.alimentos)) return safeSendMessage(chatId, "❌ Error leyendo inventario.");
      const filtrados = res.data.alimentos.filter(item => item.segmento === zElegida);
      if (filtrados.length === 0) return safeSendMessage(chatId, `No hay stock activo en la zona: ${zElegida}`);
      const btns = filtrados.map(item => [{ text: `${item.alimento} (${item.cantRestante} ${item.unidad})`, callback_data: `USAR_${item.idLote}` }]);
      safeSendMessage(chatId, "Selecciona producto a retirar:", { reply_markup: { inline_keyboard: btns } });
    } catch (e) { safeSendMessage(chatId, "❌ Error de conexión al leer la zona elegida."); }
    return;
  }

  if (data.startsWith("USAR_")) {
    userSessions[chatId] = { step: "RETIRAR_CANTIDAD", idLote: data.replace("USAR_", "") };
    safeSendMessage(chatId, "Escribe la cantidad numérica a retirar:");
    return;
  }

  if (data === "rec_urgente") {
    try {
      const res = await api.post(process.env.URL_SHEET, { action: "recetas_proximas" });
      if(res.data && Array.isArray(res.data.sugerencias) && res.data.sugerencias.length > 0) {
        let msg = "🚨 *Prioridad de gasto por caducidad:*\n\n";
        res.data.sugerencias.forEach(i => { msg += `• *${i.alimento}* (Quedan ${i.dias} días)\n`; });
        safeSendMessage(chatId, msg, { parse_mode: "Markdown" });
      } else {
        safeSendMessage(chatId, "✅ No hay alimentos próximos a caducar.");
      }
    } catch(e) { safeSendMessage(chatId, "❌ Error al consultar alertas."); }
    return;
  }

  if (data === "rec_zona") {
    const mZ = { reply_markup: { inline_keyboard: [[{ text: "Nevera", callback_data: "vRZ_Nevera" }], [{ text: "Despensa", callback_data: "vRZ_Despensa" }]] } };
    safeSendMessage(chatId, "Elige zona para ver ideas de recetas:", mZ);
    return;
  }

  if (data.startsWith("vRZ_")) {
    const recs = RECETARIO_MOAD[data.split("_")[1]] || [];
    let msgR = "🍲 *Ideas de platos:*\n\n";
    recs.forEach(r => { msgR += `*${r.plato}*:\n_${r.prep}_\n\n`; });
    safeSendMessage(chatId, msgR, { parse_mode: "Markdown" });
    return;
  }

  if (data === "rec_sobras") {
    userSessions[chatId] = { step: "INPUT_SOBRAS" };
    safeSendMessage(chatId, "Dime qué ingredientes tienes sueltos separados por comas:");
    return;
  }

  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (data.startsWith("cad_")) {
      if (data === "cad_auto") { 
        session.fechaManual = "AUTO"; session.step = "SEGMENTO"; solicitarSegmento(chatId); 
      } else { 
        session.step = "CADUCIDAD_MANUAL"; safeSendMessage(chatId, "Escribe la fecha (formato DD/MM o DD/MM/AAAA):"); 
      }
      return;
    }

    if (data.startsWith("seg_")) {
      const zonaElegida = data.split("_")[1];
      let fechaEnvio = "AUTO";
      
      if (session.fechaManual && session.fechaManual !== "AUTO") {
        try {
          const partes = session.fechaManual.split('/');
          const dia = parseInt(partes[0], 10);
          const mes = parseInt(partes[1], 10) - 1;
          const anio = partes[2] ? parseInt(partes[2], 10) : new Date().getFullYear();
          const objetoFecha = new Date(anio, mes, dia);
          if (!isNaN(objetoFecha.getTime())) {
            fechaEnvio = objetoFecha.toISOString().split('T')[0]; 
          }
        } catch (e) {
          fechaEnvio = "AUTO";
        }
      }

      const payload = { action: "registrar", usuario: username, alimento: session.alimento, cantidad: session.cantidad, unidad: session.unidad, precio: session.precio, segmento: zonaElegida, fechaCaducidad: fechaEnvio };
      await api.post(process.env.URL_SHEET, payload);
      safeSendMessage(chatId, "✅ Alimento registrado correctamente en el inventario.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }

    if (data.startsWith("dest_")) {
      const payload = { action: "retirar", idLote: session.idLote, cantidadRetirada: session.cantidadRetirar, destino: data.split("_")[1], usuario: username };
      await api.post(process.env.URL_SHEET, payload);
      safeSendMessage(chatId, "📉 Inventario actualizado y guardado en el historial.", mainKeyboard);
      delete userSessions[chatId];
    }
  } catch(err) {
    safeSendMessage(chatId, "⚠️ La comunicación con la base de datos ha fallado o ha expirado. Inténtalo de nuevo.", mainKeyboard);
    delete userSessions[chatId];
  }
});
