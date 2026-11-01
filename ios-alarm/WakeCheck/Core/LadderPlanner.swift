import Foundation

/// One ring the app will ask iOS to schedule.
struct PlannedRing: Equatable {
    enum Role: Equatable {
        /// The alarm at your wake-up time.
        case main
        /// A repeat of the main alarm, in case you stopped it without typing the phrase. 1 is the first repeat.
        case reRing(Int)
        /// The "are you still awake" alarm.
        case checkIn
        /// A repeat of the check-in. 1 is the first repeat.
        case checkInReRing(Int)
    }

    var role: Role
    var fireDate: Date
}

/// The "ladder": rings that are scheduled ahead of time and only cancelled by typing the phrase.
///
/// Why: iOS's own alarm screen has a Stop button that works without any phrase, and an app
/// can't remove it. So instead of trying to stop you silencing the alarm, the repeats are
/// already on the schedule. Stopping one doesn't cancel the next. Typing the right phrase in
/// the app does.
///
/// Timing (our design, not Apple's): the check-in delay counts from when you typed the first
/// phrase. Each challenge has a window that closes one repeat-interval after its last ring.
/// A phrase typed after that doesn't count.
enum LadderPlanner {
    private static func seconds(_ minutes: Int) -> TimeInterval { TimeInterval(minutes) * 60 }

    /// Repeats of the main alarm, scheduled in advance.
    static func firstReRings(mainRing: Date, alarm: WakeAlarm) -> [PlannedRing] {
        reRings(after: mainRing, alarm: alarm).enumerated().map { PlannedRing(role: .reRing($0.offset + 1), fireDate: $0.element) }
    }

    /// The first phrase must be typed before this moment.
    static func firstWindowEnd(mainRing: Date, alarm: WakeAlarm) -> Date {
        windowEnd(lastStart: mainRing, alarm: alarm)
    }

    /// When the check-in rings, given when the first phrase was typed.
    static func checkInTime(firstAnswerAt: Date, alarm: WakeAlarm) -> Date {
        firstAnswerAt.addingTimeInterval(seconds(alarm.checkInDelayMinutes))
    }

    /// The check-in and its repeats, scheduled when the first phrase is typed.
    static func checkInRings(firstAnswerAt: Date, alarm: WakeAlarm) -> [PlannedRing] {
        let checkIn = checkInTime(firstAnswerAt: firstAnswerAt, alarm: alarm)
        let repeats = reRings(after: checkIn, alarm: alarm).enumerated().map { PlannedRing(role: .checkInReRing($0.offset + 1), fireDate: $0.element) }
        return [PlannedRing(role: .checkIn, fireDate: checkIn)] + repeats
    }

    /// The check-in phrase must be typed before this moment.
    static func checkInWindowEnd(checkInAt: Date, alarm: WakeAlarm) -> Date {
        windowEnd(lastStart: checkInAt, alarm: alarm)
    }

    private static func reRings(after start: Date, alarm: WakeAlarm) -> [Date] {
        guard alarm.reRingCount > 0 else { return [] }
        return (1...alarm.reRingCount).map { start.addingTimeInterval(Double($0) * seconds(alarm.reRingEveryMinutes)) }
    }

    private static func windowEnd(lastStart: Date, alarm: WakeAlarm) -> Date {
        lastStart.addingTimeInterval(Double(alarm.reRingCount + 1) * seconds(alarm.reRingEveryMinutes))
    }
}
