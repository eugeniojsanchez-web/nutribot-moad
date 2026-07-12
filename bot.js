const http = require('http');
const https = require('https');

// Servidor básico para que Render mantenga el bot vivo
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD Activo\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
const URL_SHEET = process.env.URL_SHEET; // Lee la URL de forma segura desde Render

if (!token || !URL_SHEET) {
  console.error("❌ ERROR: Faltan las variables TELEGRAM_TOKEN o URL_SHEET en Render.");
  process.exit(1);
}

let lastUpdateId = 0;
// Objeto en memoria para recordar qué lote está modificando cada usuario
const loteSeleccionado = {};

// Función nativa para enviar datos a Google Sheets (Maneja redirecciones 302 de Google)
function comunicacionSheets(payload, callback) {
  const data = JSON.stringify(payload);
  function realizarPeticion(urlDestino) {
    const urlObj = new URL(urlDestino);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Content-Length': Buffer.byteLength(data) 
      }
    };
    const req = https.request(options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        realizarPeticion(res.headers.location);
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { if (callback) callback(body); });
    });
    req.on('error', (e) => console.error("Error en petición Sheets:", e));
    req.write(data); 
    req.end();
  }
  realizarPeticion(URL_SHEET);
}

// Bucle de escucha de Telegram (Long Polling nativo)
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

function manejarMensaje(message) {
  const chatId = message.chat.id;
  const texto = message.text.trim();

  // Si escribe un comando global, limpiamos el estado por seguridad
  if (texto.startsWith('/')) {
    delete loteSeleccionado[chatId];
  }

  if (texto.toLowerCase() === '/start') {
    enviarTexto(chatId, "📊 *Control de Inventario MOAD*\nUsa `/nevera` para ver tus alimentos y gestionar sus consumos, mermas o transformaciones.");
    return;
  }
  
  if (texto.toLowerCase() === '/nevera') {
    comunicacionSheets({ action: "leer", usuario: String(chatId) }, (res) => {
      try {
        const resultado = JSON.parse(res);
        if (resultado.status === "success" && resultado.alimentos && resultado.alimentos.length > 0) {
          enviarTexto(chatId, "🗄️ *Tu despensa e inventario actual:*");
          resultado.alimentos.forEach(item => {
            const botones = { inline_keyboard: [
              [
                { text: "😋 Consumir porción", callback_data: `act_Consumido_${item.idLote}` },
                { text: "♻️ Transformar porción", callback_data: `act_Transformado_${item.idLote}` }
              ],
              [
                { text: "🗑️ Desperdiciar porción", callback_data: `act_Desperdiciado_${item.idLote}` }
              ]
            ]};
            
            const resumenLote = `🥑 *${item.alimento}*\n` +
                                `• Quedan: *${item.cantRestante} ${item.unidad}* (de ${item.cantInicial})\n` +
                                `• P. Unitario: *${item.precioUni.toFixed(2)}€*\n` +
                                `• Inversión Total: *${item.precioTotal.toFixed(2)}€*\n` +
                                `• Segmento: _${item.segmento}_\n` +
                                `• ID: \`${item.idLote}\``;
                                
            enviarTextoConBotones(chatId, resumenLote, botones);
          });
        } else {
          enviarTexto(chatId, "El inventario actual está vacío.");
        }
      } catch (e) { enviarTexto(chatId, "Error al leer los datos de la despensa."); }
    });
    return;
  }

  // SI EL USUARIO ESTABA EN PROCESO DE INTRODUCIR UNA CANTIDAD
  if (loteSeleccionado[chatId]) {
    const cantidadBaja = parseFloat(texto.replace(',', '.'));
    
    if (isNaN(cantidadBaja) || cantidadBaja <= 0) {
      enviarTexto(chatId, "⚠️ Por favor, introduce un número válido mayor que 0.");
      return;
    }

    const infoLote = loteSeleccionado[chatId];
    enviarTexto(chatId, "🔄 Conectando con la base de datos...");

    comunicacionSheets({ 
      action: "actualizar", 
      idLote: infoLote.idLote,
      usuario: String(chatId), 
      nuevoEstado: infoLote.accion,
      cantidadBaja: cantidadBaja
    }, (res) => {
      try {
        const respuesta = JSON.parse(res);
        if (respuesta.status === "error") {
          enviarTexto(chatId, "❌ Error: " + respuesta.message);
          return;
        }
        
        let icono = infoLote.accion === "Consumido" ? "😋" : (infoLote.accion === "Transformado" ? "♻️" : "🗑️");
        
        if (respuesta.remanente === 0) {
          enviarTexto(chatId, `${icono} *Lote agotado*: Has extraído las últimas unidades. Salió del inventario activo y se registró en el historial.`);
        } else {
          enviarTexto(chatId, `${icono} *Movimiento registrado con éxito*\n• Cantidad retirada: *${cantidadBaja}*\n• Motivo: *${infoLote.accion}*\n• Saldo restante en el inventario: *${respuesta.remanente.toFixed(2)}*`);
        }
      } catch(e) { 
        enviarTexto(chatId, "✅ Movimiento procesado con éxito en las hojas de cálculo."); 
      }
      // Limpiamos el estado del usuario pase lo que pase
      delete loteSeleccionado[chatId]; 
    });
  }
}

function manejarBoton(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  if (data.startsWith("act_")) {
    const partes = data.split("_");
    const accion = partes[1]; // Consumido, Transformado o Desperdiciado
    const idLote = partes[2]; // Captura el ID único del lote de la hoja
    
    // Guardamos el estado: qué acción y sobre qué lote opera el usuario
    loteSeleccionado[chatId] = {
      accion: accion,
      idLote: idLote
    };
    
    editarMensaje(chatId, messageId, `Registrando salida por motivo: *${accion}*`);
    enviarTexto(chatId, `¿Qué cantidad deseas retirar del lote \`${idLote}\`? Escribe solo el número:`);
    
    // Respondemos al callback de Telegram para que desaparezca el reloj de arena del botón
    hacerPeticion('/answerCallbackQuery', JSON.stringify({ callback_query_id: callbackQuery.id }));
  }
}

function enviarTexto(chatId, texto) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })); }
function enviarTextoConBotones(chatId, texto, teclado) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown', reply_markup: teclado })); }
function editarMensaje(chatId, messageId, texto) { hacerPeticion('/editMessageText', JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown' })); }

function hacerPeticion(endpoint, payload) {
  const options = { hostname: 'api.telegram.org', path: `/bot${token}${endpoint}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  const req = https.request(options); req.write(payload); req.end();
}

console.log("🤖 NutriBot MOAD iniciado y escuchando...");
checkTelegram();
