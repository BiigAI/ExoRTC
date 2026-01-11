import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';

export interface Room {
    id: string;
    server_id: string;
    name: string;
    voice_mode: 'ptt' | 'open';
    created_at: string;
}

export interface RoomMember {
    user_id: string;
    room_id: string;
    username: string;
    profile_color?: string;
    joined_at: string;
}

export function createRoom(serverId: string, name: string, voiceMode: 'ptt' | 'open' = 'ptt'): Room {
    const id = uuidv4();

    db.run('INSERT INTO rooms (id, server_id, name, voice_mode) VALUES (?, ?, ?, ?)', [id, serverId, name, voiceMode]);

    return {
        id,
        server_id: serverId,
        name,
        voice_mode: voiceMode,
        created_at: new Date().toISOString()
    };
}

export function getRoomsByServerId(serverId: string): Room[] {
    return db.all<Room>('SELECT * FROM rooms WHERE server_id = ?', [serverId]);
}

export function getRoomById(roomId: string): Room | null {
    return db.get<Room>('SELECT * FROM rooms WHERE id = ?', [roomId]) || null;
}

export function deleteRoom(roomId: string): boolean {
    const result = db.run('DELETE FROM rooms WHERE id = ?', [roomId]);
    return result.changes > 0;
}

export function joinRoom(userId: string, roomId: string): boolean {
    // Leave any other room first (user can only be in one room at a time)
    db.run('DELETE FROM room_members WHERE user_id = ?', [userId]);

    try {
        db.run('INSERT INTO room_members (user_id, room_id) VALUES (?, ?)', [userId, roomId]);
        return true;
    } catch {
        return false;
    }
}

export function leaveRoom(userId: string): boolean {
    const result = db.run('DELETE FROM room_members WHERE user_id = ?', [userId]);
    return result.changes > 0;
}

export function getRoomMembers(roomId: string): RoomMember[] {
    return db.all<RoomMember>(`
        SELECT rm.user_id, rm.room_id, u.username, u.profile_color, rm.joined_at
        FROM room_members rm
        INNER JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = ?
    `, [roomId]);
}

export function getUserCurrentRoom(userId: string): Room | null {
    const row = db.get<Room>(`
        SELECT r.* FROM rooms r
        INNER JOIN room_members rm ON r.id = rm.room_id
        WHERE rm.user_id = ?
    `, [userId]);
    return row || null;
}

export function getRoomsWithMemberCounts(serverId: string): (Room & { member_count: number })[] {
    return db.all<Room & { member_count: number }>(`
        SELECT r.*, COUNT(rm.user_id) as member_count
        FROM rooms r
        LEFT JOIN room_members rm ON r.id = rm.room_id
        WHERE r.server_id = ?
        GROUP BY r.id
    `, [serverId]);
}

export function getRoomsWithMembers(serverId: string): (Room & {
    member_count: number,
    members: Array<{ username: string, profile_color?: string }>
})[] {
    const rooms = db.all<Room & { member_count: number }>(`
        SELECT r.*, COUNT(rm.user_id) as member_count
        FROM rooms r
        LEFT JOIN room_members rm ON r.id = rm.room_id
        WHERE r.server_id = ?
        GROUP BY r.id
    `, [serverId]);

    return rooms.map(room => {
        const members = db.all<{ username: string, profile_color?: string }>(`
            SELECT u.username, u.profile_color
            FROM room_members rm
            INNER JOIN users u ON rm.user_id = u.id
            WHERE rm.room_id = ?
        `, [room.id]);

        return {
            ...room,
            members
        };
    });
}
