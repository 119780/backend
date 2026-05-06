import { register } from './gamemode.ts'

import { sword } from './sword/sword.ts'
import { mace } from './mace/mace.ts'
import { rod_mace } from './mace/rod_mace.ts'


export function registerAll() {
    register(sword)
    register(mace)
    register(rod_mace)
};