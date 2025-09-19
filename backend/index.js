import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import path from 'path';
import { fileURLToPath } from 'url';

// 1) Почтовые настройки
const SMTP_HOST   = process.env.SMTP_HOST;
const SMTP_PORT   = parseInt(process.env.SMTP_PORT, 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';  // true для TLS, false для STARTTLS
const SMTP_USER   = process.env.SMTP_USER;
const SMTP_PASS   = process.env.SMTP_PASS;

// 2) URL приложения (для писем)
const APP_URL = process.env.APP_URL;

// 3) Настройки базы данных
const DATABASE_URL = process.env.DATABASE_URL;

// 4) Секрет для JWT
const JWT_SECRET = process.env.JWT_SECRET;

// Проверяем, что ничего не пропущено
console.log({
  SMTP_HOST, SMTP_PORT, SMTP_SECURE,
  SMTP_USER, APP_URL,
  DATABASE_URL, JWT_SECRET: JWT_SECRET?.substring(0,5) + '…'
});

// Инициализируем пул соединений с БД
const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('DATABASE_URL = ', process.env.DATABASE_URL);
console.log('JWT_SECRET   = ', process.env.JWT_SECRET);

const app = express();
app.get('/health',(req,res)=>res.status(200).send('ok'));

app.use(express.json());
app.use(cookieParser());

// Маршруты
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

// Статика фронта (если нужен вместе с Express)
// Для __dirname в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../public');

app.get('/uart', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'uart.html'));
});

app.get('/editor', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'editor.html'));
});

app.get('/logic-advanced', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'logiceditor.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server run on ${port}`));
