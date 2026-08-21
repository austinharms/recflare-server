import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { logger, withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'

/**
 * Leaderboard Worker. Nothing scores anything here yet — the one route answers the shape
 * the client parses, with no rows in it.
 */
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
	.post('/leaderboard/GetNearbyScores', async (c) => {
		const body = await c.req.text().catch(() => '<unreadable>')
		logger.info('GetNearbyScores', { body })

		const rows: unknown[] = []
		return c.json({ Rows: rows })
	})

export default app
