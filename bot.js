const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// Validación de Variables de Entorno obligatorias
if (!process.env.TELEGRAM_TOKEN || !process.env.URL_SHEET) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables de entorno TELEGRAM_TOKEN o URL_SHEET.");
  process.exit(1);
}

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log("🚀 El servidor de MOAD está activo y escuchando en Telegram...");

// ----------------------------------------------------
// MEMORIA TEMPORAL PARA FLUJOS DE REGISTRO
// ----------------------------------------------------
const userSessions = {};

// ----------------------------------------------------
// MENÚ PRINCIPAL TECLADO FISICO
// ----------------------------------------------------
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📥 Registrar Compra" }, { text: "🔍 Consultar Inventario" }],
      [{ text: "📊 Ver Balance Mermas" }]
    ],
    resize_keyboard: true
  }
};

// ----------------------------------------------------
// COMANDO PRINCIPAL /START
// ----------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  
  const saludo = `🤖 *Entorno MOAD: Gestión Doméstica Activa*\n\n` +
                 `Bienvenido al sistema unificado de optimización de despensa y control de residuos.\n\n` +
                 `Utiliza los botones inferiores para interactuar con tu inventario de forma inmediata.`;
                 
  bot.sendMessage(chatId, saludo, { parse_mode: "Markdown", ...mainKeyboard });
});

// ----------------------------------------------------
// ESCUCHADOR DE TEXTO PRINCIPAL (BOTONES Y FLUJOS)
// ----------------------------------------------------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name || "Usuario_MOAD";

  if (!text) return;
  if (text.startsWith('/')) return; // Los comandos se procesan por separado

  // --- BOTÓN: CONSULTAR INVENTARIO ---
  if (text === "🔍 Consultar Inventario") {
    try {
      const mensajeEspera = await bot.sendMessage(chatId, "⏳ Conectando con la base de datos de MOAD...");
      const res = await axios.post(process.env.URL_SHEET, { action: "leer" });
      
      await bot.deleteMessage(chatId, mensajeEspera.message_id);

      if (res.data.status === "success" && res.data.alimentos.length > 0) {
        let listado = `📋 *Inventario Actual MOAD*\n\n`;
        
        // Agrupar por segmento
        const grupos = {};
        res.data.alimentos.forEach(item => {
          if (!grupos[item.segmento]) grupos[item.segmento] = [];
          grupos[item.segmento].push(item);
        });

        for (const seg in grupos) {
          listado += `📍 *${seg.toUpperCase()}:*\n`;
          grupos[seg].forEach(item => {
            listado += `• *${item.alimento}*: ${item.cantRestante} ${item.unidad} _(Lote: ${item.idLote.split('_')[1] || item.idLote})_\n`;
          });
          listado += `\n`;
        }
        
        bot.sendMessage(chatId, listado, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "✨ El inventario está vacío. ¡Buen trabajo de optimización!");
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ No se pudo recuperar el inventario en este momento.");
    }
    return;
  }

  // --- BOTÓN: VER BALANCE DE MERMAS ---
  if (text === "📊 Ver Balance Mermas") {
    ejecutarComandoBalance(chatId);
    return;
  }

  // --- BOTÓN: INICIAR REGISTRO DE COMPRA ---
  if (text === "📥 Registrar Compra") {
    userSessions[chatId] = { step: "ALIMENTO" };
    bot.sendMessage(chatId, "✍️ Introduce el *nombre del alimento* o producto:", { parse_mode: "Markdown" });
    return;
  }

  // --- PROCESAMIENTO DEL FLUJO MAQUINA DE ESTADOS (REGISTRO) ---
  const session = userSessions[chatId];
  if (!session) return;

  switch (session.step) {
    case "ALIMENTO":
      session.alimento = text;
      session.step = "CANTIDAD";
      bot.sendMessage(chatId, `¿Qué *cantidad* de "${text}" vas a registrar? (Introduce solo el número, ej: 3 o 1.5):`, { parse_mode: "Markdown" });
      break;

    case "CANTIDAD":
      const cantNum = parseFloat(text.replace(',', '.'));
      if (isNaN(cantNum) || cantNum <= 0) {
        bot.sendMessage(chatId, "⚠️ Por favor, introduce un número válido mayor que cero:");
        return;
      }
      session.cantidad = cantNum;
      session.step = "UNIDAD";
      bot.sendMessage(chatId, "Indica la *unidad de medida* (ej: Uds, Kg, Litros, Paquetes):", { parse_mode: "Markdown" });
      break;

    case "UNIDAD":
      session.unidad = text;
      session.step = "PRECIO";
      bot.sendMessage(chatId, `Introduce el *precio por unidad* (ej: 1.25 o 0 si no lo recuerdas):`, { parse_mode: "Markdown" });
      break;

    case "PRECIO":
      const precioNum = parseFloat(text.replace(',', '.'));
      if (isNaN(precioNum) || precioNum < 0) {
        bot.sendMessage(chatId, "⚠️ Por favor, introduce un precio válido (número igual o mayor a 0):");
        return;
      }
      session.precio = precioNum;
      session.step = "SEGMENTO";
      
      // Teclado inline para seleccionar almacenamiento
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
      break;
  }
});

