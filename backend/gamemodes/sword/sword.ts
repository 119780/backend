// sword

import type { Gamemode, MatchResult, Player } from "../gamemode.ts"

export const sword: Gamemode = {
    id:              () => "sword",
    name:            () => "Sword",
    playersPerMatch: () => 2,
    kFactor:         () => 32,
    serverImage:     () => "mcpvp/server:latest",
    
    serverConfig(matchId: string, players: Player[]) {
        return {
            MATCH_ID:     matchId,
            GAMEMODE:     "sword",
            PLAYER1_UUID: players[0].uuid,
            PLAYER2_UUID: players[1].uuid,
            KIT:          "sword_diamond",
            KILLS_TO_WIN: "5",
            ARENA:        "colossuem",
        }
    },
    
    validateResult(result: MatchResult) {
        const kills = result.stats.winner_kills as number
        if (typeof kills !== "number") {
            throw new Error("Missing winner_kills in match stats")
        }
        const maxKills = result.duration / 20
        if (kills > maxKills) {
            throw new Error(`Impossible kill count ${kills} in ${result.duration}s`)
        }
    },
    
    async onMatchEnd(_result: MatchResult) {
        // TODO: save sword-specific stats (kill streak, avg kills, etc.)
    },
}
