const http = require('http');
const https = require('https');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD Pro Activo\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
// ⚠️ TU URL DE GOOGLE APPS SCRIPT
const URL_SHEET = "https://script.google.com/macros/s/AKfycbzpi8T0Li0v3W6pg0QXxo8-rpT_XXLlWb9n7fQoV2myH2TOXuH4s5RyBRrLEU6-_uaU/exec";

if (!token) process.exit(1);

let lastUpdateId = 0;
const estadoUsuarios = {};

function comunicacionSheets(payload, callback) {
  const data = JSON.stringify(payload);
  function realizarPeticion(urlDestino) {
    const urlObj = new URL(urlDestino);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        https.get(res.headers.location, (resGet) => {
          let bodyGet = '';
          resGet.on('data', chunk => bodyGet += chunk);
          resGet.on('end', () => { if (callback) callback(bodyGet); });
        }).on('error', (e) => console.error(e));
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { if (callback) callback(body); });
    });
    req.write(data); req.end();
  }
  realizarPeticion(URL_SHEET);
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

function manejarMensaje(message) {
  const chatId = message.chat.id;
  const texto = message.text.trim();
  const userIdSeguro = String(chatId);

  if (texto.toLowerCase() === '/start' || texto.toLowerCase() === 'hola') {
    estadoUsuarios[chatId] = { fase: 'esperando_alimento' };
    enviarTexto(chatId, "📊 *Control de Inventario MOAD*\n¿Qué alimento has comprado hoy?");
    return;
  } 
  
  if (texto.toLowerCase() === '/nevera') {
    estadoUsuarios[chatId] = {}; 
    comunicacionSheets({ action: "leer", usuario: userIdSeguro }, (res) => {
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
            
            // Visualización clara del balance actual vs inicial
            const resumenLote = `🥑 *${item.alimento}*\n` +
                                `• Quedan: *${item.cantRestante} ${item.unidad}* (de ${item.cantInicial} ${item.unidad} iniciales)\n` +
                                `• P. Unitario: *${item.precioUni.toFixed(2)}€*\n` +
                                `• Inversión Total: *${item.precioTotal.toFixed(2)}€*\n` +
                                `• Ubicación: _${item.segmento}_\n` +
                                `• ID: \`${item.idLote}\``;
                                
            enviarTextoConBotones(chatId, resumenLote, botones);
          });
        } else {
          enviarTexto(chatId, "El inventario actual está vacío. Usa /start para añadir productos.");
        }
      } catch (e) { enviarTexto(chatId, "Error al leer los datos de la despensa."); }
    });
    return;
  }

  if (!estadoUsuarios[chatId] || !estadoUsuarios[chatId].fase) {
    estadoUsuarios[chatId] = { fase: 'esperando_alimento' };
  }

  const fase = estadoUsuarios[chatId].fase;
  
  if (fase === 'esperando_alimento') {
    estadoUsuarios[chatId].alimento = texto;
    estadoUsuarios[chatId].fase = 'esperando_cantidad';
    enviarTexto(chatId, `¿Qué *cantidad* total has comprado de *${texto}*?`);
  } 
  else if (fase === 'esperando_cantidad') {
    const cantidad = parseFloat(texto.replace(',', '.'));
    if (isNaN(cantidad) || cantidad <= 0) {
      enviarTexto(chatId, "Introduce un número válido mayor que 0.");
      return;
    }
    estadoUsuarios[chatId].cantidad = cantidad;
    estadoUsuarios[chatId].fase = 'esperando_unidad';
    
    const botonesUnidad = { inline_keyboard: [
      [{ text: "⚖️ Kilos (Kg)", callback_data: "uni_Kg" }, { text: "💧 Litros (L)", callback_data: "uni_L" }],
      [{ text: "📦 Unidades (Ud)", callback_data: "uni_Ud" }]
    ]};
    enviarTextoConBotones(chatId, `Selecciona la unidad para esos ${cantidad}:`, botonesUnidad);
  }
  else if (fase === 'esperando_precio') {
    const precio = parseFloat(texto.replace(',', '.'));
    if (isNaN(precio) || precio < 0) {
      enviarTexto(chatId, "Introduce un precio numérico válido.");
      return;
    }
    estadoUsuarios[chatId].precio = precio;
    estadoUsuarios[chatId].fase = 'esperando_segmento';
    
    const botones = { inline_keyboard: [
      [{ text: "A: Listo", callback_data: "seg_A" }, { text: "B: Planificado", callback_data: "seg_B" }],
      [{ text: "C: Transformable", callback_data: "seg_C" }, { text: "D: Estabilizado", callback_data: "seg_D" }],
      [{ text: "E: Revalorizado", callback_data: "seg_E" }]
    ]};
    enviarTextoConBotones(chatId, `¿En qué segmento MOAD entra *${estadoUsuarios[chatId].alimento}*?`, botones);
  }
  else if (fase === 'esperando_cantidad_baja') {
    const cantidadBaja = parseFloat(texto.replace(',', '.'));
    if (isNaN(cantidadBaja) || cantidadBaja <= 0) {
      enviarTexto(chatId, "Introduce una cantidad de salida válida.");
      return;
    }
    
    const infoBaja = estadoUsuarios[chatId];
    comunicacionSheets({ 
      action: "actualizar", 
      idLote: infoBaja.idLoteBaja,
      usuario: userIdSeguro, 
      nuevoEstado: infoBaja.accionBaja,
      cantidadBaja: cantidadBaja
    }, (res) => {
      try {
        const respuesta = JSON.parse(res);
        if (respuesta.status === "error") {
          enviarTexto(chatId, "❌ Error: " + respuesta.message);
          return;
        }
        
        let icono = infoBaja.accionBaja === "Consumido" ? "😋" : (infoBaja.accionBaja === "Transformado" ? "♻️" : "🗑️");
        
        if (respuesta.remanente === 0) {
          enviarTexto(chatId, `${icono} *Lote completamente agotado*. Ha salido del inventario activo.`);
        } else {
          enviarTexto(chatId, `${icono} *Porción registrada*\n• Retirado: *${cantidadBaja}*\n• Destino: *${infoBaja.accionBaja}*\n• Quedan en la nevera: *${respuesta.remanente.toFixed(2)}*`);
        }
      } catch(e) { enviarTexto(chatId, "Movimiento procesado en la hoja."); }
      estadoUsuarios[chatId] = {}; 
    });
  }
}

