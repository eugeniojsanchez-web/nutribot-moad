const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http'); 
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN || !process.env.URL_SHEET) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables de entorno TELEGRAM_TOKEN o URL_SHEET.");
  process.exit(1);
}

// =================================================================
// 🌐 MINI-SERVIDOR PARA EVITAR EL TIMEOUT DE RENDER (PUERTO WEB)
// =================================================================
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MOAD Gestion Domestica Activa\n');
}).listen(PORT, () => {
  console.log(`🌐 Servidor web de mantenimiento escuchando en el puerto ${PORT}`);
});

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log("🚀 El servidor de MOAD está activo y escuchando en Telegram...");

const userSessions = {};

// Teclado principal con el nuevo Menú de Recetas
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📥 Registrar Compra" }, { text: "🔍 Consultar Inventario" }],
      [{ text: "🍳 Gestionar Alimento (Consumo/Merma)" }],
      [{ text: "🥗 Menú Recetas Inteligente" }, { text: "📊 Ver Balance Mermas" }]
    ],
    resize_keyboard: true
  }
};

// Base de datos local de recetas lógicas cruzadas de aprovechamiento
const RECETARIO_MOAD = {
  "Nevera": [
    { plato: "Frittata Excélsior de Verduras", inc: ["huevos", "verduras", "queso"], prep: "Bate los huevos, saltea tus verduras de la nevera a fuego vivo e incorpóralo todo a la sartén 5 min por lado. Ideal para dar salida limpia." },
    { plato: "Salteado Oriental de Proteínas", inc: ["pollo", "ternera", "pimientos", "cebolla"], prep: "Corta la carne y vegetales en tiras finas. Saltea a fuego muy fuerte con un chorrito de soja. Rápido y nutritivo." }
  ],
  "Despensa": [
    { plato: "Arroz Meloso de la Casa", inc: ["arroz", "tomate", "cebolla", "conservas"], prep: "Prepara un sofrito base concentrado con cebolla y tomate. Añade el arroz, dobla el volumen en agua/caldo y cocina 18 min." },
    { plato: "Estofado Exprés de Legumbres", inc: ["garbanzos", "lentejas", "chorizo", "patata"], prep: "En una cazuela rehoga un diente de ajo, añade las legumbres ya cocidas de bote, verduras sueltas y calienta 10 minutos." }
  ],
  "Congelador": [
    { plato: "Crema de Verduras Confort", inc: ["verduras", "patata", "caldo"], prep: "Hierve las verduras congeladas directamente con una patata durante 15 min. Tritura a máxima potencia con un chorrito de aceite de oliva." }
  ]
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  
  const saludo = `🤖 *Entorno MOAD: Gestión Doméstica Activa*\n\n` +
                 `Sistema unificado de optimización de despensa, control de residuos y cocina inteligente.\n\n` +
                 `Utiliza los botones inferiores para controlar tus flujos o planificar tus platos diarios.`;
                 
  bot.sendMessage(chatId, saludo, { parse_mode: "Markdown", ...mainKeyboard });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name || "Usuario_MOAD";

  if (!text) return;
  if (text.startsWith('/')) return;

  // 1. CONSULTAR INVENTARIO
  if (text === "🔍 Consultar Inventario") {
    try {
      const mensajeEspera = await bot.sendMessage(chatId, "⏳ Conectando con la base de datos de MOAD...");
      const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
      await bot.deleteMessage(chatId, mensajeEspera.message_id);

      if (res.data.status === "success" && res.data.alimentos.length > 0) {
        let listado = `📋 *Inventario Actual MOAD*\n\n`;
        const grupos = {};
        res.data.alimentos.forEach(item => {
          if (!grupos[item.segmento]) grupos[item.segmento] = [];
          grupos[item.segmento].push(item);
        });

        for (const seg in grupos) {
          listado += `📍 *${seg.toUpperCase()}:*\n`;
          grupos[seg].forEach(item => {
            listado += `• *${item.alimento}*: ${item.cantRestante} ${item.unidad}\n`;
          });
          listado += `\n`;
        }
        bot.sendMessage(chatId, listado, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "✨ El inventario está vacío. ¡Buen trabajo de optimización!");
      }
    } catch (err) {
      bot.sendMessage(chatId, "❌ No se pudo recuperar el inventario.");
    }
    return;
  }

  // 2. VER BALANCE
  if (text === "📊 Ver Balance Mermas") {
    ejecutarComandoBalance(chatId);
    return;
  }

  // 3. REGISTRAR COMPRA
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    bot.sendMessage(chatId, "✍️ Introduce el *nombre del alimento* o producto:", { parse_mode: "Markdown" });
    return;
  }

  // 4. GESTIONAR CONSUMO/MERMA
  if (text === "🍳 Gestionar Alimento (Consumo/Merma)") {
    delete userSessions[chatId];
    const opcionesZona = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🥦 Nevera", callback_data: "bajaZona_Nevera" }],
          [{ text: "📦 Despensa", callback_data: "bajaZona_Despensa" }],
          [{ text: "❄️ Congelador", callback_data: "bajaZona_Congelador" }]
        ]
      }
    };
    bot.sendMessage(chatId, "¿De qué *zona de conservación* es el producto que vas a retirar?", { parse_mode: "Markdown", ...opcionesZona });
    return;
  }

  // 5. NUEVO: MENÚ RECETAS INTELIGENTE
  if (text === "🥗 Menú Recetas Inteligente") {
    delete userSessions[chatId];
    const tecladoRecetas = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚨 Uso Inmediato (Por Caducidad)", callback_data: "rec_urgente" }],
          [{ text: "🍲 Consultar Ideas por Zona", callback_data: "rec_zona" }],
          [{ text: "✨ Generar Receta con Sobras", callback_data: "rec_sobras" }]
        ]
      }
    };
    bot.sendMessage(chatId, "🥗 *Motor de Recetas MOAD*\n\n¿Cómo deseas optimizar tus elaboraciones hoy?", { parse_mode: "Markdown", ...tecladoRecetas });
    return;
  }

  // --- CONTROLADOR DE SESIONES DE TEXTO ---
  const session = userSessions[chatId];
  if (!session) return;

  if (session.step === "ALIMENTO") {
    session.alimento = text;
    session.step = "CANTIDAD";
    bot.sendMessage(chatId, `¿Qué *cantidad* de "${text}" vas a registrar? (Introduce solo el número):`);
    return;
  }

  if (session.step === "CANTIDAD") {
    const cantNum = parseFloat(text.replace(',', '.'));
    if (isNaN(cantNum) || cantNum <= 0) {
      bot.sendMessage(chatId, "⚠️ Por favor, introduce un número válido mayor que cero:");
      return;
    }
    session.cantidad = cantNum;
    session.step = "UNIDAD";
    bot.sendMessage(chatId, "Indica la *unidad de medida* (ej: Uds, Kg, Litros):");
    return;
  }

  if (session.step === "UNIDAD") {
    session.unidad = text;
    session.step = "PRECIO";
    bot.sendMessage(chatId, `Introduce el *precio por unidad* (o 0 si no lo recuerdas):`);
    return;
  }

  if (session.step === "PRECIO") {
    const precioNum = parseFloat(text.replace(',', '.'));
    if (isNaN(precioNum) || precioNum < 0) {
      bot.sendMessage(chatId, "⚠️ Por favor, introduce un precio válido (número igual o mayor a 0):");
      return;
    }
    session.precio = precioNum;
    session.step = "CADUCIDAD_OPCION";
    
    const opcionesCaducidad = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🤖 Cálculo automático (MOAD)", callback_data: "cad_auto" }],
          [{ text: "🗓️ Introducir fecha del envase", callback_data: "cad_manual" }]
        ]
      }
    };
    bot.sendMessage(chatId, "⚙️ *Fecha de caducidad:* ¿Cómo deseas establecerla?", { parse_mode: "Markdown", ...opcionesCaducidad });
    return;
  }

  if (session.step === "CADUCIDAD_MANUAL") {
    const fechaRegex = /^(\d{1,2})\/(\d{1,2})(\/(\d{4}))?$/;
    if (!fechaRegex.test(text)) {
      bot.sendMessage(chatId, "⚠️ Formato inválido. Escribe la fecha como *DD/MM* o *DD/MM/AAAA* (ej: 25/07):", { parse_mode: "Markdown" });
      return;
    }
    session.fechaManual = text; 
    session.step = "SEGMENTO";
    solicitarSegmento(chatId);
    return;
  }

  if (session.step === "RETIRAR_CANTIDAD") {
    const cantidadRetirar = parseFloat(text.replace(',', '.'));
    if (isNaN(cantidadRetirar) || cantidadRetirar <= 0) {
      bot.sendMessage(chatId, "⚠️ Introduce un número válido y mayor a 0 para la cantidad a retirar:");
      return;
    }
    session.cantidadRetirar = cantidadRetirar;
    session.step = "RETIRAR_DESTINO";

    const opcionesDestino = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍳 Consumido (Aprovechado)", callback_data: "dest_Consumido" }],
          [{ text: "🗑️ Desperdiciado / Merma", callback_data: "dest_Desperdiciado" }]
        ]
      }
    };
    bot.sendMessage(chatId, `¿Cuál es el destino de estos *${cantidadRetirar}* del producto?`, { parse_mode: "Markdown", ...opcionesDestino });
    return;
  }

  // ENTRADA DINÁMICA DE SOBRAS
  if (session.step === "INPUT_SOBRAS") {
    const ingredientesBuscados = text.toLowerCase().split(/[,\s]+/).filter(i => i.length > 2);
    bot.sendMessage(chatId, "🍳 *Análisis de Sobras Exprés*\n\nCon esos elementos puedes armar un *Revoltijo de Aprovechamiento Gourmet*. Saltea los ingredientes en una sartén con un hilo de aceite, condimenta con ajo en polvo, pimienta y sírvelo sobre una base de tostadas o combínalo con pasta cocida.", { parse_mode: "Markdown" });
    delete userSessions[chatId];
    return;
  }
});

