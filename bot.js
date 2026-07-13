const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http'); 
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN || !process.env.URL_SHEET) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables de entorno TELEGRAM_TOKEN o URL_SHEET.");
  process.exit(1);
}

// Servidor para que Render mantenga la app activa
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MOAD Gestion Domestica Activa\n');
}).listen(PORT, () => {
  console.log(`🌐 Servidor web escuchando en el puerto ${PORT}`);
});

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userSessions = {};

// Teclado principal
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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  bot.sendMessage(chatId, "🤖 *Entorno MOAD: Inteligencia Predictiva Activa*\n\nUsa los paneles inferiores para registrar, gestionar mermas o calcular ritmos de reabastecimiento.", { parse_mode: "Markdown", ...mainKeyboard });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name || "Usuario_MOAD";

  if (!text || text.startsWith('/')) return;

  // LECTURA INVENTARIO
  if (text === "🔍 Consultar Inventario") {
    try {
      const msgWait = await bot.sendMessage(chatId, "⏳ Consultando base de datos de MOAD...");
      const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
      await bot.deleteMessage(chatId, msgWait.message_id);

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
        bot.sendMessage(chatId, listado, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "✨ Inventario vacío.");
      }
    } catch (e) { 
      bot.sendMessage(chatId, "❌ No se pudo conectar con la base de datos."); 
    }
    return;
  }

  // BALANCE MERMAS
  if (text === "📈 Ver Balance Mermas") {
    try {
      const res = await axios.post(process.env.URL_SHEET, { action: "balance" });
      if (res.data && res.data.balance) {
        bot.sendMessage(chatId, `📊 *Balance Global de Mermas*\n\n💰 Aprovechado: *${(res.data.balance.dineroSalvado || 0).toFixed(2)} €*\n🗑️ Mermas: *${(res.data.balance.dineroPerdido || 0).toFixed(2)} €*`, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "⚠️ No se han podido obtener los balances.");
      }
    } catch(err) {
      bot.sendMessage(chatId, "❌ Error al obtener el balance de mermas.");
    }
    return;
  }

  // REGISTRAR COMPRA
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    bot.sendMessage(chatId, "✍️ Escribe el nombre del alimento:");
    return;
  }

  // GESTIONAR BAJAS
  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    const mBaja = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }], [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }], [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]] } };
    bot.sendMessage(chatId, "¿De qué zona de conservación vas a retirar el alimento?", mBaja);
    return;
  }

  // MENÚ RECETAS
  if (text === "🥗 Menú Recetas") {
    const tRec = { reply_markup: { inline_keyboard: [[{ text: "🚨 Uso Inmediato", callback_data: "rec_urgente" }], [{ text: "🍲 Ideas por Zona", callback_data: "rec_zona" }], [{ text: "✨ Receta con Sobras", callback_data: "rec_sobras" }]] } };
    bot.sendMessage(chatId, "🥗 *Planificación y Aprovechamiento:*", tRec);
    return;
  }

  // OPTIMIZACIÓN Y ANÁLISIS
  if (text === "📊 Optimizar Cesta (IA)") {
    const tAnalisis = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗓️ Última Semana (7 días)", callback_data: "an_7" }, { text: "📅 Último Mes (30 días)", callback_data: "an_30" }],
          [{ text: "📊 Trimestre (90 días)", callback_data: "an_90" }, { text: "📈 Año Completo (365 días)", callback_data: "an_365" }]
        ]
      }
    };
    bot.sendMessage(chatId, "📊 *Inteligencia de Consumo e Inventario*\n\nSelecciona la ventana temporal para evaluar el historial y calcular necesidades de reposición:", { parse_mode: "Markdown", ...tAnalisis });
    return;
  }

  // CONTROLADORES DE TEXTO DE FLUJOS PASO A PASO
  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (session.step === "ALIMENTO") {
      session.alimento = text; session.step = "CANTIDAD";
      bot.sendMessage(chatId, `¿Cantidad para "${text}"? (Solo número):`);
      return;
    }
    if (session.step === "CANTIDAD") {
      const cNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cNum)) return bot.sendMessage(chatId, "⚠️ Número no válido. Introduce un número:");
      session.cantidad = cNum; session.step = "UNIDAD";
      bot.sendMessage(chatId, "Indica unidad (ej: Kg, Litros, Uds):");
      return;
    }
    if (session.step === "UNIDAD") {
      session.unidad = text; session.step = "PRECIO";
      bot.sendMessage(chatId, "Introduce precio unitario (o 0):");
      return;
    }
    if (session.step === "PRECIO") {
      const pNum = parseFloat(text.replace(',', '.'));
      if (isNaN(pNum)) return bot.sendMessage(chatId, "⚠️ Precio incorrecto. Introduce un número:");
      session.precio = pNum; session.step = "CADUCIDAD_OPCION";
      const opCad = { reply_markup: { inline_keyboard: [[{ text: "🤖 Automático", callback_data: "cad_auto" }], [{ text: "🗓️ Manual", callback_data: "cad_manual" }]] } };
      bot.sendMessage(chatId, "Establecer caducidad:", opCad);
      return;
    }
    if (session.step === "CADUCIDAD_MANUAL") {
      session.fechaManual = text; session.step = "SEGMENTO";
      solicitarSegmento(chatId);
      return;
    }
    if (session.step === "RETIRAR_CANTIDAD") {
      const rNum = parseFloat(text.replace(',', '.'));
      if (isNaN(rNum)) return bot.sendMessage(chatId, "⚠️ Cantidad incorrecta. Introduce un número:");
      session.cantidadRetirar = rNum; session.step = "RETIRAR_DESTINO";
      const opDest = { reply_markup: { inline_keyboard: [[{ text: "🍳 Consumido", callback_data: "dest_Consumido" }], [{ text: "🗑️ Desperdiciado/Merma", callback_data: "dest_Desperdiciado" }]] } };
      bot.sendMessage(chatId, `Destino para ${rNum} unidades:`, opDest);
      return;
    }
    if (session.step === "INPUT_SOBRAS") {
      bot.sendMessage(chatId, "🍳 *Respuesta del Chef MOAD:* Con eso haz un salteado rápido en sartén caliente con ajo, pimienta y un huevo batido por encima. Aprovechamiento al 100%.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }
  } catch(err) {
    console.error("Fallo controlado en lectura de texto: ", err.message);
    bot.sendMessage(chatId, "⚠️ Ocurrió un error procesando los datos. Operación cancelada.", mainKeyboard);
    delete userSessions[chatId];
  }
});

