// Anything to do with players

import type { DB } from '../db.ts'
import type { MojangProfile } from './mojang.ts'
import { getAllGamemodes } from '../gamemodes/gamemode.ts'

export type Player = {
    uuid:      string
    username:  string
    createdAt: Date
    lastSeen:  Date
}

export type PlayerRating = {
    gamemodeId: string
    rating:     number
    peakRating: number
    wins:       number
    losses:     number
    winStreak:  number
}

export type PlayerProfile = Player & { ratings: PlayerRating[] }

export async function findPlayer(sql: DB, uuid: string): Promise<Player | undefined> {
    const rows = await sql<Player[]>`
        SELECT uuid, username, created_at as "createdAt", last_seen as "lastSeen"
        FROM players WHERE uuid = ${uuid}
    `
    return rows[0]
}

export async function createPlayer(sql: DB, profile: MojangProfile): Promise<Player> {
    const rows = await sql<Player[]>`
        INSERT INTO players (uuid, username)
        VALUES (${profile.uuid}, ${profile.username})
        ON CONFLICT (uuid) DO UPDATE
            SET username = EXCLUDED.username, last_seen = NOW()
        RETURNING uuid, username, created_at as "createdAt", last_seen as "lastSeen"
    `
    const player = rows[0]

    for (const gm of getAllGamemodes()) {
        await sql`
            INSERT INTO player_ratings (player_uuid, gamemode_id, rating)
            VALUES (${profile.uuid}, ${gm.id()}, 1000)
            ON CONFLICT DO NOTHING
        `
    }

    return player
}

export async function updatePlayerLastSeen(sql: DB, uuid: string, username: string): Promise<void> {
    await sql`
        UPDATE players SET username = ${username}, last_seen = NOW()
        WHERE uuid = ${uuid}
    `
}

export async function getPlayerProfile(sql: DB, uuid: string): Promise<PlayerProfile | undefined> {
    const player = await findPlayer(sql, uuid)
    if (!player) return undefined

    const ratings = await sql<PlayerRating[]>`
        SELECT
            gamemode_id  as "gamemodeId",
            rating, peak_rating as "peakRating",
            wins, losses, win_streak as "winStreak"
        FROM player_ratings
        WHERE player_uuid = ${uuid}
        ORDER BY gamemode_id
    `
    return { ...player, ratings }
}

export async function saveRefreshToken(
    sql: DB, playerUuid: string, token: string, expiryDays: number,
): Promise<void> {
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    await sql`
        INSERT INTO refresh_tokens (token, player_uuid, expires_at)
        VALUES (${token}, ${playerUuid}, ${expiresAt})
    `
}

export async function findRefreshToken(
    sql: DB, token: string,
): Promise<{ playerUuid: string } | undefined> {
    const rows = await sql<{ playerUuid: string }[]>`
        SELECT player_uuid as "playerUuid"
        FROM refresh_tokens
        WHERE token = ${token} AND expires_at > NOW()
    `
    return rows[0]
}

export async function deleteRefreshToken(sql: DB, token: string): Promise<void> {
    await sql`DELETE FROM refresh_tokens WHERE token = ${token}`
}