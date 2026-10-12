import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authenticateToken, requireRole } from '../src/middleware/auth.js';

function runMiddleware(middleware, authorization) {
  const result = { status: 200, body: null, user: undefined, continued: false };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  middleware({
    get: () => authorization,
    user: undefined,
  }, response, () => { result.continued = true; });
  return result;
}

test('authentication rejects missing, invalid, and expired bearer tokens', () => {
  process.env.JWT_SECRET = 'test-only-secret';
  assert.equal(runMiddleware(authenticateToken).status, 401);
  assert.equal(runMiddleware(authenticateToken, 'Bearer invalid').status, 401);
  const expired = jwt.sign({ id: '1', role: 'employee' }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal(runMiddleware(authenticateToken, `Bearer ${expired}`).status, 401);
});

test('authentication accepts a valid token and attaches only its id and role', () => {
  process.env.JWT_SECRET = 'test-only-secret';
  const token = jwt.sign({ id: '12', role: 'director' }, process.env.JWT_SECRET);
  const request = { get: () => `Bearer ${token}` };
  const response = { status() { return this; }, json(body) { this.body = body; return this; } };
  let continued = false;
  authenticateToken(request, response, () => { continued = true; });
  assert.equal(continued, true);
  assert.deepEqual(request.user, { id: '12', role: 'director' });
});

test('Director-only role check denies employees and Accounts and allows Directors', () => {
  const directorOnly = requireRole('director');
  for (const role of ['employee', 'accounts']) {
    const result = { status: 200, body: null };
    const response = {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    };
    directorOnly({ user: { id: '1', role } }, response, () => {});
    assert.equal(result.status, 403);
  }

  let continued = false;
  directorOnly({ user: { id: '1', role: 'director' } }, {}, () => { continued = true; });
  assert.equal(continued, true);
});

test('employee-only role check denies Director and Accounts users', () => {
  const employeeOnly = requireRole('employee');
  for (const role of ['director', 'accounts']) {
    const result = { status: 200 };
    const response = { status(code) { result.status = code; return this; }, json() { return this; } };
    employeeOnly({ user: { id: '5', role } }, response, () => {});
    assert.equal(result.status, 403);
  }
  let continued = false;
  employeeOnly({ user: { id: '5', role: 'employee' } }, {}, () => { continued = true; });
  assert.equal(continued, true);
});
