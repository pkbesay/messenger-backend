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
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM chats WHERE $1 = ANY(participants) ORDER BY last_message_time DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Создать чат
app.post('/chats', async (req, res) => {
  try {
    const { participants } = req.body;
    const result = await pool.query(
      'INSERT INTO chats (participants) VALUES ($1) RETURNING *',
      [participants]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating chat:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Получить сообщения чата
app.get('/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await pool.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [chatId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket — реальное время
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('send_message', async (data) => {
    try {
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
    } catch (err) {
      console.error('Error sending message:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Хранилище аватаров
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

// Создать/обновить профиль
app.put('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { nickname, username, bio, moodEmoji, moodStatus } = req.body;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                nickname TEXT,
                username TEXT UNIQUE,
                bio TEXT,
                avatar_url TEXT,
                mood_emoji TEXT,
                mood_status TEXT,
                is_online BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        const result = await pool.query(`
            INSERT INTO users (id, nickname, username, bio, mood_emoji, mood_status)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                nickname = EXCLUDED.nickname,
                username = EXCLUDED.username,
                bio = EXCLUDED.bio,
                mood_emoji = EXCLUDED.mood_emoji,
                mood_status = EXCLUDED.mood_status
            RETURNING *
        `, [userId, nickname, username, bio, moodEmoji, moodStatus]);
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Загрузить аватар
app.post('/users/:userId/avatar', upload.single('avatar'), async (req, res) => {
    try {
        const { userId } = req.params;
        const avatarUrl = `/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
        res.json({ avatarUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Получить профиль
app.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(process.env.PORT || 3000, '0.0.0.0', async () => {
    await initDB();
    console.log(`Server running on port ${process.env.PORT}`);
});
server.listen(process.env.PORT || 3000, '0.0.0.0', async () => {
  await initDB();
  console.log(`Server running on port ${process.env.PORT}`);
});