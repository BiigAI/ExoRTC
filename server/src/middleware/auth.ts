import { Request, Response, NextFunction } from 'express';
import { verifyToken, getUserById, User } from '../services/auth';

export interface AuthenticatedRequest extends Request {
    user?: User;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }

    const user = getUserById(payload.userId);
    if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
    }

    req.user = user;
    next();
}
