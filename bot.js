const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN || !process.env.URL_SHEET) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables de entorno TELEGRAM_TOKEN o URL_SHEET.");
  process.exit(1);
}

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log("🚀 El servidor de MOAD está activo y escuchando en Telegram...");

const userSessions = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📥 Registrar Compra" }, { text: "🔍 Consultar Inventario" }],
      [{ text: "📊 Ver Balance Mermas" }]
    ],
    resize_keyboard: true
  }
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  
  const saludo = `🤖 *Entorno MOAD: Gestión Doméstica Activa*\n\n` +
                 `Bienvenido al sistema unificado de optimización de despensa y control de residuos.\n\n` +
                 `• Usa los botones inferiores para registrar compras o consultar el estado global.\n` +
                 `• Usa los comandos */nevera*, */despensa* o */congelador* para gestionar el consumo o las mermas de una zona específica.`;
                 
  bot.sendMessage(chatId, saludo, { parse_mode: "Markdown", ...mainKeyboard });
});

// Comandos de acceso a Segmentos para consumir/mermar
bot.onText(/\/(nevera|despensa|congelador)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  
  // Normalizar la primera letra en mayúscula para coincidir con Sheets (Nevera, Despensa, Congelador)
  const segmentoAnclado = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  
  try {
    const mensajeEspera = await bot.sendMessage(chatId, `🔍 Buscando existencias en *${segmentoAnclado}*...`, { parse_mode: "Markdown" });
    const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
    await bot.deleteMessage(chatId, mensajeEspera.message_id);

    if (res.data.status === "success" && res.data.alimentos.length > 0) {
      // Filtrar solo los del segmento solicitado
      const filtrados = res.data.alimentos.filter(item => item.segmento === segmentoAnclado);
      
      if (filtrados.length === 0) {
        bot.sendMessage(chatId, `✨ No hay stock registrado en *${segmentoAnclado}*.`, { parse_mode: "Markdown" });
        return;
      }

      // Crear un botón interactivo por cada producto en stock
      const botones = filtrados.map(item => {
        return [{
          text: `• ${item.alimento} (${item.cantRestante} ${item.unidad})`,
          callback_data: `USAR_${item.idLote}`
        }];
      });

      bot.sendMessage(chatId, `📍 *Gestión de ${segmentoAnclado}:* Selecciona el producto que vas a retirar o dar de baja:`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: botones }
      });

    } else {
      bot.sendMessage(chatId, "✨ El inventario global de MOAD está vacío.");
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error al acceder al inventario de la zona.");
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith('/')) return;

  // 1. CONSULTAR INVENTARIO GLOBAL
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
      console.error(err);
      bot.sendMessage(chatId, "❌ No se pudo recuperar el inventario.");
    }
    return;
  }

  // 2. VER BALANCE
  if (text === "📊 Ver Balance Mermas") {
    ejecutarComandoBalance(chatId);
    return;
  }

  // 3. INICIAR REGISTRO DE COMPRA
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    bot.sendMessage(chatId, "✍️ Introduce el *nombre del alimento* o producto:", { parse_mode: "Markdown" });
    return;
  }

  // --- CONTROLADOR DE SESIONES ACTIVAS (MENSAJES DE TEXTO) ---
  const session = userSessions[chatId];
  if (!session) return;

  // FLUJO COMPRA: Alimento
  if (session.step === "ALIMENTO") {
    session.alimento = text;
    session.step = "CANTIDAD";
    bot.sendMessage(chatId, `¿Qué *cantidad* de "${text}" vas a registrar? (Introduce solo el número):`);
    return;
  }

  // FLUJO COMPRA: Cantidad
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

  // FLUJO COMPRA: Unidad
  if (session.step === "UNIDAD") {
    session.unidad = text;
    session.step = "PRECIO";
    bot.sendMessage(chatId, `Introduce el *precio por unidad* (o 0 si no lo recuerdas):`);
    return;
  }

  // FLUJO COMPRA: Precio
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

  // FLUJO COMPRA: Fecha Manual
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

  // FLUJO RETIRAR/BAJA: Capturar Cantidad a Usar
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
          [{ text: "🗑️ Desperdiçado / Merma", callback_data: "dest_Desperdiciado" }]
        ]
      }
    };
    bot.sendMessage(chatId, `¿Cuál es el destino de estos *${cantidadRetirar}* del producto?`, { parse_mode: "Markdown", ...opcionesDestino });
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