function solicitarSegmento(chatId) {
  const opcionesSegmento = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🥦 Nevera", callback_data: "seg_Nevera" }],
        [{ text: "📦 Despensa", callback_data: "seg_Despensa" }],
        [{ text: "❄️ Congelador", callback_data: "seg_Congelador" }]
      ]
    }
  };
  bot.sendMessage(chatId, "Selecciona la *zona de conservación* de MOAD destino:", { parse_mode: "Markdown", ...opcionesSegmento });
}

// --- CALLBACK QUERIES ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || "Usuario_MOAD";

  // FLUJO ALTAS/BAJAS
  if (data.startsWith("bajaZona_")) {
    bot.answerCallbackQuery(query.id);
    const zonaElegida = data.split("_")[1];
    try {
      bot.editMessageText(`🔍 Buscando existencias en *${zonaElegida}*...`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
      if (res.data.status === "success" && res.data.alimentos.length > 0) {
        const filtrados = res.data.alimentos.filter(item => item.segmento === zonaElegida);
        if (filtrados.length === 0) {
          bot.sendMessage(chatId, `✨ No hay stock registrado en *${zonaElegida}*.`, mainKeyboard);
          return;
        }
        const botones = filtrados.map(item => [[{ text: `• ${item.alimento} (${item.cantRestante} ${item.unidad})`, callback_data: `USAR_${item.idLote}` }]][0]);
        bot.sendMessage(chatId, `📍 *Gestión de ${zonaElegida}:* Selecciona el producto a retirar:`, { reply_markup: { inline_keyboard: botones } });
      }
    } catch (err) { bot.sendMessage(chatId, "❌ Error al conectar.", mainKeyboard); }
    return;
  }

  if (data.startsWith("USAR_")) {
    bot.answerCallbackQuery(query.id);
    const idLoteElegido = data.replace("USAR_", "");
    userSessions[chatId] = { step: "RETIRAR_CANTIDAD", idLote: idLoteElegido };
    bot.sendMessage(chatId, "🔢 Escribe la *cantidad exacta* que vas a sacar (solo número):");
    return;
  }

  // CALLBACKS DEL MENÚ RECETAS
  if (data === "rec_urgente") {
    bot.answerCallbackQuery(query.id);
    try {
      bot.editMessageText("🚨 Analizando caducidades críticas...", { chat_id: chatId, message_id: query.message.message_id });
      const res = await axios.post(process.env.URL_SHEET, { action: "recetas_proximas" });
      
      if (res.data.status === "success" && res.data.sugerencias.length > 0) {
        let msgSurg = "🚨 *Alimentos que debes priorizar:*\n\n";
        res.data.sugerencias.forEach(item => {
          let alerta = item.dias <= 2 ? "🔴" : "🟡";
          msgSurg += `${alerta} *${item.alimento}* (En ${item.zona}): faltan aprox. ${item.dias} días.\n`;
        });
        msgSurg += "\n💡 *Idea de plato unificado:* Reúne estos ingredientes prioritarios y elabora un *Salteado de Rescate* o una *Quiché Abierta de Aprovechamiento* al horno. Evitarás mermas directas.";
        bot.sendMessage(chatId, msgSurg, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "✅ Todos tus alimentos cuentan con amplios márgenes de consumo. ¡Buen control estructural!");
      }
    } catch (e) { bot.sendMessage(chatId, "❌ Inconveniente al procesar alertas."); }
    return;
  }

  if (data === "rec_zona") {
    bot.answerCallbackQuery(query.id);
    const mZonas = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🥦 Ideas Nevera", callback_data: "verRecZona_Nevera" }],
          [{ text: "📦 Ideas Despensa", callback_data: "verRecZona_Despensa" }],
          [{ text: "❄️ Ideas Congelador", callback_data: "verRecZona_Congelador" }]
        ]
      }
    };
    bot.sendMessage(chatId, "¿De qué zona de conservación deseas extraer inspiración culinaria?", mZonas);
    return;
  }

  if (data.startsWith("verRecZona_")) {
    bot.answerCallbackQuery(query.id);
    const z = data.split("_")[1];
    const recs = RECETARIO_MOAD[z] || [];
    let msgR = `🍲 *Sugerencias Estructurales para ${z}:*\n\n`;
    
    recs.forEach(r => {
      msgR += `🔸 *${r.plato}*\n• _Ingredientes clave:_ ${r.inc.join(", ")}\n• _Lógica:_ ${r.prep}\n\n`;
    });
    bot.sendMessage(chatId, msgR, { parse_mode: "Markdown" });
    return;
  }

  if (data === "rec_sobras") {
    bot.answerCallbackQuery(query.id);
    userSessions[chatId] = { step: "INPUT_SOBRAS" };
    bot.sendMessage(chatId, "✍️ Escribe los ingredientes que te queden sueltos separados por comas (ej: calabacín, pollo, queso frito):");
    return;
  }

  // CONTINUACIÓN ALTAS
  const session = userSessions[chatId];
  if (!session) return;

  if (data.startsWith("cad_")) {
    bot.answerCallbackQuery(query.id);
    if (data === "cad_auto") {
      session.fechaManual = "AUTO";
      session.step = "SEGMENTO";
      bot.editMessageText("🤖 Elegido: Cálculo automático del sistema.", { chat_id: chatId, message_id: query.message.message_id });
      solicitarSegmento(chatId);
    } else if (data === "cad_manual") {
      session.step = "CADUCIDAD_MANUAL";
      bot.editMessageText("🗓️ Elegido: Fecha manual del envase.", { chat_id: chatId, message_id: query.message.message_id });
      bot.sendMessage(chatId, "✍️ Escribe la fecha en formato *DD/MM* o *DD/MM/AAAA*:");
    }
    return;
  }

  if (data.startsWith("seg_")) {
    const segmentoElegido = data.split("_")[1];
    bot.answerCallbackQuery(query.id);
    try {
      bot.editMessageText(`⏳ Guardando en ${segmentoElegido}...`, { chat_id: chatId, message_id: query.message.message_id });
      const payload = { action: "registrar", usuario: username, alimento: session.alimento, cantidad: session.cantidad, unidad: session.unidad, precio: session.precio, segmento: segmentoElegido, fechaCaducidad: session.fechaManual };
      const res = await axios.post(process.env.URL_SHEET, payload);
      if (res.data.status === "success") {
        bot.sendMessage(chatId, `✅ *Producto Registrado*\n\n• *Alimento*: ${session.alimento}\n• *Ubicación*: ${segmentoElegido}`, { parse_mode: "Markdown", ...mainKeyboard });
      }
    } catch (err) { bot.sendMessage(chatId, "❌ Error."); }
    finally { delete userSessions[chatId]; }
    return;
  }

  if (data.startsWith("dest_")) {
    const destinoElegido = data.split("_")[1];
    bot.answerCallbackQuery(query.id);
    if (session.step !== "RETIRAR_DESTINO") return;
    try {
      bot.editMessageText(`⏳ Procesando baja...`, { chat_id: chatId, message_id: query.message.message_id });
      const payload = { action: "retirar", idLote: session.idLote, cantidadRetirada: session.cantidadRetirar, destino: destinoElegido, usuario: username };
      const res = await axios.post(process.env.URL_SHEET, payload);
      if (res.data.status === "success") {
        bot.sendMessage(chatId, `📉 *Inventario Actualizado*\n\nSe retiraron *${session.cantidadRetirar}* unidades hacia *${destinoElegido}*.`, { parse_mode: "Markdown", ...mainKeyboard });
      }
    } catch (err) { bot.sendMessage(chatId, "❌ Error."); }
    finally { delete userSessions[chatId]; }
  }
});

