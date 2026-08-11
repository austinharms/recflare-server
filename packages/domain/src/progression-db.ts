/**
 * Player progression — the level and XP shown on a profile — on the shared `recflare` D1.
 * One row per account, created on the first grant.
 *
 * Two workers share it, so it lives here rather than in either: `econ` WRITES it (game
 * rewards pay XP out) and `api` READS it (`GET /api/players/v{1,2}/progression/…`). Same
 * split as the gift boxes next door.
 *
 * A missing row is not an error — it means "nothing earned yet", which is exactly the
 * level-1/0-XP default the progression endpoints already served, so reads fall back to it
 * rather than inserting on a GET.
 *
 * `level` is stored, not derived. The reference server levels a player up by subtracting
 * the tier's `RequiredXp` from the running XP, with the thresholds coming from a config
 * file (`configv2.json`'s `LevelProgressionMaps`) that we don't have — so XP accumulates
 * here and everyone stays level 1 until those numbers exist. The column is present so
 * turning the curve on later is a write, not a migration.
 *
 * The `econ` worker owns the migration (apps/econ/migrations/0012_progression.sql), being
 * the writer.
 */

/** Schema DDL (mirror of apps/econ/migrations/0012_progression.sql). */
export const PROGRESSION_SCHEMA_DDL: string[] = [
	`CREATE TABLE IF NOT EXISTS progression (
		account_id INTEGER PRIMARY KEY,
		level INTEGER NOT NULL DEFAULT 1,
		xp INTEGER NOT NULL DEFAULT 0
	)`,
]

/** A player's progression, as the client's progression DTO renders it. */
export interface Progression {
	PlayerId: number
	Level: number
	XP: number
}

/** What a player with no row has: nothing earned yet. */
export function defaultProgression(accountId: number): Progression {
	return { PlayerId: accountId, Level: 1, XP: 0 }
}

/**
 * Add XP to a player and return what they now hold. The add is one statement, so two
 * rewards landing together can't both read the same stale total and write it back — the
 * client fires reward requests off right after a match.
 *
 * Non-positive amounts are dropped rather than written: nothing takes XP away, and a 0 XP
 * grant would otherwise create a row that says the same as no row at all.
 */
export async function addXp(db: D1Database, accountId: number, xp: number): Promise<Progression> {
	if (xp <= 0) return await getProgression(db, accountId)
	const row = await db
		.prepare(
			`INSERT INTO progression (account_id, level, xp) VALUES (?1, 1, ?2)
			 ON CONFLICT (account_id) DO UPDATE SET xp = progression.xp + excluded.xp
			 RETURNING level, xp`
		)
		.bind(accountId, xp)
		.first<{ level: number; xp: number }>()
	if (row === null) return defaultProgression(accountId)
	return { PlayerId: accountId, Level: row.level, XP: row.xp }
}

/** One player's progression, defaulted when they've earned nothing yet. */
export async function getProgression(db: D1Database, accountId: number): Promise<Progression> {
	const row = await db
		.prepare('SELECT level, xp FROM progression WHERE account_id = ?1')
		.bind(accountId)
		.first<{ level: number; xp: number }>()
	if (row === null) return defaultProgression(accountId)
	return { PlayerId: accountId, Level: row.level, XP: row.xp }
}

/**
 * Progressions for a list of ids, in the order asked and one per id — the bulk lookups
 * render a profile card per entry, so an id with no row still gets its default rather than
 * being dropped from the list.
 */
export async function getProgressions(
	db: D1Database,
	accountIds: number[]
): Promise<Progression[]> {
	if (accountIds.length === 0) return []
	const placeholders = accountIds.map((_, i) => `?${i + 1}`).join(', ')
	const { results } = await db
		.prepare(`SELECT account_id, level, xp FROM progression WHERE account_id IN (${placeholders})`)
		.bind(...accountIds)
		.all<{ account_id: number; level: number; xp: number }>()
	const stored = new Map(results.map((r) => [r.account_id, r]))
	return accountIds.map((id) => {
		const row = stored.get(id)
		return row === undefined
			? defaultProgression(id)
			: { PlayerId: id, Level: row.level, XP: row.xp }
	})
}
