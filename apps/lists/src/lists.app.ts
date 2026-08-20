import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getHotRooms } from '@repo/domain'
import { withNotFound, withOnError } from '@repo/hono-helpers'
import { validateAndGetAccountId } from '@repo/jwt'

import { resolveCuratedList, serializeCuratedList } from './curated-lists'

import type { Context } from 'hono'
import type { App } from './context'

/**
 * Resolve the account id from a Bearer token. Returns `null` when the header is missing,
 * the token is invalid, or the `sub` claim isn't an integer.
 */
async function authedId(c: Context<App>): Promise<number | null> {
	return validateAndGetAccountId(c.req.raw, await c.env.JWT_SECRET.get())
}

/** Results.Unauthorized() equivalent — 401 with empty body. */
function unauthorized(c: Context<App>) {
	return c.body(null, 401)
}

/**
 * What the ids in an ALGORITHMIC list are — a BYTE on the client, so only 0–255
 * round-trips. Not the curated lists' `Type`, which names the page a list belongs to
 * (see `CuratedListType` in `curated-lists.ts`); the two are different enums that happen to
 * share a field name.
 *
 * It is what tells the client which service to resolve the ids against, which is why the
 * algorithmic route echoes back the type it was asked for rather than asserting one of its
 * own: a row asked for `Rooms` and handed `Accounts` would look up room ids in the account
 * service and render nothing.
 */
const ListEntityType = {
	Accounts: 0,
	Rooms: 1,
	Inventions: 2,
	CustomAvatarItems: 3,
	PurchasableItems: 4,
	Generic: 5,
	ChipAndPort: 6,
	DiscoverySection: 7,
	DiscoverySectionSubType: 8,
} as const

/** The largest value the client's byte-wide `Type` can carry back. */
const MAX_LIST_ENTITY_TYPE = 255

/**
 * The entities an algorithmic list hands back (`GET /algorithmiclists/:list`) — ROOMS, which
 * is what a Play/Explore row is built from. Nothing ranks anything here yet, so one canned
 * set answers every row: rooms 2–6, the low ids this server's own rooms occupy, so a
 * discovery row resolves to something real instead of five dead ids.
 *
 * `Id` is a STRING even though a room id is a number, and `Context` is where the reference
 * server attributes the ranking/experiment that produced the entity. Nothing produced these,
 * so it is null on every one rather than a made-up context the client would carry into
 * telemetry.
 */
const ALGORITHMIC_LIST_ENTITIES: Array<{ Id: string; Context: string | null }> = [
	'2',
	'3',
	'4',
	'5',
	'6',
].map((Id) => ({ Id, Context: null }))

/**
 * The row key that serves the LIVE hot-room ranking rather than the canned entities — the
 * same feed the rooms worker's `/rooms/hot` answers, which is what a "Hot" row on a
 * discovery page is supposed to show. Matched case-insensitively, since the key reaches us
 * from a curated page's `ItemIds` and its casing is the reference's, not ours.
 */
const HOT_LIST_KEY = 'hotlist'

/** How many rooms the hot row carries. A discovery carousel shows a page, not the world. */
const HOT_LIST_SIZE = 20

/**
 * The feed the hot row is drawn from: `community`, which is the hot ranking with the rooms
 * the Coach account (id 1) created dropped. Those are this server's stock/seeded rooms, and
 * a "Hot" row that is mostly Rec Center is a row about the server rather than about what
 * players are doing. The pseudo-tag is the rooms worker's own — see `getHotRooms` — so the
 * definition of "community" stays in one place.
 */
const HOT_LIST_FEED = 'community'

/**
 * The entity type an algorithmic list reports when the query names none. The client always
 * sends `?type=`, and `Rooms` is what it asks for; falling back to `Accounts` (0, the enum's
 * zero value) would have the row resolve room ids against the account service.
 */
