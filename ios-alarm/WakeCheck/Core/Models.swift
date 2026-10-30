import Foundation

/// An alarm the user has set up, with its two phrases and timing.
struct WakeAlarm: Codable, Identifiable, Equatable {
    var id = UUID()
    var label = "Wake up"
    var hour = 7
    var minute = 0
    /// Calendar weekday numbers the alarm repeats on (1 = Sunday ... 7 = Saturday).
    /// Empty means it rings once, at the next occurrence of the time.
    var weekdays: Set<Int> = []
    var firstPhrase = "I'm awake"
    var secondPhrase = "I'm still awake"
    /// Minutes between typing the first phrase and the check-in ringing.
    var checkInDelayMinutes = 5
    /// If an alarm is stopped without typing its phrase, it rings again this many minutes later...
    var reRingEveryMinutes = 2
    /// ...this many more times. 0 means no re-rings.
    var reRingCount = 4
    /// Name of a sound file in the app bundle, or nil for the system default sound.
    var soundName: String?
    var isEnabled = true
    /// When this alarm started being tracked. Mornings before this never count toward the streak.
    /// Set it to "now" whenever the alarm is turned back on.
    var trackingStart = Date()
}

extension WakeAlarm {
    // These limits are this app's choices, not Apple's.
    static let delayRange = 1...60
    static let reRingEveryRange = 1...10
    static let reRingCountRange = 0...10
    static let phraseMaxLength = 60

    enum Problem: Equatable {
        case firstPhraseEmpty
        case secondPhraseEmpty
        case firstPhraseTooLong
        case secondPhraseTooLong

        var message: String {
            switch self {
            case .firstPhraseEmpty: return "The first phrase can't be empty."
            case .secondPhraseEmpty: return "The check-in phrase can't be empty."
            case .firstPhraseTooLong: return "The first phrase is too long to type half asleep (\(WakeAlarm.phraseMaxLength) characters at most)."
            case .secondPhraseTooLong: return "The check-in phrase is too long to type half asleep (\(WakeAlarm.phraseMaxLength) characters at most)."
            }
        }
    }

    /// Reasons this alarm shouldn't be saved yet. Empty means it's fine.
    var problems: [Problem] {
        var found: [Problem] = []
        let first = PhraseMatcher.normalize(firstPhrase)
        let second = PhraseMatcher.normalize(secondPhrase)
        if first.isEmpty { found.append(.firstPhraseEmpty) } else if first.count > Self.phraseMaxLength { found.append(.firstPhraseTooLong) }
        if second.isEmpty { found.append(.secondPhraseEmpty) } else if second.count > Self.phraseMaxLength { found.append(.secondPhraseTooLong) }
        return found
    }

    /// A copy with every number forced into its allowed range.
    func clamped() -> WakeAlarm {
        var copy = self
        copy.hour = min(max(hour, 0), 23)
        copy.minute = min(max(minute, 0), 59)
        copy.weekdays = weekdays.filter { (1...7).contains($0) }
        copy.checkInDelayMinutes = min(max(checkInDelayMinutes, Self.delayRange.lowerBound), Self.delayRange.upperBound)
        copy.reRingEveryMinutes = min(max(reRingEveryMinutes, Self.reRingEveryRange.lowerBound), Self.reRingEveryRange.upperBound)
        copy.reRingCount = min(max(reRingCount, Self.reRingCountRange.lowerBound), Self.reRingCountRange.upperBound)
        return copy
    }
}