function manejarBoton(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  const userIdSeguro = String(chatId);
  
  if (data.startsWith("uni_")) {
    let unidadSeleccionada = data.split("_")[1];
    if (estadoUsuarios[chatId]) {
      estadoUsuarios[chatId].unidad = unidadSeleccionada;
      estadoUsuarios[chatId].fase = 'esperando_precio';
      editarMensaje(chatId, messageId, `Medida: *${unidadSeleccionada}*`);
      enviarTexto(chatId, `¿Cuál es el *precio unitario* (por ${unidadSeleccionada})?`);
    }
  }
  else if (data.startsWith("seg_")) {
    let letra = data.split("_")[1];
    let titulo = "Segmento " + letra;
    
    if (estadoUsuarios[chatId] && estadoUsuarios[chatId].alimento) {
      const info = estadoUsuarios[chatId];
      comunicacionSheets({ 
        action: "registrar", 
        alimento: info.alimento, 
        cantidad: info.cantidad,
        unidad: info.unidad,
        precio: info.precio,
        segmento: titulo, 
        usuario: userIdSeguro 
      }, (res) => {
        const total = (info.cantidad * info.precio).toFixed(2);
        editarMensaje(chatId, messageId, `✅ *Lote Registrado*\n• Alimento: *${info.alimento}*\n• Compra Inicial: *${info.cantidad} ${info.unidad}*\n• Inversión Fija: *${total}€*`);
        estadoUsuarios[chatId] = {}; 
      });
    }
  }
  else if (data.startsWith("act_")) {
    const partes = data.split("_");
    const accion = partes[1];
    const idLote = partes[2];
    
    estadoUsuarios[chatId] = {
      fase: 'esperando_cantidad_baja',
      accionBaja: accion,
      idLoteBaja: idLote
    };
    
    editarMensaje(chatId, messageId, `Registrando salida por motivo: *${accion}*`);
    enviarTexto(chatId, `¿Qué cantidad vas a retirar?`);
  }
}

function enviarTexto(chatId, texto) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' })); }
function enviarTextoConBotones(chatId, texto, teclado) { hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown', reply_markup: teclado })); }
function editarMensaje(chatId, messageId, texto) { hacerPeticion('/editMessageText', JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown' })); }

function hacerPeticion(endpoint, payload) {
  const options = { hostname: 'api.telegram.org', path: `/bot${token}${endpoint}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  const req = https.request(options); req.write(payload); req.end();
}

checkTelegram();
