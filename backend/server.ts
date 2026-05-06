// server.ts
import { Hono, type Context } from 'hono'
import type { Config } from './config.ts'
import type { DB } from './db.ts'
import { logger, cors, rateLimit, securityHeaders, requireAuth, requireServerSecret } from './middleware/middleware.ts'
import { getAllGamemodes, getGamemode } from './gamemodes/gamemode.ts'
import { verifyMojangSession } from './auth/mojang.ts'
import { signAccessToken, generateRefreshToken, verifyAccessToken } from './auth/jwt.ts'
import {
    findPlayer, createPlayer, updatePlayerLastSeen,
    getPlayerProfile, saveRefreshToken, findRefreshToken, deleteRefreshToken,
} from './auth/players.ts'
import { getLeaderboard, getPlayerMatches, saveMatchResult } from './auth/matches.ts'
import { calculateElo, getRankTier } from './elo.ts'
import { registerConnection, removeConnection, sendToPlayer } from './ws.ts'
import { joinQueue, leaveQueue, leaveAllQueues, getQueuePosition, getQueueSize, tickMatchmaking, initMatchmaking } from './matchmaking.ts'
import { recordHeartbeat, cleanupGameServer, cleanupDeadServers } from './gameserver.ts'

export function createServer(config: Config, db: DB): Hono {
    // Give matchmaker access to config so it can spawn servers
    initMatchmaking(config)

    // Re-run matchmaking every 10s to expand rating gaps for waiting players
    setInterval(tickMatchmaking, 10_000)

    // Check for crashed game servers every 60s
    setInterval(cleanupDeadServers, 60_000)

    const app = new Hono()

    app.use('*', logger())
    app.use('*', securityHeaders())
    app.use('*', cors(config))
    app.use('*', rateLimit())

    // -----------------------------------------------
    // Public routes
    // -----------------------------------------------

    app.get('/health', (c: Context) => c.json({
        status:  'ok',
        version: '0.6.0',
    }))

    app.get('/api/v1/gamemodes', (c: Context) => {
        const gamemodes = getAllGamemodes().map(gm => ({ id: gm.id(), name: gm.name() }))
        return c.json({ gamemodes })
    })

    app.get('/api/v1/player/:uuid', async (c: Context) => {
        const uuid = c.req.param('uuid')
        if (!uuid) return c.json({ error: 'UUID is required' }, 400)
        const profile = await getPlayerProfile(db, uuid)
        if (!profile) return c.json({ error: 'Player not found' }, 404)
        const ratings = profile.ratings.map(r => ({ ...r, tier: getRankTier(r.rating) }))
        return c.json({ player: { ...profile, ratings } })
    })

    app.get('/api/v1/player/:uuid/matches', async (c: Context) => {
        const uuid       = c.req.param('uuid')
        const gamemodeId = c.req.query('gamemode')
        if (!uuid) return c.json({ error: 'UUID is required' }, 400)
        const player     = await findPlayer(db, uuid)
        if (!player) return c.json({ error: 'Player not found' }, 404)
        const matches = await getPlayerMatches(db, uuid, gamemodeId)
        return c.json({ matches })
    })

    app.get('/api/v1/leaderboard/:gamemode', async (c: Context) => {
        const gamemodeId = c.req.param('gamemode')
        if (!gamemodeId || !getGamemode(gamemodeId)) {
            return c.json({ error: `Unknown gamemode: ${gamemodeId}` }, 404)
        }
        const limitParam = parseInt(c.req.query('limit') ?? '100')
        const limit      = Math.min(Math.max(1, limitParam), 100)
        const entries    = await getLeaderboard(db, gamemodeId, limit)
        return c.json({ gamemode: gamemodeId, entries })
    })

    app.get('/api/v1/queue/sizes', (c: Context) => {
        const sizes: Record<string, number> = {}
        for (const gm of getAllGamemodes()) {
            sizes[gm.id()] = getQueueSize(gm.id())
        }
        return c.json({ sizes })
    })

    app.post('/api/v1/auth/login', async (c: Context) => {
        let body: { username?: string; serverHash?: string }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { username, serverHash } = body
        if (!username || !serverHash) {
            return c.json({ error: 'username and serverHash are required' }, 400)
        }

        let mojangProfile
        if (config.environment === 'development') {
            let hash = 0
            for (const char of username) {
                hash = ((hash << 5) - hash) + char.charCodeAt(0)
                hash |= 0
            }
            const h = Math.abs(hash).toString(16).padStart(8, '0')
            mojangProfile = {
                uuid: `${h}-0000-0000-0000-000000000000`,
                username: username,
            }
        } else {
            try { mojangProfile = await verifyMojangSession(username, serverHash) }
            catch { return c.json({ error: 'Mojang session verification failed' }, 401) }
        }


        let player = await findPlayer(db, mojangProfile.uuid)
        if (!player) {
            player = await createPlayer(db, mojangProfile)
        } else {
            await updatePlayerLastSeen(db, player.uuid, mojangProfile.username)
        }

        const accessToken  = await signAccessToken(player.uuid, player.username, config.jwtSecret, config.jwtAccessMinutes)
        const refreshToken = generateRefreshToken()
        await saveRefreshToken(db, player.uuid, refreshToken, config.jwtRefreshDays)

        return c.json({
            accessToken,
            refreshToken,
            player: { uuid: player.uuid, username: player.username },
        })
    })

    app.post('/api/v1/auth/refresh', async (c: Context) => {
        let body: { refreshToken?: string }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { refreshToken } = body
        if (!refreshToken) return c.json({ error: 'refreshToken is required' }, 400)

        const record = await findRefreshToken(db, refreshToken)
        if (!record) return c.json({ error: 'Invalid or expired refresh token' }, 401)

        await deleteRefreshToken(db, refreshToken)

        const player = await findPlayer(db, record.playerUuid)
        if (!player) return c.json({ error: 'Player not found' }, 404)

        const newAccessToken  = await signAccessToken(player.uuid, player.username, config.jwtSecret, config.jwtAccessMinutes)
        const newRefreshToken = generateRefreshToken()
        await saveRefreshToken(db, player.uuid, newRefreshToken, config.jwtRefreshDays)

        return c.json({ accessToken: newAccessToken, refreshToken: newRefreshToken })
    })

    // -----------------------------------------------
    // Authenticated routes — JWT required
    // -----------------------------------------------
    const authed = new Hono()
    authed.use('*', requireAuth(config.jwtSecret))

    authed.get('/me', async (c: Context) => {
        const uuid    = c.get('playerUuid') as string
        const profile = await getPlayerProfile(db, uuid)
        if (!profile) return c.json({ error: 'Player not found' }, 404)
        const ratings = profile.ratings.map(r => ({ ...r, tier: getRankTier(r.rating) }))
        return c.json({ player: { ...profile, ratings } })
    })

    authed.get('/me/matches', async (c: Context) => {
        const uuid       = c.get('playerUuid') as string
        const gamemodeId = c.req.query('gamemode')
        const matches    = await getPlayerMatches(db, uuid, gamemodeId)
        return c.json({ matches })
    })

    authed.post('/queue/join', async (c: Context) => {
        let body: { gamemode?: string }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { gamemode: gamemodeId } = body
        if (!gamemodeId) return c.json({ error: 'gamemode is required' }, 400)

        const gm = getGamemode(gamemodeId)
        if (!gm) return c.json({ error: `Unknown gamemode: ${gamemodeId}` }, 404)

        const uuid    = c.get('playerUuid') as string
        const profile = await getPlayerProfile(db, uuid)
        if (!profile) return c.json({ error: 'Player not found' }, 404)

        const rating = profile.ratings.find(r => r.gamemodeId === gamemodeId)?.rating ?? 1000

        const { position } = joinQueue(gamemodeId, {
            playerUuid: uuid,
            username:   profile.username,
            rating,
            joinedAt:   Date.now(),
        })

        sendToPlayer(uuid, { type: 'QUEUE_JOINED', gamemode: gamemodeId, position })

        return c.json({ queued: true, gamemode: gamemodeId, position })
    })

    authed.post('/queue/leave', async (c: Context) => {
        let body: { gamemode?: string }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { gamemode: gamemodeId } = body
        if (!gamemodeId) return c.json({ error: 'gamemode is required' }, 400)

        const uuid = c.get('playerUuid') as string
        leaveQueue(gamemodeId, uuid)
        sendToPlayer(uuid, { type: 'QUEUE_LEFT', gamemode: gamemodeId })

        return c.json({ left: true, gamemode: gamemodeId })
    })

    authed.get('/ws', (c: Context) => {
        const uuid     = c.get('playerUuid') as string
        const username = c.get('playerUsername') as string

        if (c.req.header('upgrade') !== 'websocket') {
            return c.json({ error: 'Expected WebSocket upgrade' }, 426)
        }

        const { socket, response } = Deno.upgradeWebSocket(c.req.raw)

        socket.onopen = () => {
            registerConnection(uuid, username, socket)
            console.log(`WS connected: ${username} (${uuid})`)
        }

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data)
                if (msg.type === 'PING') socket.send(JSON.stringify({ type: 'PONG' }))
            } catch {
                // ignore malformed messages
            }
        }

        socket.onclose = () => {
            removeConnection(uuid)
            leaveAllQueues(uuid)
            console.log(`WS disconnected: ${username} (${uuid})`)
        }

        socket.onerror = (err) => {
            console.error(`WS error for ${username}:`, err)
        }

        return response
    })

    app.route('/api/v1', authed)

    // -----------------------------------------------
    // Internal routes — game servers only
    // -----------------------------------------------
    const internal = new Hono()
    internal.use('*', requireServerSecret(config.serverSecret))

    // Game server pings this every 30s to prove it's still alive
    internal.post('/match/heartbeat', async (c: Context) => {
        let body: { matchId?: string }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { matchId } = body
        if (!matchId) return c.json({ error: 'matchId is required' }, 400)

        const found = recordHeartbeat(matchId)
        if (!found) return c.json({ error: 'Match not found' }, 404)

        return c.json({ ok: true })
    })

    internal.post('/match/result', async (c: Context) => {
        let body: {
            matchId?:     string
            gamemodeId?:  string
            winnerUuid?:  string
            loserUuid?:   string
            durationSecs?: number
            stats?:       Record<string, unknown>
        }
        try { body = await c.req.json() }
        catch { return c.json({ error: 'Invalid JSON body' }, 400) }

        const { matchId, gamemodeId, winnerUuid, loserUuid, durationSecs, stats } = body
        if (!gamemodeId || !winnerUuid || !loserUuid || !durationSecs) {
            return c.json({ error: 'gamemodeId, winnerUuid, loserUuid, durationSecs are required' }, 400)
        }

        const gm = getGamemode(gamemodeId)
        if (!gm) return c.json({ error: `Unknown gamemode: ${gamemodeId}` }, 404)

        try {
            gm.validateResult({
                matchId:    matchId ?? crypto.randomUUID(),
                gamemodeId,
                winnerUuid,
                loserUuid,
                duration:   durationSecs,
                stats:      stats ?? {},
            })
        } catch (err) {
            return c.json({ error: `Invalid match result: ${(err as Error).message}` }, 422)
        }

        const winnerProfile = await getPlayerProfile(db, winnerUuid)
        const loserProfile  = await getPlayerProfile(db, loserUuid)
        if (!winnerProfile || !loserProfile) {
            return c.json({ error: 'One or both players not found' }, 404)
        }

        const winnerRating = winnerProfile.ratings.find(r => r.gamemodeId === gamemodeId)?.rating ?? 1000
        const loserRating  = loserProfile.ratings.find(r => r.gamemodeId === gamemodeId)?.rating ?? 1000
        const elo          = calculateElo(winnerRating, loserRating, gm.kFactor())

        const match = await saveMatchResult(
            db, gamemodeId, winnerUuid, loserUuid,
            elo, durationSecs, stats ?? {},
        )

        await gm.onMatchEnd({
            matchId:    match.id,
            gamemodeId,
            winnerUuid,
            loserUuid,
            duration:   durationSecs,
            stats:      stats ?? {},
        })

        // Clean up the game server container now that the match is done
        if (matchId) await cleanupGameServer(matchId)

        return c.json({
            match,
            eloChanges: {
                winner: { before: elo.winnerRatingBefore, after: elo.winnerRatingAfter, change: elo.winnerChange },
                loser:  { before: elo.loserRatingBefore,  after: elo.loserRatingAfter,  change: elo.loserChange },
            },
        })
    })

    app.route('/internal', internal)

    return app
}