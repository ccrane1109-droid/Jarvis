import Foundation

/// When an alarm's main ring happens. Pure date arithmetic, no AlarmKit.
/// Uses the Calendar passed in (default: the phone's current calendar and time zone), so
/// clock changes at daylight saving time are handled by Foundation, not by us.
enum ScheduleMath {
    /// The first main ring strictly after `date`, ignoring whether the alarm is switched on.
    static func nextRing(of alarm: WakeAlarm, after date: Date, calendar: Calendar = .current) -> Date? {
        let base = DateComponents(hour: alarm.hour, minute: alarm.minute, second: 0)
        if alarm.weekdays.isEmpty {
            return calendar.nextDate(after: date, matching: base, matchingPolicy: .nextTime)
        }
        return alarm.weekdays.compactMap { weekday -> Date? in
            var parts = base
            parts.weekday = weekday
            return calendar.nextDate(after: date, matching: parts, matchingPolicy: .nextTime)
        }.min()
    }

    /// The next `count` main rings after `date`. Empty if the alarm is off.
    /// A one-time alarm (no weekdays) has just one.
    static func upcomingRings(of alarm: WakeAlarm, after date: Date, count: Int, calendar: Calendar = .current) -> [Date] {
        guard alarm.isEnabled, count > 0 else { return [] }
        let wanted = alarm.weekdays.isEmpty ? 1 : count
        var found: [Date] = []
        var cursor = date
        while found.count < wanted, let next = nextRing(of: alarm, after: cursor, calendar: calendar) {
            found.append(next)
            cursor = next
        }
        return found
    }

    /// Every main ring from `start` through `end` (both included), oldest first.
    /// Used to work out which past mornings should have a record. `limit` stops a runaway loop.
    static func rings(of alarm: WakeAlarm, from start: Date, through end: Date, calendar: Calendar = .current, limit: Int = 400) -> [Date] {
        var found: [Date] = []
        var cursor = start.addingTimeInterval(-1)
        while found.count < limit, let next = nextRing(of: alarm, after: cursor, calendar: calendar), next <= end {
            found.append(next)
            if alarm.weekdays.isEmpty { break }
            cursor = next
        }
        return found
    }
}
