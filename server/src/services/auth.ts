import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_EXPIRES_IN = '7d';

export interface User {
    id: string;
    username: string;
    email: string;
    password_hash?: string;
    profile_color?: string;
    created_at: string;
}

export interface TokenPayload {
    userId: string;
    username: string;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export function generateToken(user: User): string {
    const payload: TokenPayload = {
        userId: user.id,
        username: user.username
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch {
        return null;
    }
}

export async function registerUser(username: string, email: string, password: string): Promise<{ user: User; token: string } | { error: string }> {
    // Check if username or email already exists
    const existing = db.get<User>('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) {
        return { error: 'Username or email already exists' };
    }

    const id = uuidv4();
    const password_hash = await hashPassword(password);

    try {
        db.run('INSERT INTO users (id, username, email, password_hash, profile_color) VALUES (?, ?, ?, ?, ?)', [id, username, email, password_hash, '#CC2244']);
        const user: User = { id, username, email, profile_color: '#CC2244', created_at: new Date().toISOString() };
        const token = generateToken(user);
        return { user, token };
    } catch (err) {
        return { error: 'Failed to create user' };
    }
}

export async function loginUser(usernameOrEmail: string, password: string): Promise<{ user: User; token: string } | { error: string }> {
    const row = db.get<User>('SELECT * FROM users WHERE username = ? OR email = ?', [usernameOrEmail, usernameOrEmail]);

    if (!row || !row.password_hash) {
        return { error: 'Invalid credentials' };
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
        return { error: 'Invalid credentials' };
    }

    const user: User = {
        id: row.id,
        username: row.username,
        email: row.email,
        profile_color: row.profile_color || '#CC2244',
        created_at: row.created_at
    };
    const token = generateToken(user);
    return { user, token };
}

export function getUserById(id: string): User | null {
    const row = db.get<User>('SELECT id, username, email, profile_color, created_at FROM users WHERE id = ?', [id]);
    return row || null;
}

export async function updateProfileColor(userId: string, color: string): Promise<User | { error: string }> {
    try {
        db.run('UPDATE users SET profile_color = ? WHERE id = ?', [color, userId]);
        const user = getUserById(userId);
        if (!user) return { error: 'User not found' };
        return user;
    } catch (err) {
        return { error: 'Failed to update color' };
    }
}
