const http = require('http');
const https = require('https');

// Servidor fantasma para mantener Render despierto
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD - Sistema A-E Operativo\n');
});
server.listen(process.env.PORT || 3000);

const token = process.env.TELEGRAM_TOKEN;
if (!token) process.exit(1);

let lastUpdateId = 0;
const estadoUsuarios = {}; // Memoria temporal del bot

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
        [{ text: "A: Listo (0-48h)", callback_data: "A" }, { text: "B: Planificado (2-5 días)", callback_data: "B" }],
        [{ text: "C: Transformable", callback_data: "C" }, { text: "D: Estabilizado (>5 días)", callback_data: "D" }],
        [{ text: "E: Revalorizado (Circular)", callback_data: "E" }]
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
  
  let titulo = "";
  let feedback = "";
  
  switch(data) {
    case 'A': 
      titulo = "Segmento A (Uso Inmediato)"; 
      feedback = "Tienes de 0 a 48 horas. El reloj corre. Cómetelo ya."; 
      break;
    case 'B': 
      titulo = "Segmento B (Consumo Diferido)"; 
      feedback = "Tienes de 2 a 5 días. Estará planificado, pero no te olvides de él."; 
      break;
    case 'C': 
      titulo = "Segmento C (Procesamiento)"; 
      feedback = "Tiempo variable. Hora de procesar y cocinar. Haz algo útil con él."; 
      break;
    case 'D': 
      titulo = "Segmento D (Conservación Extendida)"; 
      feedback = "Más de 5 días de margen. Seguro y estabilizado, pero no te confíes ni lo dejes fosilizar."; 
      break;
    case 'E': 
      titulo = "Segmento E (Subproducto Útil)"; 
      feedback = "Ciclo circular activado. Este subproducto aún tiene guerra que dar."; 
      break;
  }

  const alimento = estadoUsuarios[chatId] ? estadoUsuarios[chatId].alimento : 'Este alimento';
  const textoFinal = `✅ *${alimento}* ha sido enjaulado en el *${titulo}*.\n\n⚠️ ${feedback}\n\nEscribe /start para registrar la siguiente víctima.`;

  editarMensaje(chatId, messageId, textoFinal);
  
  if (estadoUsuarios[chatId]) {
    estadoUsuarios[chatId].fase = 'completado';
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

