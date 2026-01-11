import { Router, Request, Response } from 'express';
import { registerUser, loginUser } from '../services/auth';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        res.status(400).json({ error: 'Username, email, and password are required' });
        return;
    }

    if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
        return;
    }

    const result = await registerUser(username, email, password);

    if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
    }

    res.status(201).json({ user: result.user, token: result.token });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
        res.status(400).json({ error: 'Username/email and password are required' });
        return;
    }

    const result = await loginUser(username, password);

    if ('error' in result) {
        res.status(401).json({ error: result.error });
        return;
    }

    res.json({ user: result.user, token: result.token });
});

// GET /api/auth/me - Get current user
router.get('/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
});

// PUT /api/auth/profile/color
router.put('/profile/color', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const { color } = req.body;
    if (!color) {
        res.status(400).json({ error: 'Color is required' });
        return;
    }

    const { updateProfileColor } = await import('../services/auth');
    const result = await updateProfileColor(req.user!.id, color);

    if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
    }

    res.json({ user: result });
});

export default router;
