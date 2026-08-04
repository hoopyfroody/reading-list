#!/bin/zsh
# Builds ReadingListNotifier.app from notifier.applescript.
#
# The .app is not committed — it is a build product. Run this once after a
# fresh clone, then allow "ReadingListNotifier" in System Settings >
# Notifications.
set -eu

HERE="${0:A:h}"
APP="$HERE/ReadingListNotifier.app"

rm -rf "$APP"
osacompile -o "$APP" "$HERE/notifier.applescript"

# LSUIElement keeps it out of the Dock — this runs every morning and should not
# bounce an icon. The bundle identifier is what System Settings lists it under.
plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string nl.hoopyfroody.ReadingListNotifier "$APP/Contents/Info.plist"
plutil -replace CFBundleName -string ReadingListNotifier "$APP/Contents/Info.plist"

# Ad-hoc signature: an unsigned bundle whose Info.plist was edited after the
# fact can be refused at launch.
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

print -r -- "Built $APP"
