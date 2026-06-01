const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Создание таблиц
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      participants TEXT[],
      last_message TEXT,
      last_message_time TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id UUID REFERENCES chats(id),
      sender_id TEXT NOT NULL,
      text TEXT,
      type TEXT DEFAULT 'text',
      media_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('DB initialized');
}

// Получить чаты пользователя
app.get('/chats/:userId', async (req, res) => {
  const { userId } = req.params;
  const result = await pool.query(
    'SELECT * FROM chats WHERE $1 = ANY(participants) ORDER BY last_message_time DESC',
    [userId]
  );
  res.json(result.rows);
});

// Создать чат
app.post('/chats', async (req, res) => {
  const { participants } = req.body;
  const result = await pool.query(
    'INSERT INTO chats (participants) VALUES ($1) RETURNING *',
    [participants]
  );
  res.json(result.rows[0]);
});

// Получить сообщения чата
app.get('/messages/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const result = await pool.query(
    'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
    [chatId]
  );
  res.json(result.rows);
});

// WebSocket — реальное время
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('send_message', async (data) => {
    const { chatId, senderId, text, type, mediaUrl } = data;
    const result = await pool.query(
      'INSERT INTO messages (chat_id, sender_id, text, type, media_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [chatId, senderId, text, type || 'text', mediaUrl || null]
    );
    await pool.query(
      'UPDATE chats SET last_message = $1, last_message_time = NOW() WHERE id = $2',
      [text, chatId]
    );
    io.to(chatId).emit('new_message', result.rows[0]);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(process.env.PORT || 3000, '0.0.0.0', async () => {
  await initDB();
  console.log(`Server running on port ${process.env.PORT}`);
});