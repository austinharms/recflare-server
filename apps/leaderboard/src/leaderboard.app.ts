import { Hono } from 'hono'
import { describeRoute, openAPIRouteHandler } from 'hono-openapi'
import { useWorkersLogger } from 'workers-tagged-logger'

import { logger, withCleanSpec, withNotFound, withOnError } from '@repo/hono-helpers'

import {
	CheckAndSetStatBody,
	CheckAndSetStatResponse,
	GetNearbyScoresBody,
	GetPlayerRankBody,
	GetRanksBody,
	json,
	jsonBody,
	LeaderboardRows,
	PlayerRank,
} from './openapi'

import type { App } from './context'

/**
 * Leaderboard Worker. Nothing scores anything here yet — the routes answer the shape the
 * client parses, with no rows, no rank and no stored stats behind them.
 */

/**
 * The rank a player who isn't on the board gets. Nothing is scored here, so every caller is
 * unranked — but "unranked" has to be said in the client's own vocabulary, and `Rank` is
 * 1-based: a 0 would render as first place and a negative one may not render at all. A
 * number far past the end of any real board reads as last, which is what an unscored player
 * is, and is recognisable in a log or a screenshot as a sentinel rather than a real standing.
 */
const UNRANKED = 99999

/**
 * The score behind {@link UNRANKED}. Zero rather than a second sentinel: no stat has ever
 * been stored, and 0 is what "no score" means in the client's own units.
 */
const NO_SCORE = 0

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

	.get(
		'/',
		describeRoute({
			tags: ['Service'],
			summary: 'Health check',
			description:
				'Liveness probe for the leaderboard worker. Answers `text/plain`, not JSON, unlike the other workers’ health checks. No auth.',
			responses: {
				200: {
					description: 'Service is up',
					content: { 'text/plain': { schema: { type: 'string' } } },
				},
			},
		}),
		async (c) => {
			return c.text('hello, world!')
		}
	)

	// The scores around a player — what the client shows when it opens a leaderboard on
	// someone rather than at the top. Answers `{ Rows: [...] }`; an EMPTY `Rows` is a
	// complete answer meaning "this leaderboard has no scores", which the client renders as
	// a blank board instead of failing. The key must be present — a bare `{}` trips its
	// parser.
	//
	// Nothing is ranked or stored yet, so the request body is ignored. It IS logged: the
	// body's shape hasn't been recovered from the client, and this route is how it gets
	// watched. Read it as text — the shape is unknown, so parsing it would only invent one —
	// and never fail on it, since an unreadable body must not cost the client its board.
	.post(
		'/leaderboard/GetNearbyScores',
		describeRoute({
			tags: ['Leaderboard'],
			summary: 'The scores around a player',
			description: [
				'What the client shows when it opens a leaderboard ON someone rather than at the top.',
				'',
				'Nothing is scored or stored on this server yet, so `Rows` is always empty — a complete',
				'answer meaning "this leaderboard has no scores", which the client renders as a blank',
				'board rather than failing. The key is always present; a bare `{}` trips its parser.',
				'',
				'The request body is IGNORED, and logged rather than parsed: its shape has not been',
				'recovered from the client, so this route is how it gets watched. An unreadable body is',
				'not an error either — it must not cost the client its board.',
			].join(' '),
			requestBody: jsonBody(GetNearbyScoresBody, 'Ignored and logged; shape not yet recovered'),
			responses: { 200: json(LeaderboardRows, 'The board, always with no rows') },
		}),
		async (c) => {
			const body = await c.req.text().catch(() => '<unreadable>')
			logger.info('GetNearbyScores', { body })

			const rows: unknown[] = []
			return c.json({ Rows: rows })
		}
	)

	// A page of the board itself — what the client shows when it opens a leaderboard at the
	// top rather than on a player. The body names the slice (`RankStart`/`RankEnd`, both
	// inclusive), the board (`RoomId` + `StatChannel`), the viewer (`PlayerId`) and the
	// ordering (`FilterType`, `SortAscending`).
	//
	// Same answer and same rules as GetNearbyScores: `{ Rows: [...] }`, where an EMPTY
	// `Rows` is a complete answer meaning "this leaderboard has no scores" and the key must
	// be present. Nothing is ranked or stored yet, so the body is ignored — only logged, and
	// read as text so an unreadable body can never cost the client its board.
	.post(
		'/leaderboard/GetRanks',
		describeRoute({
			tags: ['Leaderboard'],
			summary: 'A page of the board',
			description: [
				'What the client shows when it opens a leaderboard at the TOP rather than on a player.',
				'The body names the slice (`RankStart`/`RankEnd`, both inclusive), the board (`RoomId`',
				'plus `StatChannel`), the viewer (`PlayerId`) and the ordering (`FilterType`,',
				'`SortAscending`).',
				'',
				'Answers exactly what `GetNearbyScores` answers, under the same rules: `Rows` is always',
				'empty because nothing is scored or stored here yet, and the key is always present.',
				'',
				'The body is IGNORED — it is logged, not parsed — so the fields are documented as the',
				'record of what the client asks for rather than as anything the handler reads.',
			].join(' '),
			requestBody: jsonBody(GetRanksBody, 'The slice and board the client is asking for'),
			responses: { 200: json(LeaderboardRows, 'The board, always with no rows') },
		}),
		async (c) => {
			const body = await c.req.text().catch(() => '<unreadable>')
			logger.info('GetRanks', { body })

			const rows: unknown[] = []
			return c.json({ Rows: rows })
		}
	)

	// One player's standing, rather than a page of the board — what the client asks when it
	// needs to show "you: #17" next to a leaderboard. The body names the player and the board
	// (`RoomId` + `StatChannel` + `FilterType`, where FilterType is Global 0 / Friends 1).
	//
	// The answer is three fields — `{ PlayerId, Score, Rank }` — and notably does NOT echo the
	// board back, so the client pairs the answer with its question itself. `PlayerId` is
	// therefore the one field read out of the body: answering with a different player's id
	// would be answering a question nobody asked.
	//
	// Nothing is scored here, so every caller is unranked and gets {@link UNRANKED} with a
	// zero score. A body that can't be read still gets an answer — a board that fails to draw
	// is worse than one that draws the player as unranked — so `PlayerId` falls back to 0.
	.post(
		'/leaderboard/GetPlayerRank',
		describeRoute({
			tags: ['Leaderboard'],
			summary: 'One player’s rank',
			description: [
				'What the client asks when it needs a single player’s standing rather than a page of',
				'the board — the body names the player and the board (`RoomId` + `StatChannel` +',
				'`FilterType`: Global 0, Friends 1).',
				'',
				'Nothing is scored or stored on this server yet, so the answer is always the same:',
				`\`Rank\` ${UNRANKED}, a sentinel meaning unranked (ranks are 1-based, so a 0 would`,
				'render as first place), and `Score` 0.',
				'',
				'`PlayerId` is echoed from the request and is the only field read out of it — the',
				'response carries no board selectors, so the client matches the answer to its own',
				'question. An unreadable body is answered rather than rejected, with a `PlayerId` of 0.',
			].join(' '),
			requestBody: jsonBody(GetPlayerRankBody, 'The player and the board being asked about'),
			responses: { 200: json(PlayerRank, 'The player’s standing — always unranked') },
		}),
		async (c) => {
			const body = await c.req
				.json<{ PlayerId?: number }>()
				.catch(() => ({}) as { PlayerId?: number })
			logger.info('GetPlayerRank', { body })

			return c.json({ PlayerId: body.PlayerId ?? 0, Score: NO_SCORE, Rank: UNRANKED })
		}
	)

	// A stat write: the client posts the value it wants stored for a room's stat channel,
	// along with `CurrentStatValue` — what it believes is stored now, null when it believes
	// nothing is. That pairing makes it a compare-and-set rather than a plain write, which is
	// how a room's high-score board avoids being walked backwards by a stale client. There is
	// no `PlayerId`: the stat belongs to whoever is calling.
	//
	// Nothing is stored yet, so the write is accepted and dropped. The answer is a BARE `0` —
	// not an envelope, not `{ value: 0 }` — which is what the live service returns and so what
	// the client's parser expects. The body is logged, not read.
	.post(
		'/leaderboard/CheckAndSetStat',
		describeRoute({
			tags: ['Leaderboard'],
			summary: 'Write a player’s stat',
			description: [
				'A compare-and-set on one of a room’s tracked stats: `StatValue` is what the client',
				'wants stored, `CurrentStatValue` what it believes is stored now (null when it believes',
				'nothing is). No `PlayerId` — the stat belongs to the caller.',
				'',
				'Nothing is stored on this server yet, so the write is accepted and dropped. The',
				'response is the BARE number `0`, not an envelope and not a `{ value }` wrapper — what',
				'the live service answers, and what the client’s parser expects.',
				'',
				'The body is IGNORED and logged, which is how these shapes get recovered from a live',
				'client.',
			].join(' '),
			requestBody: jsonBody(CheckAndSetStatBody, 'The stat, the room and the value to store'),
			responses: { 200: json(CheckAndSetStatResponse, 'Always the bare number 0') },
		}),
		async (c) => {
			const body = await c.req.text().catch(() => '<unreadable>')
			logger.info('CheckAndSetStat', { body })

			return c.json(0)
		}
	)

