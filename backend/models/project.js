import { db } from '../db.js';

/**
 * Получить список всех проектов пользователя
 * @param {number} userId
 * @returns {Promise<Array<{id: number, name: string, data: string}>>}
 */
export async function getProjectsByUser(userId) {
  const result = await db.query(
    'SELECT id, name, data FROM projects WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  return result.rows;
}

/**
 * Получить один проект по его id (и user_id, для безопасности)
 * @param {number} projectId
 * @param {number} userId
 * @returns {Promise<{id: number, name: string, data: string}|null>}
 */
export async function getProjectById(projectId, userId) {
  const result = await db.query(
    'SELECT id, name, data FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Создать новый проект
 * @param {number} userId
 * @param {string} name
 * @param {string} data
 * @returns {Promise<{id: number, name: string}>}
 */
export async function createProject(userId, name, data) {
  const result = await db.query(
    `INSERT INTO projects (user_id, name, data)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [userId, name, data]
  );
  return result.rows[0];
}

/**
 * Обновить существующий проект
 * @param {number} projectId
 * @param {number} userId
 * @param {string} name
 * @param {string} data
 * @returns {Promise<void>}
 */
export async function updateProject(projectId, userId, name, data) {
  await db.query(
    `UPDATE projects
     SET name = $1, data = $2, updated_at = NOW()
     WHERE id = $3 AND user_id = $4`,
    [name, data, projectId, userId]
  );
}

/**
 * Удалить проект
 * @param {number} projectId
 * @param {number} userId
 * @returns {Promise<void>}
 */
export async function deleteProject(projectId, userId) {
  await db.query(
    'DELETE FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
}
