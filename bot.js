const http = require('http');
const https = require('https');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD Operativo\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
const URL_SHEET = "https://script.google.com/macros/s/AKfycbzEFlq1oUJJAsQ_o42OD4uTl6aO8VNgm4QxcPACqSZonlyJPiBZOj7qYcqfop_yA4xA/exec";

if (!token) process.exit(1);

let lastUpdateId = 0;
const estadoUsuarios = {};

function comunicacionSheets(payload, callback) {
  const data = JSON.stringify(payload);
  const urlObj = new URL(URL_SHEET);
  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => { if (callback) callback(body); });
  });
  req.on('error', (e) => console.error(e));
  req.write(data);
  req.end();
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
  }).on('error', () => setTimeout(checkTelegram, 5000));
}

function manejarMensaje(message) {
  const chatId = message.chat.id;
  const texto = message.text.trim();
  const username = message.from.username || "Usuario";

  if (texto.toLowerCase() === '/start' || texto.toLowerCase() === 'hola') {
    estadoUsuarios[chatId] = { fase: 'esperando_alimento' };
    enviarTexto(chatId, "Bienvenido al sistema MOAD. ¿Qué alimento vamos a enjaular hoy?");
  } 
  else if (texto.toLowerCase() === '/nevera') {
    comunicacionSheets({ action: "leer", usuario: username }, (res) => {
      try {
        const resultado = JSON.parse(res);
        if (resultado.status === "success" && resultado.alimentos && resultado.alimentos.length > 0) {
          enviarTexto(chatId, "Estos son tus alimentos Enjaulados:");
          resultado.alimentos.forEach(item => {
            const botones = { inline_keyboard: [[
              { text: "😋 Consumido", callback_data: `act_Consumido_${item.alimento}` },
              { text: "♻️ Transformado", callback_data: `act_Optimizado_${item.alimento}` }
            ]]};
            enviarTextoConBotones(chatId, `📍 *${item.alimento}* (${item.segmento})`, botones);
          });
        } else {
          enviarTexto(chatId, "Tu nevera está vacía en el sistema.");
        }
      } catch (e) { enviarTexto(chatId, "Error al leer los datos."); }
    });
  }
  else if (estadoUsuarios[chatId] && estadoUsuarios[chatId].fase === 'esperando_alimento') {
    estadoUsuarios[chatId].alimento = texto;
    estadoUsuarios[chatId].fase = 'esperando_segmento';
    const botones = { inline_keyboard: [
      [{ text: "A: Listo", callback_data: "seg_A" }, { text: "B: Planificado", callback_data: "seg_B" }],
      [{ text: "C: Transformable", callback_data: "seg_C" }, { text: "D: Estabilizado", callback_data: "seg_D" }],
      [{ text: "E: Revalorizado", callback_data: "seg_E" }]
    ]};
    enviarTextoConBotones(chatId, `¿A qué segmento pertenece *${texto}*?`, botones);
  }
}

function manejarBoton(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  const username = callbackQuery.from.username || "Usuario";
  
  if (data.startsWith("seg_")) {
    let letra = data.split("_")[1];
    let titulo = "Segmento " + letra;
    const alimento = estadoUsuarios[chatId] ? estadoUsuarios[chatId].alimento : 'Alimento';
    comunicacionSheets({ action: "registrar", alimento: alimento, segmento: titulo, usuario: username });
    editarMensaje(chatId, messageId, `✅ *${alimento}* enjaulado en ${titulo}.`);
    if (estadoUsuarios[chatId]) estadoUsuarios[chatId].fase = 'completado';
  }
  else if (data.startsWith("act_")) {
    const partes = data.split("_");
    comunicacionSheets({ action: "actualizar", alimento: partes[2], usuario: username, nuevoEstado: partes[1] }, (res) => {
      editarMensaje(chatId, messageId, `💼 Inventario actualizado: ${partes[2]} marcado como ${partes[1]}.`);
    });
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
