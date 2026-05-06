
import type { DB } from '../db.ts'
import type { EloResult } from '../elo.ts'

export type Match = {
    id:              string
    gamemodeId:      string
    winnerUuid:      string
    loserUuid:       string
    winnerEloBefore: number
    winnerEloAfter:  number
    loserEloBefore:  number
    loserEloAfter:   number
    durationSecs:    number
    stats:           Record<string, unknown> | null
    playedAt:        Date
}

export type LeaderboardEntry = {
    rank:       number
    uuid:       string
    username:   string
    rating:     number
    peakRating: number
    wins:       number
    losses:     number
    winStreak:  number
    tier:       string
}

export async function saveMatchResult(
    sql: DB,
    gamemodeId:   string,
    winnerUuid:   string,
    loserUuid:    string,
    elo:          EloResult,
    durationSecs: number,
    stats:        Record<string, unknown>,
): Promise<Match> {
    const result = await sql.begin(async (tx) => {
        const rows = await tx<Match[]>`
            INSERT INTO matches (
                gamemode_id,
                winner_uuid,       loser_uuid,
                winner_elo_before, winner_elo_after,
                loser_elo_before,  loser_elo_after,
                duration_secs,     stats
            ) VALUES (
                ${gamemodeId},
                ${winnerUuid},              ${loserUuid},
                ${elo.winnerRatingBefore},  ${elo.winnerRatingAfter},
                ${elo.loserRatingBefore},   ${elo.loserRatingAfter},
                ${durationSecs},            ${JSON.stringify(stats)}
            )
            RETURNING
                id, gamemode_id as "gamemodeId",
                winner_uuid as "winnerUuid",       loser_uuid as "loserUuid",
                winner_elo_before as "winnerEloBefore", winner_elo_after as "winnerEloAfter",
                loser_elo_before as "loserEloBefore",   loser_elo_after as "loserEloAfter",
                duration_secs as "durationSecs", stats, played_at as "playedAt"
        `

        await tx`
            UPDATE player_ratings SET
                rating      = ${elo.winnerRatingAfter},
                peak_rating = GREATEST(peak_rating, ${elo.winnerRatingAfter}),
                wins        = wins + 1,
                win_streak  = win_streak + 1,
                updated_at  = NOW()
            WHERE player_uuid = ${winnerUuid}
              AND gamemode_id  = ${gamemodeId}
        `

        await tx`
            UPDATE player_ratings SET
                rating     = ${elo.loserRatingAfter},
                losses     = losses + 1,
                win_streak = 0,
                updated_at = NOW()
            WHERE player_uuid = ${loserUuid}
              AND gamemode_id  = ${gamemodeId}
        `

        return rows[0]
    })

    return result
}

export async function getLeaderboard(
    sql: DB,
    gamemodeId: string,
    limit = 100,
): Promise<LeaderboardEntry[]> {
    const rows = await sql<Omit<LeaderboardEntry, 'rank' | 'tier'>[]>`
        SELECT
            p.uuid,
            p.username,
            pr.rating,
            pr.peak_rating as "peakRating",
            pr.wins,
            pr.losses,
            pr.win_streak  as "winStreak"
        FROM player_ratings pr
        JOIN players p ON p.uuid = pr.player_uuid
        WHERE pr.gamemode_id = ${gamemodeId}
        ORDER BY pr.rating DESC
        LIMIT ${limit}
    `

    const { getRankTier } = await import('../elo.ts')
    return rows.map((row, i) => ({
        ...row,
        rank: i + 1,
        tier: getRankTier(row.rating),
    }))
}

export async function getPlayerMatches(
    sql: DB,
    playerUuid: string,
    gamemodeId?: string,
    limit = 20,
): Promise<Match[]> {
    const rows = gamemodeId
        ? await sql<Match[]>`
            SELECT
                id, gamemode_id as "gamemodeId",
                winner_uuid as "winnerUuid",       loser_uuid as "loserUuid",
                winner_elo_before as "winnerEloBefore", winner_elo_after as "winnerEloAfter",
                loser_elo_before as "loserEloBefore",   loser_elo_after as "loserEloAfter",
                duration_secs as "durationSecs", stats, played_at as "playedAt"
            FROM matches
            WHERE (winner_uuid = ${playerUuid} OR loser_uuid = ${playerUuid})
              AND gamemode_id = ${gamemodeId}
            ORDER BY played_at DESC
            LIMIT ${limit}
          `
        : await sql<Match[]>`
            SELECT
                id, gamemode_id as "gamemodeId",
                winner_uuid as "winnerUuid",       loser_uuid as "loserUuid",
                winner_elo_before as "winnerEloBefore", winner_elo_after as "winnerEloAfter",
                loser_elo_before as "loserEloBefore",   loser_elo_after as "loserEloAfter",
                duration_secs as "durationSecs", stats, played_at as "playedAt"
            FROM matches
            WHERE winner_uuid = ${playerUuid} OR loser_uuid = ${playerUuid}
            ORDER BY played_at DESC
            LIMIT ${limit}
          `

    return rows
}