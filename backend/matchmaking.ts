// matchmaking.ts
import { sendToPlayer } from './ws.ts'
import type { WSMessage } from './ws.ts'
import { spawnGameServer } from './gameserver.ts'
import type { Config } from './config.ts'
import type { Player } from './gamemodes/gamemode.ts'
import { getGamemode } from './gamemodes/gamemode.ts'

export type QueueEntry = {
    playerUuid: string
    username:   string
    rating:     number
    joinedAt:   number
}

const queues = new Map<string, QueueEntry[]>()

const RATING_GAP_BASE    = 100
const RATING_GAP_PER_SEC = 5

let _config: Config | null = null

export function initMatchmaking(config: Config): void {
    _config = config
}

// -----------------------------------------------
// Queue management
// -----------------------------------------------

export function joinQueue(gamemodeId: string, entry: QueueEntry): { position: number } {
    if (!queues.has(gamemodeId)) queues.set(gamemodeId, [])
    const queue = queues.get(gamemodeId)!

    const existing = queue.findIndex(e => e.playerUuid === entry.playerUuid)
    if (existing !== -1) queue.splice(existing, 1)

    queue.push(entry)
    tryMatchmake(gamemodeId)

    return { position: queue.length }
}

export function leaveQueue(gamemodeId: string, playerUuid: string): boolean {
    const queue = queues.get(gamemodeId)
    if (!queue) return false
    const filtered = queue.filter(e => e.playerUuid !== playerUuid)
    queues.set(gamemodeId, filtered)
    return filtered.length < queue.length
}

export function leaveAllQueues(playerUuid: string): void {
    for (const [gamemodeId, queue] of queues) {
        queues.set(gamemodeId, queue.filter(e => e.playerUuid !== playerUuid))
    }
}

export function getQueueSize(gamemodeId: string): number {
    return queues.get(gamemodeId)?.length ?? 0
}

export function getQueuePosition(gamemodeId: string, playerUuid: string): number {
    const queue = queues.get(gamemodeId) ?? []
    const idx   = queue.findIndex(e => e.playerUuid === playerUuid)
    return idx === -1 ? -1 : idx + 1
}

// -----------------------------------------------
// Matchmaking logic
// -----------------------------------------------

function tryMatchmake(gamemodeId: string): void {
    const queue = queues.get(gamemodeId)
    if (!queue || queue.length < 2) return

    queue.sort((a, b) => a.rating - b.rating)

    const now     = Date.now()
    const matched = new Set<string>()

    for (let i = 0; i < queue.length - 1; i++) {
        if (matched.has(queue[i].playerUuid)) continue
        const p1 = queue[i]

        for (let j = i + 1; j < queue.length; j++) {
            if (matched.has(queue[j].playerUuid)) continue
            const p2 = queue[j]

            const waitSecs   = (now - Math.min(p1.joinedAt, p2.joinedAt)) / 1000
            const allowedGap = RATING_GAP_BASE + (waitSecs * RATING_GAP_PER_SEC)
            const ratingGap  = Math.abs(p1.rating - p2.rating)

            if (ratingGap <= allowedGap) {
                matched.add(p1.playerUuid)
                matched.add(p2.playerUuid)
                dispatchMatch(gamemodeId, p1, p2)
                break
            }
        }
    }

    queues.set(gamemodeId, queue.filter(e => !matched.has(e.playerUuid)))

    const remaining = queues.get(gamemodeId) ?? []
    remaining.forEach((entry, idx) => {
        sendToPlayer(entry.playerUuid, {
            type:     'QUEUE_UPDATE',
            gamemode: gamemodeId,
            position: idx + 1,
        })
    })
}

export function tickMatchmaking(): void {
    for (const gamemodeId of queues.keys()) {
        tryMatchmake(gamemodeId)
    }
}

async function dispatchMatch(
    gamemodeId: string,
    p1: QueueEntry,
    p2: QueueEntry,
): Promise<void> {
    const matchId = crypto.randomUUID()
    const gm      = getGamemode(gamemodeId)
    if (!gm) return

    // Map QueueEntry → Player so gamemode.serverConfig gets the right shape
    // QueueEntry uses playerUuid, but Player uses uuid — fix that here
    const players: [Player, Player] = [
        { uuid: p1.playerUuid, username: p1.username, rating: p1.rating },
        { uuid: p2.playerUuid, username: p2.username, rating: p2.rating },
    ]

    let serverIp   = '127.0.0.1'
    let serverPort = 25565

    if (_config) {
        try {
            const server = await spawnGameServer(_config, gm, matchId, players)
            serverIp     = server.ip
            serverPort   = server.port
        } catch (err) {
            console.error(`Failed to spawn server for match ${matchId}:`, err)
            sendToPlayer(p1.playerUuid, { type: 'ERROR', message: 'Failed to start match server, please rejoin queue' })
            sendToPlayer(p2.playerUuid, { type: 'ERROR', message: 'Failed to start match server, please rejoin queue' })
            return
        }
    }

    const matchMsg: WSMessage = {
        type:       'MATCH_FOUND',
        matchId,
        serverIp,
        serverPort,
        gamemode:   gamemodeId,
    }

    sendToPlayer(p1.playerUuid, matchMsg)
    sendToPlayer(p2.playerUuid, matchMsg)

    console.log(`Match dispatched [${gamemodeId}] ${p1.username} (${p1.rating}) vs ${p2.username} (${p2.rating}) → ${serverIp}:${serverPort}`)
}