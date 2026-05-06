// Validate a Minecraft session with Mojang's API

export type MojangProfile = {
    uuid:     string
    username: string
}

export async function verifyMojangSession(
    username: string,
    serverHash: string,
): Promise<MojangProfile> {
    const url = `https://sessionserver.mojang.com/session/minecraft/hasJoined` +
                `?username=${encodeURIComponent(username)}` +
                `&serverId=${encodeURIComponent(serverHash)}`

    const res = await fetch(url)

    if (res.status === 204 || !res.ok) {
        throw new Error('Invalid Mojang session')
    }

    const data = await res.json()

    // Mojang returns UUIDs without dashes — reformat to standard UUID
    const raw: string = data.id
    const uuid = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`

    return { uuid, username: data.name }
}