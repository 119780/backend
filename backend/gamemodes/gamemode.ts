// --- Set up the interface for gamemodes --- //

export type Player = {
    uuid:     string
    username: string
    rating:   number
}

export type MatchResult = {
    matchId:    string
    gamemodeId: string
    winnerUuid: string
    loserUuid:  string
    duration:   number
    stats:      Record<string, unknown>
}

export interface Gamemode {
    id():              string
    name():            string
    playersPerMatch(): number
    kFactor():         number   // ELO volatility
    serverImage():     string   // Docker image
    serverConfig(matchId: string, players: Player[]): Record<string, string>
    validateResult(result: MatchResult): void
    onMatchEnd(result: MatchResult): Promise<void>
}

// Registry (tbh i just copied ts. idk how to do registries)
const registry = new Map<string, Gamemode>()

export function register(gamemode: Gamemode) {
    if (registry.has(gamemode.id())) {
        throw new Error(`Gamemode "${gamemode.id()}" is already registered`)
    }
    registry.set(gamemode.id(), gamemode)
    console.log(`Registered gamemode: ${gamemode.name()}`)
}

export function getGamemode(id: string): Gamemode | undefined {
    return registry.get(id)
}

export function getAllGamemodes(): Gamemode[] {
    return [...registry.values()]
}
