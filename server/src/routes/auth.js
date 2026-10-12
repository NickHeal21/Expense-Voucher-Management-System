import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/login', async (request, response, next) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== 'string' || !emailPattern.test(email.trim()) ||
      typeof password !== 'string' || password.length === 0 || password.length > 200) {
    return response.status(400).json({ error: 'Enter a valid email and password.' });
  }

  if (!process.env.JWT_SECRET) {
    return response.status(500).json({ error: 'Authentication is not configured.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, password_hash, role
       FROM users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: String(user.id), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    );

    return response.json({
      token,
      user: { id: String(user.id), fullName: user.full_name, email: user.email, role: user.role },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticateToken, async (request, response, next) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, role FROM users WHERE id = $1',
      [request.user.id],
    );

    if (result.rowCount === 0) {
      return response.status(401).json({ error: 'Invalid or expired token.' });
    }

    const user = result.rows[0];
    return response.json({
      user: { id: String(user.id), fullName: user.full_name, email: user.email, role: user.role },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
