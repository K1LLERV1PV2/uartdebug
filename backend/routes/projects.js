import express from 'express';
import { db } from '../db.js';
import jwt from 'jsonwebtoken';
import { deleteProject } from '../models/project.js';
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware: извлечь userId из токена
router.use((req, res, next) => {
  try {
    const payload = jwt.verify(req.cookies.token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).end();
  }
});

// Получить все проекты пользователя
router.get('/', async (req, res) => {
  const result = await db.query(
    'SELECT id, name, data FROM projects WHERE user_id = $1',
    [req.userId]
  );
  res.json(result.rows);
});

// Сохранять или обновлять проект
router.post('/', async (req, res) => {
  const { id, name, data } = req.body;
  if (id) {
    await db.query(
      'UPDATE projects SET name=$1, data=$2 WHERE id=$3 AND user_id=$4',
      [name, data, id, req.userId]
    );
    return res.json({ id, name });
  }
  const result = await db.query(
    'INSERT INTO projects(user_id, name, data) VALUES($1,$2,$3) RETURNING id',
    [req.userId, name, data]
  );
  res.json({ id: result.rows[0].id, name });
});

router.delete('/:id', async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  await deleteProject(projectId, req.userId);
  res.status(204).end(); // No Content
});

export default router;

