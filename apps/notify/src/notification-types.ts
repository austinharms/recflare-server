/**
 * The client's `NotificationType` enum — the `Id` carried on a hub notification frame
 * (`{ Id, Msg }`, see {@link NotificationsHub}). The reference server sends these as the
 * notification type so the client's dispatcher can route each frame (e.g. remove a consumed
 * item from inventory on ConsumableMappingRemoved).
 *
 * Mostly integers, but some members are STRINGS, and that is not an inconsistency to tidy
 * up: the reference's hub sends a wire name for those frames (`"AccountUpdate"`,
 * `"RoomUpdate"`, …) even where its own Go enum has a number for them, and the frame's `Id`
 * is stringified as-is — so a member's value is whatever that frame is actually addressed
 * by. Where the two disagree, the wire wins; the number is noted in the member's comment.
 *
 * Lives in the `notify` worker (the hub owner); other workers import it to send a
 * typed notification instead of a magic number. No runtime dependencies, so it's safe
 * to import as a value from another worker's bundle.
 */
export enum NotificationType {
	RelationshipChanged = 1,
	MessageReceived = 2,
	MessageDeleted = 3,
	PresenceHeartbeatResponse = 4,
	RefreshLogin = 5,
	Logout = 6,
	SubscriptionUpdateProfile = 'AccountUpdate',
	/**
	 * The owner-only twin of {@link SubscriptionUpdateProfile}: the same account, rendered
	 * with the private fields (email, birthday, remaining username changes). The reference
	 * sends both on connect and after a profile mutation — everyone gets the public frame,
	 * the owner additionally gets this one. Named after its twin rather than after a client
	 * enum member, since the client's enum doesn't list it; the WIRE name is what matters.
	 */
	SubscriptionUpdateSelfProfile = 'SelfAccountUpdate',
	SubscriptionUpdatePresence = 'PresenceUpdate',
	SubscriptionUpdateGameSession = 'RoomInstanceUpdate',
	/**
	 * A room the player is subscribed to changed. STRING-valued like its neighbours even
	 * though the reference's own enum numbers it `15`: its hub sends the wire name
	 * (`NotifFrame("RoomUpdate", room)`) and never the number, and the payload builder
	 * stringifies whatever it is given, so `15` would go out as the unrelated `"15"`.
	 */
	SubscriptionUpdateRoom = 'RoomUpdate',
	/** Unverified: nothing sends it here, and the reference's hub never puts it on the wire. */
	SubscriptionUpdateRoomPlaylist = 16,
	ModerationQuitGame = 20,
	ModerationUpdateRequired = 21,
	ModerationKick = 22,
	ModerationKickAttemptFailed = 23,
	ModerationRoomBan = 'ModerationRoomBan',
	ServerMaintenance = 25,
	GiftPackageReceived = 30,
	GiftPackageReceivedImmediate = 31,
	GiftPackageRewardSelectionReceived = 32,
	ProfileJuniorStatusUpdate = 40,
	RelationshipsInvalid = 50,
	StorefrontBalanceAdd = 60,
	StorefrontBalanceUpdate = 61,
	StorefrontBalancePurchase = 62,
	ConsumableMappingAdded = 70,
	ConsumableMappingRemoved = 71,
	PlayerEventCreated = 80,
	PlayerEventUpdated = 81,
	PlayerEventDeleted = 82,
	PlayerEventResponseChanged = 83,
	PlayerEventResponseDeleted = 84,
	PlayerEventStateChanged = 85,
	ChatMessageReceived = 'ChatMessageReceived',
	CommunityBoardUpdate = 95,
	CommunityBoardAnnouncementUpdate = 96,
	InventionModerationStateChanged = 100,
	FreeGiftButtonItemsAdded = 110,
	LocalRoomKeyCreated = 120,
	LocalRoomKeyDeleted = 121,
}