function solicitarSegmento(chatId) {
  const opSeg = { reply_markup: { inline_keyboard: [[{ text: "🥦 Nevera", callback_data: "seg_Nevera" }], [{ text: "📦 Despensa", callback_data: "seg_Despensa" }], [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }]] } };
  bot.sendMessage(chatId, "Zona destino:", opSeg);
}

// --- CALLBACK QUERIES (BOTONES INLINE) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || "Usuario_MOAD";

  // PROCESAMIENTO DE ANÁLISIS TEMPORAL Y GRÁFICOS
  if (data.startsWith("an_")) {
    bot.answerCallbackQuery(query.id);
    const dias = data.split("_")[1];
    
    try {
      bot.editMessageText(`📊 Analizando consumos de los últimos *${dias} días*...`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      
      const response = await axios.post(process.env.URL_SHEET, { action: "analis_consumo", diasFiltro: dias });
      
      if (response.data && response.data.status === "success" && Array.isArray(response.data.analis) && response.data.analis.length > 0) {
        const datos = response.data.analis;
        
        let informe = `📊 *Informe de Cesta de la Compra*\n_(Periodo: ${dias} días)_\n\n`;
        let listaCompra = `🚨 *Alertas de Stock Crítico:*\n`;
        let hayAlertas = false;

        const etiquetas = [];
        const serieConsumo = [];
        const serieStock = [];

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
        
        try {
          await bot.sendPhoto(chatId, chartUrl);
        } catch (imgErr) {
          console.error("No se pudo enviar la foto de QuickChart:", imgErr.message);
        }
        
        if (!hayAlertas) listaCompra += "✅ Todo abastecido correctamente.";
        bot.sendMessage(chatId, `${informe}\n${listaCompra}`, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        bot.sendMessage(chatId, "✨ No hay consumos reales (etiquetados como 'Consumido') registrados en este periodo para analizar.", mainKeyboard);
      }
    } catch (err) {
      console.error("Error analítico evitado:", err.message);
      bot.sendMessage(chatId, "⚠️ El análisis falló temporalmente debido a datos insuficientes en la hoja.", mainKeyboard);
    }
    return;
  }

  // FILTRADO DE BAJAS POR ZONA
  if (data.startsWith("bajaZona_")) {
    bot.answerCallbackQuery(query.id);
    const zElegida = data.split("_")[1];
    try {
      const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
      if(!res.data || !Array.isArray(res.data.alimentos)) return bot.sendMessage(chatId, "❌ Error leyendo inventario.");
      const filtrados = res.data.alimentos.filter(item => item.segmento === zElegida);
      if (filtrados.length === 0) return bot.sendMessage(chatId, `No hay stock activo en la zona: ${zElegida}`);
      const btns = filtrados.map(item => [{ text: `${item.alimento} (${item.cantRestante} ${item.unidad})`, callback_data: `USAR_${item.idLote}` }]);
      bot.sendMessage(chatId, "Selecciona producto a retirar:", { reply_markup: { inline_keyboard: btns } });
    } catch (e) { bot.sendMessage(chatId, "❌ Error de conexión al leer zona."); }
    return;
  }

  if (data.startsWith("USAR_")) {
    bot.answerCallbackQuery(query.id);
    userSessions[chatId] = { step: "RETIRAR_CANTIDAD", idLote: data.replace("USAR_", "") };
    bot.sendMessage(chatId, "Escribe la cantidad numérica a retirar:");
    return;
  }

  // RECETAS URGENTES
  if (data === "rec_urgente") {
    bot.answerCallbackQuery(query.id);
    try {
      const res = await axios.post(process.env.URL_SHEET, { action: "recetas_proximas" });
      if(res.data && Array.isArray(res.data.sugerencias) && res.data.sugerencias.length > 0) {
        let msg = "🚨 *Prioridad de gasto por caducidad:*\n\n";
        res.data.sugerencias.forEach(i => { msg += `• *${i.alimento}* (Quedan ${i.dias} días)\n`; });
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "✅ No hay alimentos próximos a caducar.");
      }
    } catch(e) { bot.sendMessage(chatId, "❌ Error consultando alertas de caducidad."); }
    return;
  }

  if (data === "rec_zona") {
    bot.answerCallbackQuery(query.id);
    const mZ = { reply_markup: { inline_keyboard: [[{ text: "Nevera", callback_data: "vRZ_Nevera" }], [{ text: "Despensa", callback_data: "vRZ_Despensa" }]] } };
    bot.sendMessage(chatId, "Elige zona para ver ideas de recetas:", mZ);
    return;
  }

  if (data.startsWith("vRZ_")) {
    bot.answerCallbackQuery(query.id);
    const recs = RECETARIO_MOAD[data.split("_")[1]] || [];
    let msgR = "🍲 *Ideas de platos:*\n\n";
    recs.forEach(r => { msgR += `*${r.plato}*:\n_${r.prep}_\n\n`; });
    bot.sendMessage(chatId, msgR, { parse_mode: "Markdown" });
    return;
  }

  if (data === "rec_sobras") {
    bot.answerCallbackQuery(query.id);
    userSessions[chatId] = { step: "INPUT_SOBRAS" };
    bot.sendMessage(chatId, "Dime qué ingredientes tienes sueltos separados por comas:");
    return;
  }

  const session = userSessions[chatId];
  if (!session) return;

  try {
    if (data.startsWith("cad_")) {
      bot.answerCallbackQuery(query.id);
      if (data === "cad_auto") { 
        session.fechaManual = "AUTO"; 
        session.step = "SEGMENTO"; 
        solicitarSegmento(chatId); 
      } else { 
        session.step = "CADUCIDAD_MANUAL"; 
        bot.sendMessage(chatId, "Escribe la fecha (formato DD/MM o DD/MM/AAAA):"); 
      }
      return;
    }

    if (data.startsWith("seg_")) {
      bot.answerCallbackQuery(query.id);
      const zonaElegida = data.split("_")[1];
      
      let fechaEnvio = "AUTO";
      
      // PARSEO INTERNACIONALIZADO DE FECHA EN NODE.JS (Evita cuelgues en Sheets)
      if (session.fechaManual && session.fechaManual !== "AUTO") {
        try {
          const partes = session.fechaManual.split('/');
          const dia = parseInt(partes[0], 10);
          const mes = parseInt(partes[1], 10) - 1;
          const anio = partes[2] ? parseInt(partes[2], 10) : new Date().getFullYear();
          
          const objetoFecha = new Date(anio, mes, dia);
          if (!isNaN(objetoFecha.getTime())) {
            fechaEnvio = objetoFecha.toISOString().split('T')[0]; // Envía estrictamente "AAAA-MM-DD"
          }
        } catch (e) {
          console.error("Error formateando fecha en Node:", e.message);
          fechaEnvio = "AUTO";
        }
      }

      const payload = { 
        action: "registrar", 
        usuario: username, 
        alimento: session.alimento, 
        cantidad: session.cantidad, 
        unidad: session.unidad, 
        precio: session.precio, 
        segmento: zonaElegida, 
        fechaCaducidad: fechaEnvio 
      };

      await axios.post(process.env.URL_SHEET, payload);
      bot.sendMessage(chatId, "✅ Alimento registrado correctamente en el inventario.", mainKeyboard);
      delete userSessions[chatId];
      return;
    }

    if (data.startsWith("dest_")) {
      bot.answerCallbackQuery(query.id);
      const payload = { action: "retirar", idLote: session.idLote, cantidadRetirada: session.cantidadRetirar, destino: data.split("_")[1], usuario: username };
      await axios.post(process.env.URL_SHEET, payload);
      bot.sendMessage(chatId, "📉 Inventario actualizado y guardado en el historial.", mainKeyboard);
      delete userSessions[chatId];
    }
  } catch(err) {
    console.error("Fallo controlado en Callbacks: ", err.message);
    bot.sendMessage(chatId, "⚠️ Error al procesar la solicitud con Google Sheets. Operación cancelada.", mainKeyboard);
    delete userSessions[chatId];
  }
});
