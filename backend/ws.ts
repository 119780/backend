// ws.ts

export type WSMessage =
    | { type: 'QUEUE_JOINED';  gamemode: string; position: number }
    | { type: 'QUEUE_LEFT';    gamemode: string }
    | { type: 'QUEUE_UPDATE';  gamemode: string; position: number }
    | { type: 'MATCH_FOUND';   matchId: string; serverIp: string; serverPort: number; gamemode: string }
    | { type: 'ERROR';         message: string }
    | { type: 'PING' }
    | { type: 'PONG' }

// One entry per connected player
type Connection = {
    socket:     WebSocket
    playerUuid: string
    username:   string
}

// uuid → connection
const connections = new Map<string, Connection>()

export function registerConnection(playerUuid: string, username: string, socket: WebSocket): void {
    // If the player already has a connection open, close the old one
    const existing = connections.get(playerUuid)
    if (existing) {
        existing.socket.close(1000, 'Replaced by new connection')
    }
    connections.set(playerUuid, { socket, playerUuid, username })
}

export function removeConnection(playerUuid: string): void {
    connections.delete(playerUuid)
}

export function sendToPlayer(playerUuid: string, msg: WSMessage): boolean {
    const conn = connections.get(playerUuid)
    if (!conn || conn.socket.readyState !== WebSocket.OPEN) return false
    conn.socket.send(JSON.stringify(msg))
    return true
}

export function getConnectedCount(): number {
    return connections.size
}
