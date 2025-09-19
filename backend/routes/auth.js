import express from 'express';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail } from '../models/user.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db } from '../db.js';
import axios from 'axios';
import qs from 'qs';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Настройка транспортера Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // теперь true
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.verify((err, success) => {
  if (err) console.error('SMTP verify error:', err);
  else    console.log('SMTP соединение готово');
});

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1) Проверяем, нет ли уже такого e-mail
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'Этот e-mail уже зарегистрирован' });
    }

    // 2) Хешируем пароль
    const passwordHash = await bcrypt.hash(password, 10);

    // 3) Генерируем токен подтверждения
    const confirmToken = crypto.randomBytes(32).toString('hex');

    // 4) Создаём запись в БД с флагом email_confirmed = FALSE
    const result = await db.query(
      `INSERT INTO users (email, password_hash, confirm_token)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, passwordHash, confirmToken]
    );
    const userId = result.rows[0].id;
/*
    // 5) Формируем ссылку для подтверждения
    const confirmLink = `${process.env.APP_URL}/api/auth/confirm?token=${confirmToken}`;

    // 6) Отправляем письмо
    try {
      await transporter.sendMail({
        from: `"1Logic Team" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Подтвердите вашу регистрацию на 1Logic.org',
        html: `
          <p>Здравствуйте!</p>
          <p>Спасибо за регистрацию на <strong>1Logic.org</strong>.</p>
          <p>Чтобы активировать ваш аккаунт, перейдите по ссылке:</p>
          <p><a href="${confirmLink}">${confirmLink}</a></p>
          <p>Если вы не регистрировались на нашем сайте — просто проигнорируйте это письмо.</p>
          <p>С уважением,<br/>команда 1Logic.</p>
        `
      });
    } catch(err) {
      console.error('Ошибка sendMail:', err);
    }
    // 7) Ответ фронту — регистрация прошла, но нужно подтвердить почту
    res.status(201).json({
      message: 'Регистрация успешно выполнена. Проверьте вашу почту для подтверждения.'
    });
  } catch (err) {
    console.error('ERROR /api/auth/register:', err);
    res.status(500).json({ error: 'Не удалось зарегистрироваться' });
  }*/
    const confirmLink = `${process.env.APP_URL}/api/auth/confirm?token=${confirmToken}`;

    // Формируем JSON для Unisender Go
    const payload = {
      api_key: process.env.UNISENDER_API_KEY,
      message: {
        recipients: [{ email: req.body.email }],
        from_email: 'support@1logic.org',
        from_name : '1Logic Team',
        subject    : 'Подтвердите e-mail на 1Logic.org',
        body: {
          plaintext: `Здравствуйте!

Чтобы активировать аккаунт, перейдите по ссылке:
${confirmLink}`
        }
      }
    };

    try {
      const usRes = await axios.post(
        'https://go2.unisender.ru/ru/transactional/api/v1/email/send.json',
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (usRes.data.error) {
        console.error('Unisender Go API error:', usRes.data);
        throw new Error(usRes.data.error);
      }
    } catch (err) {
      console.error('Unisender Go send error:', err.response?.data || err.message);
      return res.status(500).json({ error: 'Не удалось отправить письмо подтверждения' });
    }

    res.status(201).json({ message: 'Регистрация прошла. Проверьте вашу почту для подтверждения.' });
  } catch (err) {
    console.error('ERROR /api/auth/register:', err);
    // если дубль e-mail:
    if (err.code === '23505') return res.status(409).json({ error: 'Этот e-mail уже зарегистрирован' });
    return res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// Логин
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await findUserByEmail(email);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.email_confirmed) {
    return res.status(403).json({ error: 'E-mail не подтверждён' });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ id: user.id, email: user.email });
});

// Проверка сессии
router.get('/me', async (req, res) => {
  try {
    const { token } = req.cookies;
    const payload = jwt.verify(token, JWT_SECRET);
    // *** проверяем, что такой пользователь ещё есть в БД ***
    const result = await db.query(
      'SELECT id, email FROM users WHERE id = $1',
      [payload.id]
    );
    if (result.rowCount === 0) throw new Error('User not found');
    // всё ок — возвращаем данные
    return res.json({ id: payload.id, email: payload.email });
  } catch {
    // сброс куки и 401, если подпись не верна или пользователя нет
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
    return res.status(401).end();
  }
});

// Выход
router.post('/logout', (req, res) => {
  // Флаг sameSite/sameDomain должен совпадать с тем, что вы ставили при установке
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  res.status(204).end();
});

// Маршрут подтверждения e-mail
router.get('/confirm', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Токен подтверждения не указан');
  try {
    const result = await db.query(
      `UPDATE users
         SET email_confirmed = TRUE,
             confirm_token   = NULL
       WHERE confirm_token = $1
         AND email_confirmed = FALSE
       RETURNING id, email`,
      [token]
    );
    if (result.rowCount === 0) {
      return res.status(400).send('Неверный или истёкший токен подтверждения');
    }
    return res.redirect(process.env.APP_URL + '/?confirmed=1');
  } catch (err) {
    console.error('ERROR /api/auth/confirm:', err);
    return res.status(500).send('Внутренняя ошибка сервера при подтверждении');
  }
});

export default router;
