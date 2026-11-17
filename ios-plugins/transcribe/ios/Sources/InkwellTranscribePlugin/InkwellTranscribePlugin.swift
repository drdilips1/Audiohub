import Foundation
import Capacitor
import AVFoundation
import Speech

/// Live transcript on iPhone: the same interface as the Android plugin (start / position /
/// stop, "segment" and "status" events), built on Apple's own speech recognition.
///
/// iOS can only cut pieces out of audio that is on the phone, so:
/// - MP3 (most multi-part books): each ~45 s piece is fetched on its own with an HTTP
///   range request (from the file's size and length) and recognised directly.
/// - Other formats (M4B / M4A): the part is downloaded once, then cut locally; the copy
///   is deleted when the transcript stops or moves on.
@objc(InkwellTranscribePlugin)
public class InkwellTranscribePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellTranscribePlugin"
    public let jsName = "InkwellTranscribe"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "position", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let lock = NSLock()
    private var currentJob = ""
    private var playPos: Double = 0
    private var task: Task<Void, Never>?
    /// Seconds of audio per piece (Apple's server recognition stops at one minute).
    private let pieceLength: Double = 45
    /// Downloaded copy of the current part (non-MP3), kept while the same part is transcribed.
    private var cached: (url: URL, file: URL)?

    @objc func start(_ call: CAPPluginCall) {
        let job = call.getString("job") ?? ""
        guard let address = call.getString("url"), let url = Self.fileUrl(address) ?? URL(string: address) else {
            call.reject("No audio address")
            return
        }
        var headers: [String: String] = [:]
        for (k, v) in call.getObject("headers") ?? [:] {
            if let s = v as? String { headers[k] = s }
        }
        let from = call.getDouble("start") ?? 0
        let ahead = call.getDouble("ahead") ?? 90
        let duration = call.getDouble("duration") ?? 0
        let language = call.getString("language") ?? "en"

        task?.cancel()
        lock.lock()
        currentJob = job
        playPos = from
        lock.unlock()
        call.resolve()

        task = Task.detached(priority: .userInitiated) { [weak self] in
            await self?.run(job: job, url: url, headers: headers, from: from, ahead: ahead, knownDuration: duration, language: language)
        }
    }

    @objc func position(_ call: CAPPluginCall) {
        lock.lock()
        playPos = call.getDouble("pos") ?? playPos
        lock.unlock()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        lock.lock()
        currentJob = ""
        lock.unlock()
        task?.cancel()
        task = nil
        dropCache()
        call.resolve()
    }

    // MARK: - work

    /// "capacitor://localhost/_capacitor_file_/…" (a file on the phone, as the web view sees it) → file URL.
    private static func fileUrl(_ address: String) -> URL? {
        guard let r = address.range(of: "/_capacitor_file_") else { return nil }
        let path = String(address[r.upperBound...]).removingPercentEncoding ?? String(address[r.upperBound...])
        return URL(fileURLWithPath: path)
    }

    private func isCurrent(_ job: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return job == currentJob && !Task.isCancelled
    }

    private func listening() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return playPos
    }

    private func status(_ job: String, _ state: String, _ message: String = "") {
        notifyListeners("status", data: ["job": job, "state": state, "message": message])
    }

    private func fail(_ text: String) -> NSError {
        NSError(domain: "Transcript", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }

    private func dropCache() {
        lock.lock()
        let old = cached
        cached = nil
        lock.unlock()
        if let f = old?.file { try? FileManager.default.removeItem(at: f) }
    }

    private func authorize() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return true
        case .notDetermined:
            return await withCheckedContinuation { c in
                SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
            }
        default: return false
        }
    }

    /// Size and type of a remote file, and where its audio starts (after an ID3 tag, which
    /// can hold megabytes of cover art), from a small range request.
    private func probe(_ url: URL, headers: [String: String]) async throws -> (size: Int64, type: String, ranges: Bool, audioStart: Int64) {
        var req = URLRequest(url: url, timeoutInterval: 30)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("bytes=0-9", forHTTPHeaderField: "Range")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw fail("no answer from the server") }
        guard http.statusCode < 400 else { throw fail("the server answered \(http.statusCode)") }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        var audioStart: Int64 = 0
        let b = [UInt8](data.prefix(10))
        if b.count == 10, b[0] == 0x49, b[1] == 0x44, b[2] == 0x33 { // "ID3"
            let size = (Int64(b[6] & 0x7f) << 21) | (Int64(b[7] & 0x7f) << 14) | (Int64(b[8] & 0x7f) << 7) | Int64(b[9] & 0x7f)
            audioStart = 10 + size + ((b[5] & 0x10) != 0 ? 10 : 0)
        }
        if http.statusCode == 206, let cr = http.value(forHTTPHeaderField: "Content-Range"), let total = cr.split(separator: "/").last.flatMap({ Int64($0) }) {
            return (total, type, true, audioStart)
        }
        return (http.expectedContentLength, type, false, audioStart)
    }

    private func run(job: String, url: URL, headers: [String: String], from: Double, ahead: Double, knownDuration: Double, language: String) async {
        status(job, "loading", "model")
        guard await authorize() else {
            status(job, "error", "Allow speech recognition for Audiohub: iPhone Settings → Privacy & Security → Speech Recognition.")
            return
        }
        let locale = Locale(identifier: language == "hi" ? "hi-IN" : "en-US")
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            status(job, "error", "Speech recognition isn't available for this language on this iPhone.")
            return
        }

        status(job, "loading", "audio")
        // Work out how to get pieces of this part.
        var mp3Size: Int64 = 0 // > 0: fetch MP3 pieces by byte range
        var mp3Start: Int64 = 0
        var localAsset: AVURLAsset?
        do {
            if url.isFileURL {
                localAsset = AVURLAsset(url: url)
            } else {
                let info = try await probe(url, headers: headers)
                let isMp3 = url.pathExtension.lowercased() == "mp3" || info.type.contains("mpeg") || info.type.contains("mp3")
                if isMp3 && info.ranges && info.size > 0 {
                    mp3Size = info.size
                    mp3Start = min(info.audioStart, info.size / 2)
                } else {
                    if info.size > 900_000_000 {
                        status(job, "error", "This part is too big to transcribe on iPhone (\(info.size / 1_000_000) MB).")
                        return
                    }
                    localAsset = AVURLAsset(url: try await localCopy(url, headers: headers, job: job))
                }
            }
        } catch {
            if isCurrent(job) { status(job, "error", "Couldn't open this book's audio for the transcript (\(error.localizedDescription)).") }
            return
        }
        guard isCurrent(job) else { return }

        var total = knownDuration
        if let a = localAsset, let d = try? await a.load(.duration), d.seconds.isFinite, d.seconds > 0 { total = d.seconds }
        if mp3Size > 0 && total <= 0 {
            let remote = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
            if let d = try? await remote.load(.duration), d.seconds.isFinite, d.seconds > 0 { total = d.seconds }
        }
        if mp3Size > 0 && total <= 0 {
            status(job, "error", "Couldn't tell how long this part is, so the transcript can't find its place.")
            return
        }

        // Pieces are fetched and recognised two at a time, so the text keeps ahead of the
        // listener; the first one is short, so text shows up quickly. When the listener gets
        // ahead of the text anyway (or skips forward), the work jumps to where they are.
        var source = PieceSource.missing
        if mp3Size > 0 {
            source = .mp3(size: mp3Size, audioStart: mp3Start)
        } else if let a = localAsset {
            source = .local(a)
        }
        var next = from
        var first = true
        var queue: [(at: Double, length: Double, work: Task<[SFTranscriptionSegment], Error>)] = []
        defer { queue.forEach { $0.work.cancel() } }
        var running = false
        var failures = 0
        var deaf = 0 // pieces in a row the recognizer refused
        setOnDevice(recognizer.supportsOnDeviceRecognition)
        while isCurrent(job) {
            let pos = listening()
            // Pieces the listener has already passed are no use for following along: drop them.
            if let last = queue.last, last.at + last.length < pos - 2 {
                queue.forEach { $0.work.cancel() }
                queue = []
            }
            if queue.isEmpty && next < pos - 8 {
                next = max(0, pos - 2)
                first = true
            }
            while queue.count < 2 && (total <= 0 || next < total - 0.5) && next <= pos + ahead {
                var length = first ? 15 : pieceLength
                if total > 0 { length = min(length, total - next) }
                let at = next, len = length, src = source, whole = total
                queue.append((at, len, Task(priority: .userInitiated) { [weak self] in
                    guard let self = self else { throw CancellationError() }
                    return try await self.piece(src, url: url, headers: headers, total: whole, start: at, length: len, recognizer: recognizer)
                }))
                next += length
                first = false
            }
            if queue.isEmpty {
                if total > 0 && next >= total - 0.5 {
                    status(job, "done")
                    return
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }
            let p = queue.removeFirst()
            var words: [SFTranscriptionSegment] = []
            do {
                words = try await p.work.value
                failures = 0
                deaf = 0
            } catch PieceError.fetch(let error) {
                if !isCurrent(job) { return }
                if total == 0 && failures > 0 { status(job, "done"); return } // past the end of a file of unknown length
                failures += 1
                if failures >= 3 {
                    status(job, "error", "Couldn't read this book's audio for the transcript (\(error.localizedDescription)).")
                    return
                }
                // Try this stretch again.
                queue.forEach { $0.work.cancel() }
                queue = []
                next = p.at
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            } catch PieceError.recognize(let error) {
                guard isCurrent(job) else { return }
                if !Self.noSpeech(error) { deaf += 1 }
                if deaf >= 2 {
                    status(job, "error", Self.explain(error))
                    return
                }
            } catch {
                if !isCurrent(job) { return }
            }
            guard isCurrent(job) else { return }
            if !running {
                running = true
                status(job, "running")
            }
            for line in lines(words, offset: p.at) {
                notifyListeners("segment", data: ["job": job, "start": line.start, "end": line.end, "text": line.text])
            }
        }
    }

    private enum PieceSource {
        case mp3(size: Int64, audioStart: Int64)
        case local(AVURLAsset)
        case missing
    }

    private enum PieceError: Error {
        case fetch(Error)
        case recognize(Error)
    }

    private var onDevice = false
    private func setOnDevice(_ v: Bool) { lock.lock(); onDevice = v; lock.unlock() }
    private func useOnDevice() -> Bool { lock.lock(); defer { lock.unlock() }; return onDevice }

    /// Fetch one piece and recognise it.
    private func piece(_ source: PieceSource, url: URL, headers: [String: String], total: Double, start: Double, length: Double, recognizer: SFSpeechRecognizer) async throws -> [SFTranscriptionSegment] {
        let file: URL
        do {
            switch source {
            case .mp3(let size, let audioStart):
                file = try await mp3Piece(url, headers: headers, size: size, audioStart: audioStart, total: total, start: start, length: length)
            case .local(let asset):
                file = try await cut(asset, start: start, length: length)
            case .missing:
                throw fail("no audio")
            }
        } catch {
            throw PieceError.fetch(error)
        }
        defer { try? FileManager.default.removeItem(at: file) }
        try Task.checkCancellation()
        let device = useOnDevice()
        do {
            return try await recognize(file, with: recognizer, onDevice: device)
        } catch {
            try Task.checkCancellation()
            guard device, !Self.noSpeech(error) else { throw PieceError.recognize(error) }
            // The on-device model may not be downloaded: use Apple's servers from now on.
            setOnDevice(false)
            do { return try await recognize(file, with: recognizer, onDevice: false) } catch { throw PieceError.recognize(error) }
        }
    }

    /// One MP3 piece: the matching byte range, saved as a small file (MP3 frames re-sync on their own).
    private func mp3Piece(_ url: URL, headers: [String: String], size: Int64, audioStart: Int64, total: Double, start: Double, length: Double) async throws -> URL {
        let perSecond = Double(size - audioStart) / total
        let first = audioStart + max(0, Int64(start * perSecond))
        let last = min(size - 1, audioStart + Int64((start + length) * perSecond) + 4096)
        var req = URLRequest(url: url, timeoutInterval: 60)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("bytes=\(first)-\(last)", forHTTPHeaderField: "Range")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 206 || http.statusCode == 200, !data.isEmpty else {
            throw fail("the server didn't send this part of the audio")
        }
        // Start the file on a real frame, so iOS reads it as MP3.
        let bytes = [UInt8](data)
        guard let sync = Self.firstFrame(bytes) else { throw fail("this part of the audio isn't readable MP3") }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-\(UUID().uuidString).mp3")
        try Data(bytes[sync...]).write(to: out)
        return out
    }

    /// Length of the MPEG audio frame whose header starts at i, or nil if it isn't one.
    private static func frameLength(_ b: [UInt8], _ i: Int) -> Int? {
        guard i + 4 <= b.count, b[i] == 0xFF, b[i + 1] & 0xE0 == 0xE0 else { return nil }
        let version = (b[i + 1] >> 3) & 3 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        let layer = (b[i + 1] >> 1) & 3   // 1 = Layer III
        let rateIndex = Int(b[i + 2] >> 4)
        let srIndex = Int((b[i + 2] >> 2) & 3)
        let padding = Int((b[i + 2] >> 1) & 1)
        guard version != 1, layer == 1, rateIndex != 0, rateIndex != 15, srIndex != 3 else { return nil }
        let v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        let v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
        let rates = [44100, 48000, 32000]
        let kbps = version == 3 ? v1[rateIndex] : v2[rateIndex]
        let sr = rates[srIndex] / (version == 3 ? 1 : version == 2 ? 2 : 4)
        return (version == 3 ? 144 : 72) * kbps * 1000 / sr + padding
    }

    /// First frame header followed by two more valid frames (so a stray 0xFF in the data doesn't count).
    private static func firstFrame(_ b: [UInt8]) -> Int? {
        var i = 0
        while i + 4 <= b.count {
            if let n = frameLength(b, i), let m = frameLength(b, i + n), frameLength(b, i + n + m) != nil { return i }
            i += 1
        }
        return nil
    }

    /// The whole part on the phone (formats that can't be fetched in pieces), reused while it's the same part.
    private func localCopy(_ url: URL, headers: [String: String], job: String) async throws -> URL {
        lock.lock()
        let hit = cached
        lock.unlock()
        if let hit = hit, hit.url == url, FileManager.default.fileExists(atPath: hit.file.path) { return hit.file }
        dropCache()
        var req = URLRequest(url: url, timeoutInterval: 120)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let (tmp, resp) = try await URLSession.shared.download(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            try? FileManager.default.removeItem(at: tmp)
            throw fail("the server refused the download")
        }
        let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-part-\(UUID().uuidString).\(ext)")
        try FileManager.default.moveItem(at: tmp, to: file)
        lock.lock()
        cached = (url, file)
        lock.unlock()
        return file
    }

    /// One piece of a local file as a small m4a.
    private func cut(_ asset: AVURLAsset, start: Double, length: Double) async throws -> URL {
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw fail("this audio can't be read")
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-\(UUID().uuidString).m4a")
        session.outputURL = out
        session.outputFileType = .m4a
        session.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 1000),
                                        duration: CMTime(seconds: length, preferredTimescale: 1000))
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { c.resume() }
        }
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: out)
            throw session.error ?? fail("couldn't read this part")
        }
        return out
    }

    /// "No speech detected": a quiet or musical piece, not a failure.
    private static func noSpeech(_ error: Error) -> Bool {
        let e = error as NSError
        return e.code == 1110 || e.localizedDescription.lowercased().contains("no speech")
    }

    private static func explain(_ error: Error) -> String {
        let e = error as NSError
        let text = e.localizedDescription
        if e.code == 201 || text.lowercased().contains("siri") || text.lowercased().contains("dictation") {
            return "Turn on Dictation for the transcript: iPhone Settings → General → Keyboard → Enable Dictation (and Siri, if it asks)."
        }
        return "Speech recognition failed on this iPhone (\(text), \(e.domain) \(e.code))."
    }

    private func recognize(_ file: URL, with recognizer: SFSpeechRecognizer, onDevice: Bool) async throws -> [SFTranscriptionSegment] {
        let request = SFSpeechURLRecognitionRequest(url: file)
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = onDevice
        if #available(iOS 16, *) { request.addsPunctuation = true }
        let box = RecognitionBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { c in
                var finished = false
                box.set(recognizer.recognitionTask(with: request) { result, error in
                    if finished { return }
                    if let error = error {
                        finished = true
                        c.resume(throwing: error)
                    } else if let result = result, result.isFinal {
                        finished = true
                        c.resume(returning: result.bestTranscription.segments)
                    }
                })
            }
        } onCancel: {
            box.cancel()
        }
    }

    /// Words → readable lines: break after a sentence (5+ words) or at 18 words.
    private func lines(_ words: [SFTranscriptionSegment], offset: Double) -> [(start: Double, end: Double, text: String)] {
        var out: [(start: Double, end: Double, text: String)] = []
        var parts: [String] = []
        var first = 0.0
        var last = 0.0
        func flush() {
            guard !parts.isEmpty else { return }
            var text = parts.joined(separator: " ")
            for p in [".", ",", "!", "?", ";", ":"] { text = text.replacingOccurrences(of: " " + p, with: p) }
            out.append((offset + first, offset + last, text))
            parts = []
        }
        for w in words {
            let s = w.substring.trimmingCharacters(in: .whitespaces)
            if s.isEmpty { continue }
            if parts.isEmpty { first = w.timestamp }
            parts.append(s)
            last = w.timestamp + w.duration
            let sentenceEnd = s.hasSuffix(".") || s.hasSuffix("?") || s.hasSuffix("!")
            if (sentenceEnd && parts.count >= 5) || parts.count >= 18 { flush() }
        }
        flush()
        return out
    }
}

/// Holds a running recognition so a cancelled piece can stop it.
private final class RecognitionBox: @unchecked Sendable {
    private let lock = NSLock()
    private var task: SFSpeechRecognitionTask?
    private var cancelled = false
    func set(_ t: SFSpeechRecognitionTask) {
        lock.lock()
        task = t
        let stop = cancelled
        lock.unlock()
        if stop { t.cancel() }
    }
    func cancel() {
        lock.lock()
        cancelled = true
        let t = task
        lock.unlock()
        t?.cancel()
    }
}
