import XCTest
@testable import WakeCheck

// These tests have not been run. They were written without a Swift compiler available.
// Run them in Xcode with Cmd+U and treat any failure as a real finding, in the test or in the code.

// Marked @MainActor so they compile whether or not the app target defaults to main-actor isolation.
@MainActor
final class CoreTests: XCTestCase {
    /// A fixed calendar so results don't depend on where the tests run.
    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/New_York")!
        return c
    }

    private func date(_ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, _ second: Int = 0) -> Date {
        cal.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute, second: second))!
    }

    private func alarm(weekdays: Set<Int> = [], hour: Int = 7, minute: Int = 0) -> WakeAlarm {
        var a = WakeAlarm()
        a.hour = hour
        a.minute = minute
        a.weekdays = weekdays
        a.trackingStart = date(10, 30, 6)
        return a
    }

    // MARK: PhraseMatcher

    func testCurlyAndStraightApostropheMatch() {
        XCTAssertTrue(PhraseMatcher.matches(typed: "I\u{2019}m awake", expected: "I'm awake"))
        XCTAssertTrue(PhraseMatcher.matches(typed: "I'm awake", expected: "I\u{2019}m awake"))
    }

    func testCaseAndExtraSpacesAreIgnored() {
        XCTAssertTrue(PhraseMatcher.matches(typed: "  i'M   AWAKE ", expected: "I'm awake"))
    }

    func testCaseSensitiveWhenAsked() {
        XCTAssertFalse(PhraseMatcher.matches(typed: "i'm awake", expected: "I'm awake", caseSensitive: true))
        XCTAssertTrue(PhraseMatcher.matches(typed: "I'm awake", expected: "I'm awake", caseSensitive: true))
    }

    func testAnythingElseIsAMismatch() {
        XCTAssertFalse(PhraseMatcher.matches(typed: "I'm awak", expected: "I'm awake"))
        XCTAssertFalse(PhraseMatcher.matches(typed: "I am awake", expected: "I'm awake"))
        XCTAssertFalse(PhraseMatcher.matches(typed: "I'm awake.", expected: "I'm awake"))
        XCTAssertFalse(PhraseMatcher.matches(typed: "", expected: "I'm awake"))
    }

    func testEmptyExpectedNeverMatches() {
        XCTAssertFalse(PhraseMatcher.matches(typed: "", expected: ""))
        XCTAssertFalse(PhraseMatcher.matches(typed: "   ", expected: "   "))
    }

    // MARK: WakeAlarm

    func testProblemsAndClamping() {
        var a = WakeAlarm()
        XCTAssertEqual(a.problems, [])
        a.firstPhrase = "   "
        a.secondPhrase = String(repeating: "x", count: 61)
        XCTAssertEqual(a.problems, [.firstPhraseEmpty, .secondPhraseTooLong])

        a.hour = 30
        a.minute = -5
        a.weekdays = [0, 1, 8]
        a.checkInDelayMinutes = 500
        a.reRingEveryMinutes = 0
        a.reRingCount = 99
        let c = a.clamped()
        XCTAssertEqual(c.hour, 23)
        XCTAssertEqual(c.minute, 0)
        XCTAssertEqual(c.weekdays, [1])
        XCTAssertEqual(c.checkInDelayMinutes, 60)
        XCTAssertEqual(c.reRingEveryMinutes, 1)
        XCTAssertEqual(c.reRingCount, 10)
    }

    // MARK: ScheduleMath

    func testOneTimeAlarmHasOneUpcomingRing() {
        let rings = ScheduleMath.upcomingRings(of: alarm(), after: date(10, 30, 8), count: 5, calendar: cal)
        XCTAssertEqual(rings, [date(10, 31, 7)])
    }

    func testWeekdayAlarmSkipsTheWeekend() {
        // Oct 30, 2026 is a Friday. Weekdays 2...6 are Monday...Friday.
        let a = alarm(weekdays: [2, 3, 4, 5, 6])
        let rings = ScheduleMath.upcomingRings(of: a, after: date(10, 30, 8), count: 3, calendar: cal)
        XCTAssertEqual(rings, [date(11, 2, 7), date(11, 3, 7), date(11, 4, 7)])
    }

    func testDisabledAlarmHasNoUpcomingRings() {
        var a = alarm(weekdays: [2])
        a.isEnabled = false
        XCTAssertEqual(ScheduleMath.upcomingRings(of: a, after: date(10, 30), count: 3, calendar: cal), [])
    }

    func testRingsThroughADateIncludeBothEnds() {
        let a = alarm(weekdays: [2, 3, 4, 5, 6])
        let rings = ScheduleMath.rings(of: a, from: date(10, 30, 7), through: date(11, 4, 7), calendar: cal)
        XCTAssertEqual(rings, [date(10, 30, 7), date(11, 2, 7), date(11, 3, 7), date(11, 4, 7)])
    }

    func testDaylightSavingEndKeepsTheLocalTime() {
        // US clocks go back on Sunday Nov 1, 2026, so Oct 31 7:00 to Nov 1 7:00 is 25 hours.
        let a = alarm(weekdays: [1, 2, 3, 4, 5, 6, 7])
        let rings = ScheduleMath.rings(of: a, from: date(10, 31), through: date(11, 2, 12), calendar: cal)
        XCTAssertEqual(rings, [date(10, 31, 7), date(11, 1, 7), date(11, 2, 7)])
        XCTAssertEqual(rings[1].timeIntervalSince(rings[0]), 25 * 3600)
    }

    // MARK: LadderPlanner (defaults: re-ring every 2 min, 4 times; check-in 5 min after the first phrase)

    func testFirstLadder() {
        let main = date(11, 2, 7)
        let a = alarm()
        let ladder = LadderPlanner.firstReRings(mainRing: main, alarm: a)
        XCTAssertEqual(ladder.map { $0.fireDate }, [date(11, 2, 7, 2), date(11, 2, 7, 4), date(11, 2, 7, 6), date(11, 2, 7, 8)])
        XCTAssertEqual(ladder.first?.role, .reRing(1))
        XCTAssertEqual(ladder.last?.role, .reRing(4))
        XCTAssertEqual(LadderPlanner.firstWindowEnd(mainRing: main, alarm: a), date(11, 2, 7, 10))
    }

    func testNoReRingsWhenCountIsZero() {
        var a = alarm()
        a.reRingCount = 0
        XCTAssertEqual(LadderPlanner.firstReRings(mainRing: date(11, 2, 7), alarm: a), [])
        XCTAssertEqual(LadderPlanner.firstWindowEnd(mainRing: date(11, 2, 7), alarm: a), date(11, 2, 7, 2))
    }

    func testCheckInLadderCountsFromTheFirstAnswer() {
        let a = alarm()
        let rings = LadderPlanner.checkInRings(firstAnswerAt: date(11, 2, 7, 1), alarm: a)
        XCTAssertEqual(rings.first?.role, .checkIn)
        XCTAssertEqual(rings.map { $0.fireDate }, [date(11, 2, 7, 6), date(11, 2, 7, 8), date(11, 2, 7, 10), date(11, 2, 7, 12), date(11, 2, 7, 14)])
        XCTAssertEqual(LadderPlanner.checkInWindowEnd(checkInAt: date(11, 2, 7, 6), alarm: a), date(11, 2, 7, 16))
    }

    // MARK: MorningRecord

    func testFirstAnswerWindow() {
        let a = alarm()
        let main = date(11, 2, 7)
        var tooEarly = MorningRecord(alarmID: a.id, mainRing: main)
        XCTAssertFalse(tooEarly.recordFirstAnswer(at: date(11, 2, 6, 59), alarm: a))
        XCTAssertNil(tooEarly.firstAnswerAt)

        var tooLate = MorningRecord(alarmID: a.id, mainRing: main)
        XCTAssertFalse(tooLate.recordFirstAnswer(at: date(11, 2, 7, 10), alarm: a))

        var justInTime = MorningRecord(alarmID: a.id, mainRing: main)
        XCTAssertTrue(justInTime.recordFirstAnswer(at: date(11, 2, 7, 9, 59), alarm: a))
        XCTAssertEqual(justInTime.checkInAt, date(11, 2, 7, 14, 59))
    }

    func testBothAnswersCompleteTheMorning() {
        let a = alarm()
        var r = MorningRecord(alarmID: a.id, mainRing: date(11, 2, 7))
        XCTAssertTrue(r.recordFirstAnswer(at: date(11, 2, 7, 1), alarm: a))
        XCTAssertEqual(r.checkInAt, date(11, 2, 7, 6))
        XCTAssertFalse(r.recordSecondAnswer(at: date(11, 2, 7, 5), alarm: a), "before the check-in is due")
        XCTAssertFalse(r.isComplete)
        XCTAssertTrue(r.recordSecondAnswer(at: date(11, 2, 7, 6, 30), alarm: a))
        XCTAssertTrue(r.isComplete)
        XCTAssertFalse(r.recordFirstAnswer(at: date(11, 2, 7, 7), alarm: a), "already answered")
    }

    func testSecondAnswerAfterItsWindowIsRejected() {
        let a = alarm()
        var r = MorningRecord(alarmID: a.id, mainRing: date(11, 2, 7))
        XCTAssertTrue(r.recordFirstAnswer(at: date(11, 2, 7, 1), alarm: a))
        XCTAssertFalse(r.recordSecondAnswer(at: date(11, 2, 7, 16), alarm: a))
        XCTAssertFalse(r.isComplete)
    }

    // MARK: StreakCalculator

    func testStatusOverTime() {
        let a = alarm()
        let unanswered = MorningRecord(alarmID: a.id, mainRing: date(11, 2, 7))
        XCTAssertEqual(StreakCalculator.status(of: unanswered, alarm: a, now: date(11, 2, 7, 5)), .pending)
        XCTAssertEqual(StreakCalculator.status(of: unanswered, alarm: a, now: date(11, 2, 7, 10)), .missed)

        var half = MorningRecord(alarmID: a.id, mainRing: date(11, 2, 7))
        XCTAssertTrue(half.recordFirstAnswer(at: date(11, 2, 7, 1), alarm: a))
        XCTAssertEqual(StreakCalculator.status(of: half, alarm: a, now: date(11, 2, 7, 15)), .pending)
        XCTAssertEqual(StreakCalculator.status(of: half, alarm: a, now: date(11, 2, 7, 16)), .missed)

        XCTAssertTrue(half.recordSecondAnswer(at: date(11, 2, 7, 7), alarm: a))
        XCTAssertEqual(StreakCalculator.status(of: half, alarm: a, now: date(11, 3)), .complete)
    }

    func testStreaks() {
        let s: [MorningStatus] = [.complete, .complete, .missed, .complete]
        XCTAssertEqual(StreakCalculator.currentStreak(s), 1)
        XCTAssertEqual(StreakCalculator.bestStreak(s), 2)
        XCTAssertEqual(StreakCalculator.totalCompleted(s), 3)
    }

    func testPendingMorningDoesNotBreakOrCountTowardTheStreak() {
        XCTAssertEqual(StreakCalculator.currentStreak([.complete, .complete, .pending]), 2)
        XCTAssertEqual(StreakCalculator.currentStreak([.missed, .pending]), 0)
        XCTAssertEqual(StreakCalculator.currentStreak([]), 0)
        XCTAssertEqual(StreakCalculator.bestStreak([.complete, .pending, .complete]), 2)
    }

    // MARK: MorningLedger

    func testLedgerAddsMissingMorningsOnceAndKeepsExistingOnes() {
        var a = alarm(weekdays: [1, 2, 3, 4, 5, 6, 7])
        a.trackingStart = date(10, 30, 6)
        let now = date(11, 1, 8)

        var existing = MorningRecord(alarmID: a.id, mainRing: date(10, 31, 7))
        XCTAssertTrue(existing.recordFirstAnswer(at: date(10, 31, 7, 1), alarm: a))

        let once = MorningLedger.addingMissing(to: [existing], for: a, now: now, calendar: cal)
        XCTAssertEqual(once.map { $0.mainRing }, [date(10, 30, 7), date(10, 31, 7), date(11, 1, 7)])
        XCTAssertNotNil(once[1].firstAnswerAt, "the existing record is kept, answers and all")

        let twice = MorningLedger.addingMissing(to: once, for: a, now: now, calendar: cal)
        XCTAssertEqual(twice, once)
    }

    func testLedgerIgnoresMorningsBeforeTrackingStarted() {
        var a = alarm(weekdays: [1, 2, 3, 4, 5, 6, 7])
        a.trackingStart = date(11, 1, 9)
        let records = MorningLedger.addingMissing(to: [], for: a, now: date(11, 2, 8), calendar: cal)
        XCTAssertEqual(records, [])
    }
}
