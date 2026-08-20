import curatedLists from '../static/curated-lists.json'

/**
 * Which PAGE a curated list belongs to — the `Type` on the list and the `?type=` the client
 * asks with. Not to be confused with the entity-type enum the algorithmic lists echo: this
 * one names a page source (the Watch home, the store's Featured tab, …), and the list it
 * keys is that page's row set.
 *
 * `None` is the client's unset sentinel; it never reaches the wire, and nothing is captured
 * under it.
 */
export const CuratedListType = {
	WatchHome: 0,
	PlayHighlight: 1,
	CommunityBoard: 2,
	MobileHome: 3,
	StoreFeatured: 4,
	StoreClothing: 5,
	StoreConsumables: 6,
	PlayCategories: 7,
	StoreInventions: 8,
	TitleScreen: 9,
	PlayMenuTabs: 10,
	OrientationStoreFeatured: 11,
	AppNavPortalPanel: 12,
	WWPanelList: 13,
	RecRoomPlusBenefits: 14,
	RecCenterStorefront: 15,
	RecCenterCommunityContent: 16,
	None: 999,
} as const

/**
 * One curated list as the client parses it. `Description` may be null but `ImageName` must
 * be a STRING — the client reads it straight into a string field — and `ItemIds` are
 * strings even where they stand for numeric ids.
 *
 * `ListId` is a string HERE ONLY, and never reaches the client as one: see
 * `serializeCuratedList`. `Accessibility` rides along from the captures untouched.
 */
export interface CuratedList {
	ListId: string
	CreatorAccountId: number
	Name: string
	Description: string | null
	ImageName: string
	Type: number
	ItemIds: string[]
	Accessibility?: number
	CreatedAt: string
}

/**
 * Every list this server serves, all of them in `static/curated-lists.json` — drop a
 * capture into that array and it is served; nothing else needs editing. (One file per list
 * would read better, but wrangler bundles with esbuild, which has no glob import: a
 * directory can only be picked up by naming every file in an `import`. `import.meta.glob`
 * is a Vite feature — vitest runs through Vite and would resolve it, while the deployed
 * build ships the call verbatim and throws at runtime, so tests would pass and the worker
 * would not.)
 *
 * Nothing curates lists here, so these are static captures; ORDER matters only in that the
 * first list of a given type is that page's default (see `BY_TYPE`).
 *
 * `ItemIds` are the discovery ROWS each page is built from (the section keys the `discovery`
 * worker serves under `/sections/pagesource/*`), not room or item ids: the client resolves
 * each row itself.
 */
const CURATED_LISTS: CuratedList[] = curatedLists

/**
 * A list's `ListId` is the reference's own, and those are 64-bit
 * (`624765592684307326`) — past what a JS number holds exactly, so parsing one rounds it
 * (…307326 → …307300). The captures therefore carry it as a STRING, which survives the
 * round trip, and this puts the digits back on the wire unquoted: the client's field is a
 * number, and a quoted id fails its parser.
 *
 * Only a run of digits is unquoted, so a malformed id is left alone rather than corrupting
 * the JSON — the integration tests assert every capture has one.
 */
export function serializeCuratedList(list: CuratedList): string {
	return JSON.stringify(list).replace(/"ListId":"(\d+)"/, '"ListId":$1')
}

/** Names are matched case-insensitively — the casing that reaches us is the client's. */
function nameKey(name: string): string {
	return name.toLowerCase()
}

/** All three keys the query carries. The most specific match wins. */
const BY_CREATOR_TYPE_NAME = new Map<string, CuratedList>()
/** Same list without the creator — the client sometimes asks with a creator nothing owns. */
const BY_TYPE_NAME = new Map<string, CuratedList>()
/** By name alone, for a name whose `type` doesn't line up with what it is captured under. */
const BY_NAME = new Map<string, CuratedList>()
/**
 * By type alone: the page's DEFAULT list, which is what answers a `name` this server has
 * nothing under — the store's Featured page, for one, asks for its rows by the reference's
 * numeric list id (`name=17859340`) rather than by a name.
 */
const BY_TYPE = new Map<number, CuratedList>()

for (const list of CURATED_LISTS) {
	const name = nameKey(list.Name)
	BY_CREATOR_TYPE_NAME.set(`${list.CreatorAccountId}/${list.Type}/${name}`, list)
	if (!BY_TYPE_NAME.has(`${list.Type}/${name}`)) BY_TYPE_NAME.set(`${list.Type}/${name}`, list)
	if (!BY_NAME.has(name)) BY_NAME.set(name, list)
	// First captured wins, so a page with more than one list defaults to whichever sits
	// earliest in `static/curated-lists.json`.
	if (!BY_TYPE.has(list.Type)) BY_TYPE.set(list.Type, list)
}

/**
 * What a request that matches nothing at all gets: the Play menu's Explore panel. An empty
 * body — or a 404 — renders as a blank page rather than an error, so answering with
 * SOMETHING is the better failure, and it is what the reference was observed doing for a
 * list it had nothing under. Falls back to whatever sits first if that capture is ever
 * dropped from the array.
 */
const DEFAULT_CURATED_LIST =
	BY_NAME.get(nameKey('Discovery.PageSource.PlayExplore')) ?? CURATED_LISTS[0]

/**
 * The list behind `GET /curatedlists?creatorAccountId=&type=&name=`, resolved most-specific
 * first and never empty. `type` is the page asking (see `CuratedListType`) and dictates the
 * name, so the two normally agree; when they don't, the page's default list still answers.
 */
export function resolveCuratedList(
	creatorAccountId: string | undefined,
	type: string | undefined,
	name: string | undefined
): CuratedList {
	const key = nameKey(name ?? '')
	const parsedType = Number.parseInt(type ?? '', 10)
	const hasType = Number.isInteger(parsedType)

	return (
		(hasType ? BY_CREATOR_TYPE_NAME.get(`${creatorAccountId}/${parsedType}/${key}`) : undefined) ??
		(hasType ? BY_TYPE_NAME.get(`${parsedType}/${key}`) : undefined) ??
		BY_NAME.get(key) ??
		(hasType ? BY_TYPE.get(parsedType) : undefined) ??
		DEFAULT_CURATED_LIST
	)
}
