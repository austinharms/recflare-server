/**
 * Game-reward eligibility on the shared `recflare` D1 database — one row per (account,
 * reward type), written by `POST /api/gamerewards/v1/request`.
 *
 * The client asks for a reward whenever it thinks one is due ("First Game of the Day"
 * after an activity, "Activity completed!" after a match), so the server, not the client,
 * has to decide whether one is actually owed: this table is what makes a second ask for
 * the same reward a no-op instead of a second payout.
 *
 * Keyed by reward TYPE only. The client also sends a `giftContext` (the activity, e.g.
 * `Soccer`), but it is deliberately not part of the key — one cooldown per type, shared
 * across every activity, rather than one per activity.
 *
 * The `econ` worker owns this table and its migration
 * (apps/econ/migrations/0010_reward_status.sql).
 */

/** Schema DDL (mirror of migrations 0010_reward_status.sql) — also builds the table in tests. */
export const REWARD_STATUS_SCHEMA_DDL: string[] = [
	`CREATE TABLE IF NOT EXISTS reward_status (
		account_id INTEGER NOT NULL,
		reward_type TEXT NOT NULL,
		granted_at TEXT NOT NULL,
		grant_count INTEGER NOT NULL,
		PRIMARY KEY (account_id, reward_type)
	)`,
]

/**
 * How long a player must wait between rewards of the same type. One hour flat, for every
 * type — despite what a name like `FirstActivityOfDay` suggests. Per-type windows would be
 * a map keyed by reward type; there's one window until a reward type needs its own.
 */
export const REWARD_COOLDOWN_MS = 60 * 60 * 1000

/**
 * Claim a reward if the player is due one, returning how many of that type they have now
 * claimed — or `null` when the cooldown hasn't elapsed and nothing was claimed.
 *
 * The check and the claim are ONE statement. The client fires these off after a match, so
 * two requests can land together; a read-then-write would let both see the same stale
 * `granted_at` and pay out twice. `ON CONFLICT … DO UPDATE … WHERE` gives us the atomic
 * version: when the cooldown hasn't elapsed the update is skipped, no row is returned, and
 * the stored `granted_at` is left alone (so a rejected claim doesn't extend the cooldown).
 *
 * `granted_at` holds `toISOString()` output — fixed-width UTC, so the lexical `<=` against
 * the cutoff is a chronological comparison with no date parsing in SQL.
 */
export async function claimReward(
	db: D1Database,
	accountId: number,
	rewardType: string,
	now: Date = new Date()
): Promise<number | null> {
	const cutoff = new Date(now.getTime() - REWARD_COOLDOWN_MS).toISOString()
	const row = await db
		.prepare(
			`INSERT INTO reward_status (account_id, reward_type, granted_at, grant_count)
			 VALUES (?1, ?2, ?3, 1)
			 ON CONFLICT (account_id, reward_type) DO UPDATE SET
			   granted_at = excluded.granted_at,
			   grant_count = reward_status.grant_count + 1
			 WHERE reward_status.granted_at <= ?4
			 RETURNING grant_count`
		)
		.bind(accountId, rewardType, now.toISOString(), cutoff)
		.first<{ grant_count: number }>()
	return row?.grant_count ?? null
}