// --- MANEJADOR DE CALLBACK QUERIES (BOTONES INTERACTIVOS) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || "Usuario_MOAD";
  
  // A) Si seleccionamos un producto para retirar (/nevera, /despensa, /congelador)
  if (data.startsWith("USAR_")) {
    bot.answerCallbackQuery(query.id);
    const idLoteElegido = data.replace("USAR_", "");
    
    userSessions[chatId] = {
      step: "RETIRAR_CANTIDAD",
      idLote: idLoteElegido
    };
    
    bot.editMessageText("🔢 Escribe la *cantidad exacta* que vas a sacar o dar de baja (solo el número):", {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown"
    });
    return;
  }

  const session = userSessions[chatId];
  if (!session) return;

  // B) Flujo Compra: Manejar selección de tipo de caducidad
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
      bot.sendMessage(chatId, "✍️ Escribe la fecha de caducidad en formato *DD/MM* o *DD/MM/AAAA* (ej: 28/07):", { parse_mode: "Markdown" });
    }
    return;
  }

  // C) Flujo Compra: Guardar producto definitivo
  if (data.startsWith("seg_")) {
    const segmentoElegido = data.split("_")[1];
    bot.answerCallbackQuery(query.id);

    try {
      bot.editMessageText(`⏳ Guardando datos en el segmento ${segmentoElegido}...`, { chat_id: chatId, message_id: query.message.message_id });

      const payload = {
        action: "registrar",
        usuario: username,
        alimento: session.alimento,
        cantidad: session.cantidad,
        unidad: session.unidad,
        precio: session.precio,
        segmento: segmentoElegido,
        fechaCaducidad: session.fechaManual
      };

      const res = await axios.post(process.env.URL_SHEET, payload);

      if (res.data.status === "success") {
        bot.sendMessage(chatId, `✅ *Producto Registrado en MOAD*\n\n• *Alimento*: ${session.alimento}\n• *Cantidad*: ${session.cantidad} ${session.unidad}\n• *Ubicación*: ${segmentoElegido}`, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        bot.sendMessage(chatId, "❌ Hubo un inconveniente al guardar en la hoja de cálculo.", mainKeyboard);
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Error de conexión con el motor de Google.", mainKeyboard);
    } finally {
      delete userSessions[chatId];
    }
    return;
  }

  // D) Flujo Retirar: Destino Final (Consumido o Desperdiciado)
  if (data.startsWith("dest_")) {
    const destinoElegido = data.split("_")[1];
    bot.answerCallbackQuery(query.id);

    if (session.step !== "RETIRAR_DESTINO") return;

    try {
      bot.editMessageText(`⏳ Procesando baja en el historial...`, { chat_id: chatId, message_id: query.message.message_id });

      const payload = {
        action: "retirar",
        idLote: session.idLote,
        cantidadRetirada: session.cantidadRetirar,
        destino: destinoElegido,
        usuario: username
      };

      const res = await axios.post(process.env.URL_SHEET, payload);

      if (res.data.status === "success") {
        const msgFinal = `📉 *Inventario Actualizado*\n\n` +
                         `Se han retirado con éxito *${session.cantidadRetirar}* unidades.\n` +
                         `📦 Destino registrado: *${destinoElegido}*.\n\n` +
                         `El balance financiero se ha recalculado automáticamente.`;
        bot.sendMessage(chatId, msgFinal, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        bot.sendMessage(chatId, `❌ Error: ${res.data.message || "No se pudo procesar la baja."}`, mainKeyboard);
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Error al conectar con Google Sheets para efectuar la baja.", mainKeyboard);
    } finally {
      delete userSessions[chatId];
    }
  }
});

async function ejecutarComandoBalance(chatId) {
  try {
    const mensajeEspera = await bot.sendMessage(chatId, "📊 Calculando indicadores financieros y mermas de MOAD...");
    const response = await axios.post(process.env.URL_SHEET, { action: "balance" });
    await bot.deleteMessage(chatId, mensajeEspera.message_id);

    if (response.data.status === "success") {
      const b = response.data.balance;
      const dineroSalvado = b.dineroSalvado.toFixed(2);
      const dineroPerdido = b.dineroPerdido.toFixed(2);
      const totalInvertido = (b.dineroSalvado + b.dineroPerdido).toFixed(2);
      
      let tasaEficiencia = 100;
      if (b.dineroSalvado + b.dineroPerdido > 0) {
        tasaEficiencia = ((b.dineroSalvado / (b.dineroSalvado + b.dineroPerdido)) * 100).toFixed(1);
      }

      let mensajeReporte = `📊 *MOAD: Balance de Optimización Doméstica*\n\n` +
                           `📉 *Impacto Financiero Acumulado:*\n` +
                           `💰 Aprovechado con éxito: *${dineroSalvado} €*\n` +
                           `🗑️ Desperdiciado / Mermas: *${dineroPerdido} €*\n` +
                           `🧮 Total invertido analizado: *${totalInvertido} €*\n\n` +
                           `🎯 *Tasa de Eficiencia Doméstica: ${tasaEficiencia}%*\n`;

      if (b.itemsDesperdiciados.length > 0) {
        const listaCritica = b.itemsDesperdiciados.slice(-5).join("\n• ");
        mensajeReporte += `🚨 *Últimas bajas por desperdicio:*\n• ${listaCritica}`;
      } else {
        mensajeReporte += `✨ ¡Espectacular! Cero registros de alimentos desechados en el historial.`;
      }

      await bot.sendMessage(chatId, mensajeReporte, { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, "❌ No se pudo extraer la analítica.");
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "❌ Error crítico al compilar el balance.");
  }
}
