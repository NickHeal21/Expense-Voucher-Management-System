import jwt from 'jsonwebtoken';

const validRoles = ['employee', 'director', 'accounts'];

export function authenticateToken(request, response, next) {
  const authorization = request.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return response.status(401).json({ error: 'Authentication required.' });
  }
  const [, token] = match;

  if (!process.env.JWT_SECRET) {
    return response.status(500).json({ error: 'Authentication is not configured.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || typeof payload !== 'object' || !payload.id || !validRoles.includes(payload.role)) {
      return response.status(401).json({ error: 'Invalid or expired token.' });
    }

    request.user = { id: String(payload.id), role: payload.role };
    return next();
  } catch {
    return response.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return response.status(403).json({ error: 'You do not have permission to access this resource.' });
    }

    return next();
  };
}
