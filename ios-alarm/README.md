# WakeCheck (working name): an alarm that checks you're really awake

Status: **Step 1 of 4, written but not compiled or run.** The environment this was written in has no Swift
compiler and no Xcode, so nothing here has been built or tested. The unit tests in `WakeCheckTests` are
the first thing to run (Cmd+U in Xcode). Treat a failing test as a real finding.

## What Apple's alarm API does and doesn't give us

Everything in this section comes from Apple's AlarmKit pages (developer.apple.com/documentation/alarmkit,
the "Scheduling an alarm with AlarmKit" article, and WWDC25 session 230), read on 2026-10-30.

| Fact | Source says |
| --- | --- |
| Needs iOS 26 or later, built with Xcode 26 | every AlarmKit symbol page lists iOS 26.0+ |
| Rings with the app closed | alarms are scheduled with the system, not the app |
| Breaks through Silent mode and Focus | "It overrides both a device's focus and silent mode, if necessary." |
| Needs the person's permission | no permission, no alarm: "any alarm created by the app isn't scheduled and subsequently doesn't alert" |
| Needs `NSAlarmKitUsageDescription` in Info.plist | missing or empty means "apps can't schedule alarms with AlarmKit" |
| The alerting screen has a Stop button handled by the system | "the AlarmManager automatically handles stop or countdown functionalities, depending on the button type". The docs show no way to require anything before Stop works. |
| The app can add one extra button that opens the app | secondary button with `.custom` behaviour is an "Open" action; its intent is "only available after first unlock" |
| Weekly repeats | `Alarm.Schedule.relative(.init(time:, repeats: .weekly([Locale.Weekday])))`, follows the phone's time zone |
| One-off alarm at a fixed moment | `Alarm.Schedule.fixed(Date)` |
| Cancel / stop / list | `AlarmManager.shared.cancel(id:)`, `.stop(id:)`, `.alarms`, `.alarmUpdates` |
| Custom sound | a file in the app bundle or `Library/Sounds`, passed as `AlertConfiguration.AlertSound`; otherwise the system default |
| Widget extension | needed only when the alarm uses a countdown presentation. We don't use one. |

### What iOS will not let this app do

- **It cannot require a phrase to silence the alarm.** The system handles the Stop button and I found no way in
  Apple's docs to put a condition on it. So this design assumes Stop can be tapped without typing anything.
- It cannot stop you from switching the app's alarm permission off in Settings, deleting the app, powering the
  phone off, or changing the alarm inside the app.
- It cannot choose from your Clock-app ringtones. Apple documents only the default sound and sound files
  bundled inside the app. (I found nothing saying otherwise. That's not proof it's impossible.)
- It does not work on iOS 25 or earlier.

### Not found in the docs, so unknown until tested on a real iPhone

- Whether there is a limit on how many alarms one app can schedule. None is documented. The design below uses
  a small number on purpose, and Step 2 includes a test for it.
- Whether the alarm keeps sounding after the secondary button opens the app (so the app may need to call `stop(id:)`).
- What the secondary button does on a locked phone. Apple says the intent is "only available after first
  unlock". Expect an unlock prompt, but that is unverified.
- How loud the alarm is relative to the phone's volume setting.
- A community forum report says a custom stop or secondary intent can leave the Dynamic Island blank on iOS 26.
  That's a report, not Apple guidance.

## Architecture

```
iOS (owns the ringing)                      The app (owns the check-in)
-------------------------------             --------------------------------------------
AlarmKit alarms, scheduled ahead   <------  AlarmScheduler (Step 2)  plans rings with LadderPlanner
  rings with the app closed                 Core: WakeAlarm, ScheduleMath, LadderPlanner,
  Stop button (we can't remove it)                MorningRecord, StreakCalculator, PhraseMatcher  (Step 1)
  secondary button "Type to dismiss" ---->  OpenChallengeIntent opens the app (Step 2)
                                            SwiftUI: Home, Alarm editor, Challenge, Streak (Steps 3-4)
```

**Core (Step 1, pure Foundation, testable):**
`WakeAlarm` (a configured alarm), `PhraseMatcher` (typed text vs phrase), `ScheduleMath` (when the main alarm rings),
`LadderPlanner` (which follow-up rings to schedule), `MorningRecord` + `StreakCalculator` + `MorningLedger` (what happened each morning, streaks).

**The "ladder" is how the check-in stays reliable.** Because Stop always works, the app doesn't try to fight it.
Instead the follow-ups are scheduled in advance and only typing the right phrase in the app cancels them.

A morning with the default settings (7:00 alarm, repeat every 2 min up to 4 times, check-in 5 min after you answer):

1. 7:00 main alarm rings. Repeats are already scheduled for 7:02, 7:04, 7:06, 7:08.
2. You open the app (secondary button, or by hand) and type the first phrase, say at 7:01.
   The app cancels the 7:02 to 7:08 repeats and schedules the check-in for 7:06, with its own repeats at 7:08 to 7:14.
3. If you stop the alarm and go back to sleep instead, the 7:02 repeat rings anyway. The first window closes at 7:10.
   A first phrase typed after that doesn't count and the morning is recorded as missed.
4. At 7:06 the check-in rings. You type the second phrase before 7:16. Both done: the morning counts toward the streak.

Design choices that are mine, not Apple's, and can be changed: the check-in delay counts from when you typed
the first phrase; a window closes one repeat-interval after its last ring; the limits in `WakeAlarm`
(delay 1 to 60 min, repeats every 1 to 10 min, 0 to 10 repeats, phrases up to 60 characters).

**Recurring alarms.** The main alarm is a weekly repeating AlarmKit alarm, so it keeps ringing even if you never open the
app again. The follow-ups are one-off alarms scheduled a few mornings ahead and topped up each time the app opens
(Step 2). If you don't open the app for longer than that window, those mornings still ring the main alarm but
have no check-in until you open the app again.

**Streak.** Counted over mornings the alarm was scheduled to ring. A day with no alarm doesn't break it. A morning in progress
neither counts nor breaks it. A missed one resets it. Turning an alarm back on starts tracking from that moment.

**Typing the phrase.** The iPhone keyboard turns `'` into `’`. `PhraseMatcher` treats both as the same, ignores extra
spaces and capital letters (capital letters can be made strict), and accepts nothing else.

## Setup for Step 1 (needs a Mac with Xcode 26)

1. In Xcode: File > New > Project > iOS > App. Name `WakeCheck`, Interface SwiftUI, Language Swift, tests with XCTest.
   Set the minimum deployment to iOS 26.0.
2. Drag `WakeCheck/Core` into the app target. Drag `WakeCheckTests/CoreTests.swift` into the test target.
3. Run the tests with Cmd+U. Send me every failure or compiler error word for word.

Installing on a real iPhone: a free Apple ID works for testing but Apple documents that the install lapses after
7 days and must be rebuilt, which is a real problem for an alarm you depend on. The paid Apple Developer Program
removes that. That would be a purchase, so it needs your approval first. I haven't bought or enrolled in anything.

## Next steps

2. AlarmKit layer: permission request, `NSAlarmKitUsageDescription`, scheduling the main alarm and follow-ups, cancelling them, the open-the-app button, and the on-device tests listed above.
3. Screens: home with next alarm and streak, alarm editor (time, days, both phrases, delay, sound), challenge screen.
4. Streak and history screen, dark appearance polish, sound picker from bundled sounds.
