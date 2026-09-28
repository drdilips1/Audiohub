package app.inkwell.books;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Microsoft Edge "Read aloud" neural voices: natural, fast, no key, no quota.
 * Needs internet. A port of the protocol used by the edge-tts package (same as
 * the Paper to Audio app). Unofficial: Microsoft could change or block it.
 */
public final class EdgeTts {

    private EdgeTts() {}

    private static final String TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private static final String BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
    private static final String GEC_VERSION = "1-143.0.3650.75";
    private static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
    private static final long WIN_EPOCH = 11644473600L;
    /** Characters per request: well under the service's 4096-byte limit once escaped. */
    private static final int PIECE_CHARS = 1200;

    /** Overridable so the protocol can be tested against a local server. */
    static String socketBase = "wss://" + BASE;

    private static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build();

    /** Corrects for a phone clock that is off; the token is time-based. */
    private static volatile long skewSeconds = 0;

    static String secMsGec() {
        long t = System.currentTimeMillis() / 1000 + skewSeconds + WIN_EPOCH;
        t -= t % 300;
        long ticks = t * 10_000_000L;
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest((ticks + TOKEN).getBytes("US-ASCII"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.US, "%02X", b));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static String muid() {
        return UUID.randomUUID().toString().replace("-", "").toUpperCase(Locale.US);
    }

    private static String jsDate() {
        SimpleDateFormat f = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private static void adjustSkew(Response response) {
        if (response == null) return;
        String date = response.header("Date");
        if (date == null) return;
        try {
            Date server = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).parse(date);
            if (server != null) skewSeconds = (server.getTime() - System.currentTimeMillis()) / 1000;
        } catch (Exception ignored) {
        }
    }

    static String escape(String text) {
        StringBuilder sb = new StringBuilder(text.length() + 16);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '&') sb.append("&amp;");
            else if (c == '<') sb.append("&lt;");
            else if (c == '>') sb.append("&gt;");
            // The service rejects most control characters.
            else if (c <= 8 || c == 11 || c == 12 || (c >= 14 && c <= 31)) sb.append(' ');
            else sb.append(c);
        }
        return sb.toString();
    }

    /** The MP3 payload of a binary frame, or null if it isn't audio. */
    static byte[] audioPayload(byte[] frame) {
        if (frame.length < 2) return null;
        int headerLength = ((frame[0] & 0xff) << 8) | (frame[1] & 0xff);
        if (2 + headerLength > frame.length) return null;
        String headers = new String(frame, 2, headerLength, java.nio.charset.StandardCharsets.UTF_8);
        if (!headers.contains("Path:audio\r\n") && !headers.endsWith("Path:audio")) return null;
        byte[] out = new byte[frame.length - 2 - headerLength];
        System.arraycopy(frame, 2 + headerLength, out, 0, out.length);
        return out;
    }

    /** Split long text at sentence ends, then spaces, so each request stays small. */
    static List<String> splitLong(String text, int max) {
        List<String> out = new ArrayList<>();
        String t = text.trim();
        while (t.length() > max) {
            int cut = -1;
            for (int i = max; i > max / 2; i--) {
                char c = t.charAt(i - 1);
                if ((c == '.' || c == '!' || c == '?' || c == ';') && Character.isWhitespace(t.charAt(i))) {
                    cut = i;
                    break;
                }
            }
            if (cut < 0) cut = t.lastIndexOf(' ', max);
            if (cut <= 0) cut = max;
            out.add(t.substring(0, cut).trim());
            t = t.substring(cut).trim();
        }
        if (!t.isEmpty()) out.add(t);
        return out;
    }

    /** MP3 audio (24 kHz mono) for [text]. ratePercent is -50..+200. */
    public static byte[] synthesize(String text, String voice, int ratePercent) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (String piece : splitLong(text, PIECE_CHARS)) out.write(synthesizePiece(piece, voice, ratePercent, true));
        return out.toByteArray();
    }

    private static byte[] synthesizePiece(String text, String voice, int ratePercent, boolean retryOnAuth) throws IOException {
        Request request = new Request.Builder()
            .url(socketBase + "/edge/v1?TrustedClientToken=" + TOKEN + "&ConnectionId=" + muid().toLowerCase(Locale.US)
                + "&Sec-MS-GEC=" + secMsGec() + "&Sec-MS-GEC-Version=" + GEC_VERSION)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=" + muid() + ";")
            .build();

        final ByteArrayOutputStream audio = new ByteArrayOutputStream();
        final CountDownLatch done = new CountDownLatch(1);
        final Throwable[] failure = {null};
        final Response[] failedResponse = {null};
        final String rate = ratePercent >= 0 ? "+" + ratePercent + "%" : ratePercent + "%";

        WebSocket ws = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                webSocket.send("X-Timestamp:" + jsDate() + "\r\n"
                    + "Content-Type:application/json; charset=utf-8\r\n"
                    + "Path:speech.config\r\n\r\n"
                    + "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{"
                    + "\"sentenceBoundaryEnabled\":\"true\",\"wordBoundaryEnabled\":\"false\"},"
                    + "\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n");
                String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"
                    + "<voice name='" + voice + "'><prosody pitch='+0Hz' rate='" + rate + "' volume='+0%'>"
                    + escape(text) + "</prosody></voice></speak>";
                webSocket.send("X-RequestId:" + muid().toLowerCase(Locale.US) + "\r\n"
                    + "Content-Type:application/ssml+xml\r\n"
                    + "X-Timestamp:" + jsDate() + "Z\r\n" // the trailing Z matches what Edge sends
                    + "Path:ssml\r\n\r\n" + ssml);
            }

            @Override
            public void onMessage(WebSocket webSocket, String msg) {
                if (msg.contains("Path:turn.end")) {
                    webSocket.close(1000, null);
                    done.countDown();
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                byte[] payload = audioPayload(bytes.toByteArray());
                if (payload != null) synchronized (audio) {
                    audio.write(payload, 0, payload.length);
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                failure[0] = t;
                failedResponse[0] = response;
                done.countDown();
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                done.countDown();
            }
        });

        try {
            if (!done.await(90, TimeUnit.SECONDS)) {
                ws.cancel();
                throw new IOException("The voice service timed out");
            }
        } catch (InterruptedException e) {
            ws.cancel();
            throw new IOException("Stopped");
        }
        Integer code = failedResponse[0] != null ? failedResponse[0].code() : null;
        if (code != null && code == 403 && retryOnAuth) {
            adjustSkew(failedResponse[0]);
            return synthesizePiece(text, voice, ratePercent, false);
        }
        if (failure[0] != null) throw new IOException(code != null ? "Voice service error (HTTP " + code + ")" : String.valueOf(failure[0].getMessage()), failure[0]);
        byte[] bytes;
        synchronized (audio) {
            bytes = audio.toByteArray();
        }
        if (bytes.length == 0) throw new IOException("The voice service returned no audio");
        return bytes;
    }
}
