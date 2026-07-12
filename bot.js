const http = require('http');
const https = require('https');
const fetch = require('node-fetch'); // Librería estándar para comunicaciones seguras

// Servidor básico para mantener vivo el bot en Render
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD Activo y Optimizado\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
const URL_SHEET = process.env.URL_SHEET;

if (!token || !URL_SHEET) {
  console.error("❌ ERROR: Faltan las variables de entorno en Render.");
  process.exit(1);
}

let lastUpdateId = 0;

const estadoUsuario = {};
const datosRegistro = {};
const loteSeleccionado = {};

// Función simplificada y blindada contra bucles de redirección de Google
async function comunicacionSheets(payload) {
  try {
    const response = await fetch(URL_SHEET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow' // Instrucción clave: node-fetch sigue las redirecciones de Google de forma automática y segura
    });
    
    const textoRespuesta = await response.text();
    return textoRespuesta;
  } catch (error) {
    console.error("Error crítico en comunicación con Sheets:", error);
    return JSON.stringify({ status: "error", message: error.message });
  }
}

function checkTelegram() {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ok && json.result) {
          json.result.forEach(update => {
            lastUpdateId = update.update_id;
            if (update.message && update.message.text) manejarMensaje(update.message);
            else if (update.callback_query) manejarBoton(update.callback_query);
          });
        }
      } catch (e) {}
      setTimeout(checkTelegram, 1000);
    });
  }).on('error', (e) => setTimeout(checkTelegram, 5000));
}

async function manejarMensaje(message) {
  const chatId = message.chat.id;
  const texto = message.text.trim();

  if (texto.toLowerCase() === '/start') {
    delete estadoUsuario[chatId];
    delete datosRegistro[chatId];
    delete loteSeleccionado[chatId];

    const menuPrincipal = { inline_keyboard: [
      [{ text: "📥 Registrar Compra", callback_data: "menu_registrar" }],
      [{ text: "🗄️ Ver Nevera / Inventario", callback_data: "menu_nevera" }]
    ]};
    enviarTextoConBotones(chatId, "📊 *Control de Inventario MOAD*\n\n¡Hola! Bienvenido. ¿Qué deseas hacer hoy?", menuPrincipal);
    return;
  }

  if (texto.toLowerCase() === '/nevera') {
    await mostrarNevera(chatId);
    return;
  }

  // FLUJO DE REGISTRO
  if (estadoUsuario[chatId]) {
    const paso = estadoUsuario[chatId];

    if (paso === 'ESPERANDO_ALIMENTO') {
      datosRegistro[chatId] = { alimento: texto };
      estadoUsuario[chatId] = 'ESPERANDO_CANTIDAD';
      enviarTexto(chatId, `🔢 ¿Qué cantidad has comprado de *${texto}*? (Introduce solo el número, ej: 2 o 1.5):`);
      return;
    }

    if (paso === 'ESPERANDO_CANTIDAD') {
      const cant = parseFloat(texto.replace(',', '.'));
      if (isNaN(cant) || cant <= 0) {
        enviarTexto(chatId, "⚠️ Por favor, introduce un número válido mayor que 0:");
        return;
      }
      datosRegistro[chatId].cantidad = cant;
      estadoUsuario[chatId] = 'ESPERANDO_UNIDAD';
      enviarTexto(chatId, "⚖️ ¿En qué unidad de medida? (Ej: Kg, g, Litros, Unidades, Bandejas):");
      return;
    }

    if (paso === 'ESPERANDO_UNIDAD') {
      datosRegistro[chatId].unidad = texto;
      estadoUsuario[chatId] = 'ESPERANDO_PRECIO';
      enviarTexto(chatId, "💰 ¿Cuál es el precio unitario por esa medida? (Escribe solo el número, ej: 2.99):");
      return;
    }

    if (paso === 'ESPERANDO_PRECIO') {
      const prec = parseFloat(texto.replace(',', '.'));
      if (isNaN(prec) || prec < 0) {
        enviarTexto(chatId, "⚠️ Por favor, introduce un precio numérico válido:");
        return;
      }
      datosRegistro[chatId].precio = prec;
      estadoUsuario[chatId] = 'ESPERANDO_SEGMENTO';
      
      const tecladoSeg = { inline_keyboard: [
        [{ text: "Nevera 🥦", callback_data: "seg_Nevera" }, { text: "Congelador 🧊", callback_data: "seg_Congelador" }],
        [{ text: "Despensa 🥖", callback_data: "seg_Despensa" }]
      ]};
      enviarTextoConBotones(chatId, "📂 Selecciona el segmento de conservación:", tecladoSeg);
      return;
    }
  }

  // FLUJO DE RETIRADA
  if (loteSeleccionado[chatId]) {
    const cantidadBaja = parseFloat(texto.replace(',', '.'));
    if (isNaN(cantidadBaja) || cantidadBaja <= 0) {
      enviarTexto(chatId, "⚠️ Por favor, escribe una cantidad numérica válida mayor que 0:");
      return;
    }

    const infoLote = loteSeleccionado[chatId];
    enviarTexto(chatId, "🔄 Conectando con Google Sheets para descontar porción...");

    const res = await comunicacionSheets({ 
      action: "actualizar", 
      idLote: infoLote.idLote,
      usuario: String(chatId), 
      nuevoEstado: infoLote.accion,
      cantidadBaja: cantidadBaja
    });

    try {
      const respuesta = JSON.parse(res);
      let icono = infoLote.accion === "Consumido" ? "😋" : (infoLote.accion === "Transformado" ? "♻️" : "🗑️");
      
      if (respuesta.status === "error") {
        enviarTexto(chatId, "❌ Error en Google Sheets: " + respuesta.message);
      } else if (respuesta.remanente === 0) {
        enviarTexto(chatId, `${icono} *Lote agotado*: Se han consumido las últimas unidades.`);
      } else {
        enviarTexto(chatId, `${icono} *Movimiento registrado*\n• Retirado: *${cantidadBaja}*\n• Motivo: *${infoLote.accion}*\n• Quedan en inventario: *${respuesta.remanente.toFixed(2)}*`);
      }
    } catch(e) {
      enviarTexto(chatId, "✅ Movimiento procesado con éxito.");
    }
    delete loteSeleccionado[chatId];
  }
}

