const http = require('http');
const https = require('https');

// Servidor fantasma para mantener Render despierto
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD - Sistema A-E Operativo\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
const URL_SHEET = "https://script.google.com/macros/s/AKfycbzEFlq1oUJJAsQ_o42OD4uTl6aO8VNgm4QxcPACqSZonlyJPiBZOj7qYcqfop_yA4xA/exec";

if (!token) process.exit(1);

let lastUpdateId = 0;
const estadoUsuarios = {}; // Memoria temporal del bot

// Función de comunicación robusta con Google Sheets
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
    res.on('end', () => {
      if (callback) callback(body);
    });
  });

  req.on('error', (e) => {
    console.error("Error en comunicación con Sheets: ", e);
  });

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
            
            if (update.message && update.message.text) {
              manejarMensaje(update.message);
            } else if (update.callback_query) {
              manejarBoton(update.callback_query);
            }
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

  if (texto.toLowerCase() === '/start' || texto.toLowerCase() === 'hola') {
    estadoUsuarios[chatId] = { fase: 'esperando_alimento' };
    enviarTexto(chatId, "Bienvenido al sistema operativo MOAD. Ya es hora de dejar de tirar dinero a la basura por mala planificación.\n\nDime, ¿qué alimento acaba de cruzar la puerta de tu casa o estás a punto de guardar?");
  } 
  else if (estadoUsuarios[chatId] && estadoUsuarios[chatId].fase === 'esperando_alimento') {
    estadoUsuarios[chatId].alimento = texto;
    estadoUsuarios[chatId].fase = 'esperando_segmento';
    
    const pregunta = `Has registrado: *${texto}*.\n\nNo lo tires al fondo de la nevera a que muera de asco. ¿A qué segmento MOAD pertenece? Elige con cabeza:`;
    
    const botones = {
      inline_keyboard: [
        [{ text: "A: Listo (0-48h)", callback_data: "seg_A" }, { text: "B: Planificado (2-5 días)", callback_data: "seg_B" }],
        [{ text: "C: Transformable", callback_data: "seg_C" }, { text: "D: Estabilizado (>5 días)", callback_data: "seg_D" }],
        [{ text: "E: Revalorizado (Circular)", callback_data: "seg_E" }]
      ]
    };
    
    enviarTextoConBotones(chatId, pregunta, botones);
  } else {
    enviarTexto(chatId, "No me cuentes tu vida. Si quieres registrar un alimento nuevo y no hacer el ridículo, manda /start.");
  }
}

function manejarBoton(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  const username = callbackQuery.from.username || "Usuario";
  
  // 1. Gestión de clasificación inicial de segmentos
  if (data.startsWith("seg_")) {
    let letraSegmento = data.split("_")[1];
    let titulo = "";
    let feedback = "";
    
    switch(letraSegmento) {
      case 'A': titulo = "Segmento A (Uso Inmediato)"; feedback = "Tienes de 0 a 48 horas. El reloj corre. Cómetelo ya."; break;
      case 'B': titulo = "Segmento B (Consumo Diferido)"; feedback = "Tienes de 2 a 5 días. Estará planificado, pero no te olvides de él."; break;
      case 'C': titulo = "Segmento C (Procesamiento)"; feedback = "Tiempo variable. Hora de procesar y cocinar. Haz algo útil con él."; break;
      case 'D': titulo = "Segmento D (Conservación Extendida)"; feedback = "Más de 5 días de margen. Seguro y estabilizado, pero no te confíes ni lo dejes fosilizar."; break;
      case 'E': titulo = "Segmento E (Subproducto Útil)"; feedback = "Ciclo circular activado. Este subproducto aún tiene guerra que dar."; break;
    }

    const alimento = estadoUsuarios[chatId] ? estadoUsuarios[chatId].alimento : 'Este alimento';
    
    // Guardamos en Sheets con la acción "registrar"
    comunicacionSheets({ action: "registrar", alimento: alimento, segmento: titulo, usuario: username });

    // Ofrecemos botones inmediatos para interactuar o cerrar el ciclo en el futuro
    const textoFinal = `✅ *${alimento}* ha sido enjaulado en el *${titulo}*.\n\n⚠️ ${feedback}\n\n¿Qué has hecho finalmente con él?`;
    
    const botonesGestion = {
      inline_keyboard: [
        [{ text: "😋 Ya me lo he comido", callback_data: `act_Consumido_${alimento}` }],
        [{ text: "♻️ Lo he transformado", callback_data: `act_Optimizado_${alimento}` }]
      ]
    };

    editarMensajeConBotones(chatId, messageId, textoFinal, botonesGestion);
    
    if (estadoUsuarios[chatId]) estadoUsuarios[chatId].fase = 'completado';
  }
  
  // 2. Gestión de actualizaciones de estado (Consumido / Optimizado)
  else if (data.startsWith("act_")) {
    const partes = data.split("_");
    const nuevoEstado = partes[1];
    const alimento = partes[2];
    
    // Llamamos a la hoja con la acción "actualizar"
    comunicacionSheets({ action: "actualizar", alimento: alimento, usuario: username, nuevoEstado: nuevoEstado }, (respuesta) => {
      let textoConfirmacion = `💼 Inventario MOAD Actualizado:\n\nEl alimento *${alimento}* ha cambiado su estado a *${nuevoEstado}* con éxito. ¡Buen trabajo optimizando!\n\nEscribe /start para procesar el siguiente alimento.`;
      editarMensaje(chatId, messageId, textoConfirmacion);
    });
  }
}

function enviarTexto(chatId, texto) {
  hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' }));
}

function enviarTextoConBotones(chatId, texto, teclado) {
  hacerPeticion('/sendMessage', JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown', reply_markup: teclado }));
}

function editarMensaje(chatId, messageId, texto) {
  hacerPeticion('/editMessageText', JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown' }));
}

function editarMensajeConBotones(chatId, messageId, texto, teclado) {
  hacerPeticion('/editMessageText', JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'Markdown', reply_markup: teclado }));
}

function hacerPeticion(endpoint, payload) {
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${token}${endpoint}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  const req = https.request(options);
  req.write(payload);
  req.end();
}

checkTelegram();