const DEFAULT_ALGORITHMIC_LIST_TYPE = ListEntityType.Rooms

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('hello, world!')
	})

	// Bulk curated-list lookup — the client asks for a set of lists by repeating `?id=`.
	// Nothing curates lists here yet, so this serves one canned list: `ItemIds` are strings
	// (not numbers) and `Description` may be null, but `ImageName` has to be a string — the
	// client's parser reads it straight into a string field. A 404 shows as a failed load
	// instead, so an unknown id still answers 200.
	.get('/curatedlists/bulk', async (c) => {
		return c.json([
			{
				ListId: 17859340,
				CreatorAccountId: 1,
				Name: 'My List',
				Description: null,
				ImageName: '',
				Type: ListEntityType.Rooms,
				ItemIds: ['123', '456'],
				CreatedAt: '2025-07-18T00:00:00Z',
			},
		])
	})

	// The curated list behind a discovery page (`GET /curatedlists`). The client asks with
	// `?creatorAccountId=&type=&name=` and reads back ONE list object — not a collection.
	// `type` is the page asking (`CuratedListType`: the Watch home, the store's Featured tab,
	// …) and dictates the name it asks under, so the two normally agree.
	//
	// Nothing curates lists here, so every list is a static capture in
	// `static/curated-lists.json`. `resolveCuratedList` matches most-specific first and
	// always answers something: a name this server has nothing under falls back to the page's
	// default list rather than 404ing or answering empty, either of which renders as a blank
	// page. That fallback is load-bearing — the store's Featured page asks for its rows by the
	// reference's numeric list id (`name=17859340`), which is nothing's name here.
	//
	// `ItemIds` are the discovery ROWS the page is built from (the section keys the `discovery`
	// worker serves), not room or item ids — the client resolves each one itself.
	.get('/curatedlists', async (c) => {
		// Serialized by hand rather than through `c.json`: the reference's `ListId`s are
		// 64-bit and are carried as strings so their digits survive being parsed — see
		// `serializeCuratedList`, which puts them back on the wire as numbers.
		return c.body(
			serializeCuratedList(
				resolveCuratedList(
					c.req.query('creatorAccountId'),
					c.req.query('type'),
					c.req.query('name')
				)
			),
			200,
			{ 'content-type': 'application/json' }
		)
	})

	// One discovery ROW's contents (`GET /algorithmiclists/:list?type=1`). `:list` is the row
	// key the curated page above lists in its `ItemIds` (e.g.
	// `Rooms_Battle_AlgoEndpoint_PlayHighlight_TabsTest_Explore`), and the answer is the
	// ranked entities that fill it, which the client then resolves by id itself.
	//
	// `HotList` is ranked for real — the same feed the rooms worker's `/rooms/hot` serves.
	// Every other row still serves the canned entities, and an unknown row key gets them too
	// rather than a 404, which the client renders as a row that failed to load. `Type` is
	// echoed back from the query: it tells the client what the `Id`s ARE (rooms, players, …),
	// so answering with a type the caller didn't ask for would have it resolve the ids
	// against the wrong service.
	.get('/algorithmiclists/:list', async (c) => {
		// Echoed, but only when it fits the byte the client reads it back into — anything
		// outside 0–255 can't round-trip, so a nonsense `?type=` gets the default instead of a
		// number that would break the response on the way in.
		const type = Number.parseInt(c.req.query('type') ?? '', 10)
		const echoed = type >= 0 && type <= MAX_LIST_ENTITY_TYPE ? type : DEFAULT_ALGORITHMIC_LIST_TYPE

		// `HotList` is real: it serves the same ranking the rooms worker's `/rooms/hot` feed
		// does — live player count first, then engagement — so the Hot row on a discovery page
		// shows the rooms people are actually in, minus the Coach account's stock rooms (see
		// HOT_LIST_FEED). Only the ids travel; the client resolves each room itself, which is
		// why this reads the ranking and throws the room blobs away.
		if (c.req.param('list').toLowerCase() === HOT_LIST_KEY) {
			const { Results } = await getHotRooms(c.env.DB, HOT_LIST_FEED, 0, HOT_LIST_SIZE)
			return c.json({
				Type: echoed,
				Entities: Results.map((room) => ({ Id: String(room.RoomId), Context: null })),
			})
		}

		return c.json({ Type: echoed, Entities: ALGORITHMIC_LIST_ENTITIES })
	})

	// Contextual features — the client posts the context it's in and reads back whether the
	// call was accepted. Auth-gated, and the answer is a bare `{ success, error_id, error }`
	// with no payload: the reference server acknowledges the post and carries nothing back,
	// so there is nothing here to serve statically beyond the acknowledgement itself. The
	// body is read for the log only.
	.post('/contextualfeatures', async (c) => {
		const id = await authedId(c)
		if (id === null) return unauthorized(c)

		return c.json({ success: true, error_id: null, error: null })
	})

export default app
