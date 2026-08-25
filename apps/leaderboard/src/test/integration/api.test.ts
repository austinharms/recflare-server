import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('response with hello world', async () => {
	const res = await SELF.fetch('https://example.com')
	expect(res.status).toBe(200)
	expect(await res.text()).toMatchInlineSnapshot(`"hello, world!"`)
})

it('answers GetNearbyScores with an empty row list', async () => {
	const res = await SELF.fetch('https://example.com/leaderboard/GetNearbyScores', {
		method: 'POST',
		body: JSON.stringify({}),
	})
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({ Rows: [] })
})

it('answers GetRanks with an empty row list', async () => {
	const res = await SELF.fetch('https://example.com/leaderboard/GetRanks', {
		method: 'POST',
		body: JSON.stringify({
			RankStart: 0,
			RankEnd: 9,
			PlayerId: 2,
			StatChannel: 1,
			RoomId: 6,
			FilterType: 0,
			SortAscending: false,
		}),
	})
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({ Rows: [] })
})

it('answers GetPlayerRank with the unranked sentinel and the caller’s own id', async () => {
	const res = await SELF.fetch('https://example.com/leaderboard/GetPlayerRank', {
		method: 'POST',
		body: JSON.stringify({
			PlayerId: 205,
			StatChannel: 2,
			RoomId: 14,
			FilterType: 0,
			SortAscending: false,
		}),
	})
	expect(res.status).toBe(200)
	// Three fields, no board selectors: the client pairs the answer with its own question.
	// Rank is 1-based, so the sentinel has to be a big number rather than 0 — which would
	// render the unranked caller as first place.
	expect(await res.json()).toEqual({ PlayerId: 205, Score: 0, Rank: 99999 })
})

it('answers GetPlayerRank even when the body is unreadable', async () => {
	const res = await SELF.fetch('https://example.com/leaderboard/GetPlayerRank', {
		method: 'POST',
		body: 'not json',
	})
	// A board that fails to draw is worse than one that draws the player as unranked.
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({ PlayerId: 0, Score: 0, Rank: 99999 })
})

it('answers CheckAndSetStat with a bare 0', async () => {
	const res = await SELF.fetch('https://example.com/leaderboard/CheckAndSetStat', {
		method: 'POST',
		body: JSON.stringify({ StatChannel: 2, RoomId: 14, StatValue: 1, CurrentStatValue: null }),
	})
	expect(res.status).toBe(200)
	// The whole body is the number — not an envelope, not `{ value: 0 }`.
	expect(await res.text()).toBe('0')
})

it('serves an openapi spec with no dangling refs', async () => {
	const res = await SELF.fetch('https://example.com/openapi.json')
	expect(res.status).toBe(200)
	const spec = (await res.json()) as Record<string, unknown>
	expect(Object.keys(spec.paths as object).sort()).toEqual([
		'/',
		'/leaderboard/CheckAndSetStat',
		'/leaderboard/GetNearbyScores',
		'/leaderboard/GetPlayerRank',
		'/leaderboard/GetRanks',
	])
	expect(JSON.stringify(spec).match(/\$ref/g)).toBeNull()
})