async function ejecutarComandoBalance(chatId) {
  try {
    const mensajeEspera = await bot.sendMessage(chatId, "📊 Calculando mermas...");
    const response = await axios.post(process.env.URL_SHEET, { action: "balance" });
    await bot.deleteMessage(chatId, mensajeEspera.message_id);

    if (response.data.status === "success") {
      const b = response.data.balance;
      const dineroSalvado = b.dineroSalvado.toFixed(2);
      const dineroPerdido = b.dineroPerdido.toFixed(2);
      let tasaEficiencia = (b.dineroSalvado + b.dineroPerdido > 0) ? ((b.dineroSalvado / (b.dineroSalvado + b.dineroPerdido)) * 100).toFixed(1) : 100;

      let mensajeReporte = `📊 *MOAD: Balance de Optimización Doméstica*\n\n💰 Aprovechado: *${dineroSalvado} €*\n🗑️ Mermas: *${dineroPerdido} €*\n🎯 Tasa Eficiencia: *${tasaEficiencia}%*\n`;
      if (b.itemsDesperdiciados.length > 0) mensajeReporte += `\n🚨 *Últimas mermas:*\n• ${b.itemsDesperdiciados.slice(-5).join("\n• ")}`;
      await bot.sendMessage(chatId, mensajeReporte, { parse_mode: "Markdown" });
    }
  } catch (error) { bot.sendMessage(chatId, "❌ Error al compilar balance."); }
}
