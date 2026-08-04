-- Source for ReadingListNotifier.app. Built by tools/build-notifier.sh.
--
-- A notification needs a host app to be attributed to. `osascript` run from a
-- LaunchAgent has none, so macOS accepts the call and silently drops the
-- banner. This applet is that host: it gets its own bundle identifier, its own
-- entry in System Settings > Notifications, and posts reliably from launchd.
--
-- The message arrives through a file rather than arguments — an applet opened
-- with `open --args` does not receive them dependably.

on run
	set payloadPath to (POSIX path of (path to home folder)) & "Library/Application Support/reading-list/notification.txt"
	try
		set payload to read (POSIX file payloadPath) as «class utf8»
	on error
		return
	end try
	set theLines to paragraphs of payload
	if (count of theLines) < 2 then return
	display notification (item 2 of theLines) with title (item 1 of theLines)
end run
