import Foundation

/// Decides whether what was typed is the phrase that was asked for.
///
/// The iPhone keyboard turns a typed ' into a curly ’ (Smart Punctuation), so a phrase saved
/// with one kind of apostrophe and typed with the other would never match, and you'd be stuck
/// at 6 AM. Both are treated as the same character. Extra spaces are ignored. Capital letters
/// don't matter unless `caseSensitive` is true. Nothing else is forgiven: a missing letter or
/// a trailing full stop is a mismatch.
enum PhraseMatcher {
    private static let apostrophes: [String] = ["\u{2019}", "\u{2018}", "\u{02BC}", "\u{FF07}", "\u{00B4}", "`"]

    static func normalize(_ text: String) -> String {
        var t = text.precomposedStringWithCanonicalMapping
        for mark in apostrophes { t = t.replacingOccurrences(of: mark, with: "'") }
        return t.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func matches(typed: String, expected: String, caseSensitive: Bool = false) -> Bool {
        let want = normalize(expected)
        guard !want.isEmpty else { return false }
        let got = normalize(typed)
        return caseSensitive ? got == want : got.lowercased() == want.lowercased()
    }
}
