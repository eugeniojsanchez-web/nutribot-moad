const http = require('http');
const https = require('https');

// 1. Un servidor fantasma para que Render esté contento y no se apague
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NutriBot MOAD operativo\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

// 2. Leer las pilas (Token de Telegram)
const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("❌ ERROR: ¡Falta la variable TELEGRAM_TOKEN!");
  process.exit(1);
}

console.log("🤖 NutriBot MOAD encendido y escuchando en Telegram...");

// 3. Truco de magia para escuchar mensajes de Telegram (Long Polling nativo)
let lastUpdateId = 0;

function checkTelegramMessages() {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
  
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ok && json.result) {
          for (const update of json.result) {
            lastUpdateId = update.update_id;
            if (update.message && update.message.text) {
              const chatId = update.message.chat.id;
              const text = update.message.text;
              
              enviarRespuesta(chatId, text);
            }
          }
        }
      } catch (e) {}
      setTimeout(checkTelegramMessages, 2000);
    });
  }).on('error', (err) => {
    setTimeout(checkTelegramMessages, 5000);
  });
}

function enviarRespuesta(chatId, textoRecibido) {
  let respuesta = "¡Hola! Soy **NutriBot MOAD** 🤖. En tu nevera hay 1 bolsa de espinacas en peligro 🔴. ¡Cómela antes de que se dañe!";
  
  if (textoRecibido.toLowerCase().includes('comido') || textoRecibido.toLowerCase().includes('comi')) {
    respuesta = "🎉 ¡Genial! Apuntado en el sistema MOAD. ¡Has salvado un alimento y ganado +10 puntos de eficiencia!";
  }

  const campoRespuesta = JSON.stringify({
    chat_id: chatId,
    text: respuesta,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': campoRespuesta.length
    }
  };

  const req = https.request(options);
  req.write(campoRespuesta);
  req.end();
}

checkTelegramMessages();
