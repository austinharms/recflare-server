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
