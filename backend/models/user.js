import { db } from '../db.js';
import bcrypt from 'bcrypt';

export const createUser = async ({ email, password }) => {
  const hash = await bcrypt.hash(password, 10);
  const res = await db.query(
    'INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email',
    [email, hash]
  );
  return res.rows[0];
};

export const findUserByEmail = async email => {
  const res = await db.query('SELECT * FROM users WHERE email=$1', [email]);
  return res.rows[0];
};
