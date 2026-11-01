import Foundation

/// What happened on one scheduled morning of one alarm.
struct MorningRecord: Codable, Equatable, Identifiable {
    var alarmID: UUID
    /// When the main alarm was due. Together with `alarmID` this identifies the morning.
    var mainRing: Date
    var firstAnswerAt: Date?
    /// When the check-in is due. Set when the first phrase is accepted.
    var checkInAt: Date?
    var secondAnswerAt: Date?

    var id: String { "\(alarmID.uuidString)@\(Int(mainRing.timeIntervalSince1970))" }
    var isComplete: Bool { firstAnswerAt != nil && secondAnswerAt != nil }

    /// Accepts the first phrase if it's typed during the first window. Returns false and changes nothing otherwise.
    mutating func recordFirstAnswer(at time: Date, alarm: WakeAlarm) -> Bool {
        guard firstAnswerAt == nil,
              time >= mainRing,
              time < LadderPlanner.firstWindowEnd(mainRing: mainRing, alarm: alarm) else { return false }
        firstAnswerAt = time
        checkInAt = LadderPlanner.checkInTime(firstAnswerAt: time, alarm: alarm)
        return true
    }

    /// Accepts the check-in phrase if it's typed during the check-in window. Returns false and changes nothing otherwise.
    mutating func recordSecondAnswer(at time: Date, alarm: WakeAlarm) -> Bool {
        guard let checkIn = checkInAt,
              secondAnswerAt == nil,
              time >= checkIn,
              time < LadderPlanner.checkInWindowEnd(checkInAt: checkIn, alarm: alarm) else { return false }
        secondAnswerAt = time
        return true
    }
}

enum MorningStatus: Equatable {
    /// Both phrases typed in time.
    case complete
    /// A window closed before the phrase was typed, or the alarm was never answered.
    case missed
    /// Not finished yet, and there's still time.
    case pending
}

enum StreakCalculator {
    static func status(of record: MorningRecord, alarm: WakeAlarm, now: Date) -> MorningStatus {
        if record.isComplete { return .complete }
        let deadline: Date
        if let first = record.firstAnswerAt {
            let checkIn = record.checkInAt ?? LadderPlanner.checkInTime(firstAnswerAt: first, alarm: alarm)
            deadline = LadderPlanner.checkInWindowEnd(checkInAt: checkIn, alarm: alarm)
        } else {
            deadline = LadderPlanner.firstWindowEnd(mainRing: record.mainRing, alarm: alarm)
        }
        return now < deadline ? .pending : .missed
    }

    /// Consecutive completed mornings, newest back. `statuses` is oldest first.
    /// A morning still in progress is skipped, since it can still go either way. A missed one ends the streak.
    /// Days the alarm wasn't scheduled to ring never appear here, so they don't break it.
    static func currentStreak(_ statuses: [MorningStatus]) -> Int {
        var count = 0
        for status in statuses.reversed() {
            switch status {
            case .pending: continue
            case .complete: count += 1
            case .missed: return count
            }
        }
        return count
    }

    static func bestStreak(_ statuses: [MorningStatus]) -> Int {
        var best = 0
        var run = 0
        for status in statuses {
            switch status {
            case .complete:
                run += 1
                best = max(best, run)
            case .missed:
                run = 0
            case .pending:
                break
            }
        }
        return best
    }

    static func totalCompleted(_ statuses: [MorningStatus]) -> Int {
        statuses.filter { $0 == .complete }.count
    }
}

enum MorningLedger {
    /// Adds a record for every morning the alarm should have rung (from when it started being
    /// tracked until `now`) that has none yet. Run it when the app opens, and before an alarm is
    /// edited or turned off, so past mornings are judged by the settings they actually had.
    static func addingMissing(to records: [MorningRecord], for alarm: WakeAlarm, now: Date, calendar: Calendar = .current) -> [MorningRecord] {
        let have = Set(records.filter { $0.alarmID == alarm.id }.map { $0.mainRing })
        var result = records
        for ring in ScheduleMath.rings(of: alarm, from: alarm.trackingStart, through: now, calendar: calendar) where !have.contains(ring) {
            result.append(MorningRecord(alarmID: alarm.id, mainRing: ring))
        }
        return result.sorted { $0.mainRing < $1.mainRing }
    }
}
