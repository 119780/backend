// gameserver.ts


import type { Config } from './config.ts'
import type { Gamemode, Player } from './gamemodes/gamemode.ts'

export type ActiveMatch = {
    matchId:     string
    gamemodeId:  string
    player1Uuid: string
    player2Uuid: string
    serverIp:    string
    serverPort:  number
    containerId: string | null  // null in stub mode
    startedAt:   Date
    lastHeartbeat: Date
}


const activeMatches = new Map<string, ActiveMatch>()

export async function spawnGameServer(
    config: Config,
    gamemode: Gamemode,
    matchId: string,
    players: [Player, Player],
): Promise<{ ip: string; port: number }> {
    const serverConfig = gamemode.serverConfig(matchId, players)

    const env: Record<string, string> = {
        ...serverConfig,
        SERVER_SECRET: config.serverSecret,
        BACKEND_URL:   config.backendUrl,
        MATCH_ID:      matchId,
    }

    let containerId: string | null = null
    let port = 25565

    if (config.dockerEnabled) {
        const result = await spawnDockerContainer(gamemode.serverImage(), env, config.serverHost)
        containerId  = result.containerId
        port         = result.port
    } else {
        console.log(`[STUB] Would spawn Docker container:`)
        console.log(`  image: ${gamemode.serverImage()}`)
        console.log(`  matchId: ${matchId}`)
        console.log(`  players: ${players.map(p => p.username).join(' vs ')}`)
        console.log(`  env: ${JSON.stringify(env, null, 2)}`)
        port = 25565 + (activeMatches.size % 100)
    }

    const match: ActiveMatch = {
        matchId,
        gamemodeId:   gamemode.id(),
        player1Uuid:  players[0].uuid,
        player2Uuid:  players[1].uuid,
        serverIp:     config.serverHost,
        serverPort:   port,
        containerId,
        startedAt:    new Date(),
        lastHeartbeat: new Date(),
    }
    activeMatches.set(matchId, match)

    console.log(`Match started: ${matchId} on ${config.serverHost}:${port}`)
    return { ip: config.serverHost, port }
}

export function recordHeartbeat(matchId: string): boolean {
    const match = activeMatches.get(matchId)
    if (!match) return false
    match.lastHeartbeat = new Date()
    return true
}

export async function cleanupGameServer(matchId: string): Promise<void> {
    const match = activeMatches.get(matchId)
    if (!match) return

    activeMatches.delete(matchId)

    if (match.containerId) {
        await stopDockerContainer(match.containerId)
    } else {
        console.log(`[STUB] Would stop container for match ${matchId}`)
    }

    console.log(`Match cleaned up: ${matchId}`)
}

export function getActiveMatch(matchId: string): ActiveMatch | undefined {
    return activeMatches.get(matchId)
}

export function getActiveMatchCount(): number {
    return activeMatches.size
}

export async function cleanupDeadServers(): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    for (const [matchId, match] of activeMatches) {
        if (match.lastHeartbeat < fiveMinutesAgo) {
            console.warn(`Match ${matchId} timed out — server appears dead, cleaning up`)
            await cleanupGameServer(matchId)
        }
    }
}


type DockerSpawnResult = {
    containerId: string
    port:        number
}


async function spawnDockerContainer(
    image: string,
    env: Record<string, string>,
    serverHost: string,
): Promise<DockerSpawnResult> {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])

    const cmd = new Deno.Command('docker', {
        args: ['run', '-d', '--rm', '-P', ...envArgs, image],
        stdout: 'piped',
        stderr: 'piped',
    })

    const { code, stdout, stderr } = await cmd.output()
    if (code !== 0) {
        const errText = new TextDecoder().decode(stderr)
        throw new Error(`Docker run failed: ${errText}`)
    }

    const containerId = new TextDecoder().decode(stdout).trim()

    const portCmd = new Deno.Command('docker', {
        args: ['port', containerId, '25565'],
        stdout: 'piped',
    })
    const portOut = await portCmd.output()
    const portStr = new TextDecoder().decode(portOut.stdout).trim()
    const port    = parseInt(portStr.split(':').pop() ?? '25565')

    await waitForDockerContainer(serverHost, port)

    return { containerId, port }
}

async function waitForDockerContainer(
    ip: string,
    port: number,
    timeoutMs = 120_000,
): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
        try {
            const conn = await Deno.connect({ hostname: ip, port })
            conn.close()
            console.log(`Server ready at ${ip}:${port}`)
            return
        } catch {
            console.log(`Waiting for server at ${ip}:${port}...`)
            await new Promise(r => setTimeout(r, 3_000))
        }
    }

    throw new Error(`Server at ${ip}:${port} did not become ready within ${timeoutMs / 1000}s`)
}

async function stopDockerContainer(containerId: string): Promise<void> {
    const cmd = new Deno.Command('docker', {
        args: ['stop', containerId],
        stdout: 'null',
        stderr: 'null',
    })
    await cmd.output()
}