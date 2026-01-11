import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';

export interface Mute {
    id: string;
    server_id: string;
    user_id: string;
    muted_at: string;
    muted_by: string;
    reason?: string;
}

export interface Kick {
    id: string;
    server_id: string;
    user_id: string;
    kicked_at: string;
    kicked_by: string;
    expires_at: string;
    reason?: string;
}

// Mutes
export function muteUser(serverId: string, userId: string, mutedBy: string, reason?: string): Mute {
    const id = uuidv4();
    db.run('INSERT INTO server_mutes (id, server_id, user_id, muted_by, reason) VALUES (?, ?, ?, ?, ?)',
        [id, serverId, userId, mutedBy, reason || null]);
    return { id, server_id: serverId, user_id: userId, muted_at: new Date().toISOString(), muted_by: mutedBy, reason };
}

export function unmuteUser(serverId: string, userId: string): boolean {
    const result = db.run('DELETE FROM server_mutes WHERE server_id = ? AND user_id = ?', [serverId, userId]);
    return result.changes > 0;
}

export function isUserMuted(serverId: string, userId: string): boolean {
    const row = db.get('SELECT id FROM server_mutes WHERE server_id = ? AND user_id = ?', [serverId, userId]);
    return !!row;
}

// Kicks
export function kickUser(serverId: string, userId: string, kickedBy: string, durationMinutes: number, reason?: string): Kick {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();

    db.run('INSERT INTO server_kicks (id, server_id, user_id, kicked_by, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?)',
        [id, serverId, userId, kickedBy, expiresAt, reason || null]);

    return { id, server_id: serverId, user_id: userId, kicked_at: new Date().toISOString(), kicked_by: kickedBy, expires_at: expiresAt, reason };
}

export function isUserKicked(serverId: string, userId: string): boolean {
    try {
        const row = db.get<{ expires_at: string }>('SELECT expires_at FROM server_kicks WHERE server_id = ? AND user_id = ? AND expires_at > datetime("now") ORDER BY expires_at DESC LIMIT 1', [serverId, userId]);
        return !!row;
    } catch {
        return false;
    }
}

export function getActiveKick(serverId: string, userId: string): Kick | null {
    return db.get<Kick>('SELECT * FROM server_kicks WHERE server_id = ? AND user_id = ? AND expires_at > datetime("now") ORDER BY expires_at DESC LIMIT 1', [serverId, userId]) || null;
}