// The generated spec. Documentation only — no request is validated against it (see
// openapi.ts). `hide: true` keeps this route out of its own output.
app.get(
	'/openapi.json',
	describeRoute({ hide: true }),
	withCleanSpec(
		openAPIRouteHandler(app, {
			documentation: {
				info: {
					title: 'recflare leaderboard',
					version: '1.0.0',
					description: [
						'Leaderboards for recflare, a private-server reimplementation of the Rec Room',
						'backend — the boards a room keeps for the stats it tracks.',
						'',
						'NOTHING IS SCORED HERE YET, and every route answers accordingly rather than',
						'failing: the two board reads answer `{ "Rows": [] }`, an empty list being a',
						'complete answer meaning "this leaderboard has no scores" (the `Rows` key is always',
						'present — a bare `{}` trips the client’s parser); `GetPlayerRank` answers a rank of',
						'99999, the sentinel for unranked, with a score of 0; and `CheckAndSetStat` accepts',
						'a stat write, drops it, and answers the bare number `0`.',
						'',
						'Only `GetPlayerRank` reads anything out of its request body, and only the',
						'`PlayerId` it echoes back. Every route logs the body verbatim, which is how these',
						'shapes get recovered from a live client; `GetNearbyScores`’ body is still unknown',
						'for exactly that reason. No route needs a token today.',
					].join('\n'),
				},
				servers: [{ url: 'https://leaderboard.recflare.net', description: 'Production' }],
			},
		})
	)
)

export default app