// ----------------------------------------------------
// MANEJADOR DE EVENTOS DE BOTONES INLINE (CALLBACK QUERIES)
// ----------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || query.from.first_name || "Usuario_MOAD";

  // Manejar el paso del Segmento en el registro de compra
  if (data.startsWith("seg_")) {
    const segmentoElegido = data.split("_")[1];
    const session = userSessions[chatId];
    
    if (!session || session.step !== "SEGMENTO") {
      bot.answerCallbackQuery(query.id, { text: "Sesión expirada o inválida." });
      return;
    }

    try {
      bot.answerCallbackQuery(query.id, { text: "Procesando alta..." });
      bot.editMessageText(`⏳ Guardando datos en el segmento ${segmentoElegido}...`, { chat_id: chatId, message_id: query.message.message_id });

      const payload = {
        action: "registrar",
        usuario: username,
        alimento: session.alimento,
        cantidad: session.cantidad,
        unidad: session.unidad,
        precio: session.precio,
        segmento: segmentoElegido
      };

      const res = await axios.post(process.env.URL_SHEET, payload);

      if (res.data.status === "success") {
        const msgExito = `✅ *Producto Registrado en MOAD*\n\n` +
                          `• *Alimento*: ${session.alimento}\n` +
                          `• *Cantidad*: ${session.cantidad} ${session.unidad}\n` +
                          `• *Ubicación*: ${segmentoElegido}\n` +
                          `• *ID asignado*: ${res.data.idLote.split('_')[1] || res.data.idLote}`;
        
        bot.sendMessage(chatId, msgExito, { parse_mode: "Markdown", ...mainKeyboard });
      } else {
        bot.sendMessage(chatId, "❌ Hubo un inconveniente al guardar en la hoja de cálculo.");
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Error de conexión de red con el motor de Google.");
    } finally {
      delete userSessions[chatId];
    }
  }
});

// ----------------------------------------------------
// MANEJADOR EXCLUSIVO DEL COMANDO /BALANCE
// ----------------------------------------------------
bot.onText(/\/balance/, (msg) => {
  ejecutarComandoBalance(msg.chat.id);
});

// ----------------------------------------------------
// FUNCIÓN CENTRALIZADA PARA EJECUTAR EL REPORTE DE BALANCE
// ----------------------------------------------------
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

      if (tasaEficiencia >= 90) {
        mensajeReporte += `🏆 ¡Excelente gestión! Estás rozando el residuo cero en cocina.\n\n`;
      } else if (tasaEficiencia >= 70) {
        mensajeReporte += `👍 Buen trabajo, pero la analítica muestra margen de optimización.\n\n`;
      } else {
        mensajeReporte += `⚠️ Atención: Las mermas están elevadas. Prioriza los avisos diarios.\n\n`;
      }

      if (b.itemsDesperdiciados.length > 0) {
        const listaCritica = b.itemsDesperdiciados.slice(-5).join("\n• ");
        mensajeReporte += `🚨 *Últimas bajas por desperdicio:*\n• ${listaCritica}`;
      } else {
        mensajeReporte += `✨ ¡Espectacular! Cero registros de alimentos desechados en el historial.`;
      }

      await bot.sendMessage(chatId, mensajeReporte, { parse_mode: "Markdown" });
      
    } else {
      await bot.sendMessage(chatId, "❌ No se pudo extraer la analítica de la base de datos.");
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "❌ Error crítico al compilar el balance de mermas.");
  }
}