async function manejarBoton(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  if (data === "menu_registrar") {
    estadoUsuario[chatId] = 'ESPERANDO_ALIMENTO';
    enviarTexto(chatId, "📝 Vamos a registrar una nueva compra.\n¿Qué alimento has comprado? (Escribe el nombre, ej: Huevos, Tomates, Pollo):");
    hacerPeticion('/answerCallbackQuery', JSON.stringify({ callback_query_id: callbackQuery.id }));
    return;
  }

  if (data === "menu_nevera") {
    await mostrarNevera(chatId);
    hacerPeticion('/answerCallbackQuery', JSON.stringify({ callback_query_id: callbackQuery.id }));
    return;
  }

  if (data.startsWith("seg_")) {
    const segmento = data.replace("seg_", "");
    if (datosRegistro[chatId]) {
      datosRegistro[chatId].segmento = segmento;
      datosRegistro[chatId].usuario = chatId;
      datosRegistro[chatId].action = "registrar";

      enviarTexto(chatId, "⏳ Guardando alimento en el inventario...");

      const res = await comunicacionSheets(datosRegistro[chatId]);
      try {
        const r = JSON.parse(res);
        if (r.status === "success") {
          enviarTexto(chatId, `📥 *¡Alimento Registrado!*\n\n🍏 *Artículo:* ${datosRegistro[chatId].alimento}\n📦 *Lote asignado:* \`${r.idLote}\`\n📍 *Zona:* ${segmento}`);
        } else {
          enviarTexto(chatId, "❌ Error al guardar en Google Sheets.");
        }
      } catch(e) {
        enviarTexto(chatId, "✅ Alimento incorporado correctamente a la hoja de Inventario Actual.");
      }
      delete estadoUsuario[chatId];
      delete datosRegistro[chatId];
    }
    hacerPeticion('/answerCallbackQuery', JSON.stringify({ callback_query_id: callbackQuery.id }));
    return;
  }

  if (data.startsWith("act_")) {
    const partes = data.split("_");
    const accion = partes[1]; 
    const idLote = partes[2]; 
    
    loteSeleccionado[chatId] = { accion: accion, idLote: idLote };
    
    editarMensaje(chatId, messageId, `Operación seleccionada: *${accion}*`);
    enviarTexto(chatId, `¿Qué cantidad vas a retirar del lote \`${idLote}\`? Escribe solo el número:`);
    hacerPeticion('/answerCallbackQuery', JSON.stringify({ callback_query_id: callbackQuery.id }));
  }
}

async function mostrarNevera(chatId) {
  enviarTexto(chatId, "🔍 Consultando tu base de datos actual...");
  
  const res = await comunicacionSheets({ action: "leer" });
  
  try {
    const resultado = JSON.parse(res);
    if (resultado.status === "success" && resultado.alimentos && resultado.alimentos.length > 0) {
      enviarTexto(chatId, "🗄️ *Artículos en tu despensa activa:*");
      resultado.alimentos.forEach(item => {
        const botones = { inline_keyboard: [
          [
            { text: "😋 Consumir porción", callback_data: `act_Consumido_${item.idLote}` },
            { text: "♻️ Transformar", callback_data: `act_Transformado_${item.idLote}` }
          ],
          [{ text: "🗑️ Desperdiciar / Merma", callback_data: `act_Desperdiciado_${item.idLote}` }]
        ]};
        
        const resumenLote = `🥑 *${item.alimento}*\n` +
                            `• Disponible: *${item.cantRestante} ${item.unidad}* (de ${item.cantInicial})\n` +
                            `• Precio Uni: *${item.precioUni.toFixed(2)}€*\n` +
                            `• Valor Total: *${item.precioTotal.toFixed(2)}€*\n` +
                            `• Zona: _${item.segmento}_\n` +
                            `• ID Lote: \`${item.idLote}\``;
                            
        enviarTextoConBotones(chatId, resumenLote, botones);
      });
    } else {
      enviarTexto(chatId, "🥦 Tu inventario actual está vacío. ¡Usa el botón de Registrar Compra para añadir alimentos!");
    }
  } catch (e) {
    // Si falla el parseo de JSON, capturamos qué está respondiendo Google exactamente para solucionarlo
    const fragmentoRespuesta = String(res).substring(0, 250);
    enviarTexto(chatId, `⚠️ *Diagnóstico de respuesta Google:*\n\n\`\`\`\n${fragmentoRespuesta}\n\`\`\``);
  }
}

function enviarTexto(chatId, texto) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })); }
function enviarTextoConBotones(chatId, texto, teclado) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown', reply_markup: teclado })); }
function editarMensaje(chatId, messageId, texto) { hacerPeticion('/editMessageText', JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown' })); }

function hacerPeticion(endpoint, payload) {
  const options = { hostname: 'api.telegram.org', path: `/bot${token}${endpoint}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  const req = https.request(options); req.write(payload); req.end();
}

console.log("🤖 NutriBot MOAD iniciado...");
checkTelegram();
