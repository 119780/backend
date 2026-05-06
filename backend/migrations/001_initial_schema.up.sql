-- 001_initial_schema.up.sql

CREATE TABLE IF NOT EXISTS players (
    uuid        UUID PRIMARY KEY,
    username    VARCHAR(16) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Separate rating per gamemode — Sword ELO and Mace ELO are completely independent
CREATE TABLE IF NOT EXISTS player_ratings (
    player_uuid  UUID        NOT NULL REFERENCES players(uuid) ON DELETE CASCADE,
    gamemode_id  VARCHAR(32) NOT NULL,
    rating       INT         NOT NULL DEFAULT 1000,
    peak_rating  INT         NOT NULL DEFAULT 1000,
    wins         INT         NOT NULL DEFAULT 0,
    losses       INT         NOT NULL DEFAULT 0,
    win_streak   INT         NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (player_uuid, gamemode_id)
);

-- Immutable match log — never update rows here, only insert
CREATE TABLE IF NOT EXISTS matches (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gamemode_id      VARCHAR(32) NOT NULL,
    winner_uuid      UUID        NOT NULL REFERENCES players(uuid),
    loser_uuid       UUID        NOT NULL REFERENCES players(uuid),
    winner_elo_before INT        NOT NULL,
    winner_elo_after  INT        NOT NULL,
    loser_elo_before  INT        NOT NULL,
    loser_elo_after   INT        NOT NULL,
    duration_secs    INT         NOT NULL,
    stats            JSONB,
    played_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ratings_gamemode_rating ON player_ratings (gamemode_id, rating DESC);
CREATE INDEX IF NOT EXISTS idx_matches_winner          ON matches (winner_uuid, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_loser           ON matches (loser_uuid,  played_at DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token        TEXT        PRIMARY KEY,
    player_uuid  UUID        NOT NULL REFERENCES players(uuid) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
