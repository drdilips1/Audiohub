package app.inkwell.books;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;

/**
 * The v2 "Sec-MS-GEC" token Microsoft's read-aloud service now asks for: "<CS64>-<SHA256>"
 * (16 + 64 hex digits). Both halves are Microsoft's own variants of the usual algorithms, so
 * Java's SHA-256 can't be used. Ported from edge-tts 7.3 (drm.py); keep it in step with that
 * library when Microsoft changes things again.
 */
final class EdgeToken {
    private EdgeToken() {}

    private static final long M = 0xFFFFFFFFL;

    private static final long[] INITIAL = {0x6A09E667L, 0xBB67AE85L, 0x3C6EF372L, 0xA54FF53AL, 0x510E527FL, 0x9B05688CL, 0x1F83D9ABL, 0x5BE0CD19L};
    private static final long[] STATE = {0xFD9FBEA2L, 0x91243CE7L, 0xBE499094L, 0xCD2E1E0AL, 0x6C006F49L, 0x04BD35ABL, 0xFEB0A7E4L, 0x03EFFBD2L};
    private static final long[] SCHEDULE = {0xEB24BF9EL, 0x1558691FL, 0xA0C09EE2L, 0x0CFA32BAL, 0xA622EE8CL, 0xD1DD9491L, 0xC0DD25A0L, 0xF9E70AB6L,
        0xF0C31573L, 0x7058CE4EL, 0x7188E606L, 0x00E5AB33L, 0xD258B060L, 0x72766564L};
    private static final long[] K = {
        0x428A2F98L, 0x71374491L, 0xB5C0FBCFL, 0xE9B5DBA5L, 0x3956C25BL, 0x59F111F1L, 0x923F82A4L, 0xAB1C5ED5L,
        0xD807AA98L, 0x12835B01L, 0x243185BEL, 0x550C7DC3L, 0x72BE5D74L, 0x80DEB1FEL, 0x9BDC06A7L, 0xC19BF174L,
        0xE49B69C1L, 0xEFBE4786L, 0x0FC19DC6L, 0x240CA1CCL, 0x2DE92C6FL, 0x4A7484AAL, 0x5CB0A9DCL, 0x76F988DAL,
        0x983E5152L, 0xA831C66DL, 0xB00327C8L, 0xBF597FC7L, 0xC6E00BF3L, 0xD5A79147L, 0x06CA6351L, 0x14292967L,
        0x27B70A85L, 0x2E1B2138L, 0x4D2C6DFCL, 0x53380D13L, 0x650A7354L, 0x766A0ABBL, 0x81C2C92EL, 0x92722C85L,
        0xA2BFE8A1L, 0xA81A664BL, 0xC24B8B70L, 0xC76C51A3L, 0xD192E819L, 0xD6990624L, 0xF40E3585L, 0x106AA070L,
        0x19A4C116L, 0x1E376C08L, 0x2748774CL, 0x34B0BCB5L, 0x391C0CB3L, 0x4ED8AA4AL, 0x5B9CCA4FL, 0x682E6FF3L,
        0x748F82EEL, 0x78A5636FL, 0x84C87814L, 0x8CC70208L, 0x90BEFFFAL, 0xA4506CEBL, 0xBEF9A3F7L, 0xC67178F2L,
    };
    private static final long ADJUSTMENT = 0xC9DC06A7L;
    private static final long[] K_FIRST = K.clone();

    static {
        K_FIRST[14] = ADJUSTMENT;
    }

    private static final long SIGMA0_ADJ = 0x059C0B80L;
    private static final long SIGMA1_ADJ = 0x000B92C0L;
    private static final long[][] CS64 = {
        {0xE82E91B1L, 0xB32700D0L}, {0x44DE24C6L, 0x88DFF51DL}, {0x3BEB65BCL, 0x29514038L}, {0xC89C5933L, 0xB328CBDFL},
        {0x8D1EC211L, 0xD405B4D5L}, {0x314EF5D5L, 0x26E55F3CL}, {0xE92491B1L, 0x607801C6L}, {0xF0A5B9D5L, 0x82B2C1FBL},
        {0x06064CF3L, 0xFA51A3DAL}, {0xDA79FA60L, 0x207CC464L}, {0xBED20560L, 0x3C3C74F3L}, {0x89F9C9F8L, 0xD2D14B61L},
        {0x35FA38C6L, 0xBB04A2C1L}, {0xCB49E3C6L, 0xC5626167L},
    };
    private static final long CS64_FACTOR = 0x82893933L;
    private static final long CS64_ADJ0 = 0xF2F90B1AL;
    private static final long CS64_ADJ1 = 0x0B1A0000L;

    private static long rol16(long v) {
        v &= M;
        return ((v << 16) | (v >>> 16)) & M;
    }

    private static long sigma0(long v) {
        return ((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) & M;
    }

    private static long sigma1(long v) {
        return ((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) & M;
    }

    /** ROTR family on a 32-bit value: the value repeated in 64 bits, shifted right (unsigned). */
    private static long big0(long a) {
        long r = (a << 32) | a;
        return (r >>> 2) ^ (r >>> 13) ^ (r >>> 22);
    }

    private static long big1(long e) {
        long r = (e << 32) | e;
        return (r >>> 6) ^ (r >>> 11) ^ (r >>> 25);
    }

    private static long[] rounds(long[] s, long[] w, int first) {
        long a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
        long[] k = first == 14 ? K_FIRST : K;
        for (int i = first; i < 64; i++) {
            long t1 = h + big1(e) + (g ^ (e & (f ^ g))) + k[i] + w[i];
            long t2 = big0(a) + ((a & b) | (c & (a | b)));
            h = g;
            g = f;
            f = e;
            e = (d + t1) & M;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) & M;
        }
        return new long[] {a, b, c, d, e, f, g, h};
    }

    private static void expand(long[] w, int from) {
        for (int i = from; i < 64; i++) {
            long x = w[i - 2], y = w[i - 15];
            long s1 = (x >>> 17) ^ (x << 15) ^ (x >>> 19) ^ (x << 13) ^ (x >>> 10);
            long s0 = (y >>> 7) ^ (y << 25) ^ (y >>> 18) ^ (y << 14) ^ (y >>> 3);
            w[i] = (s1 + w[i - 7] + s0 + w[i - 16]) & M;
        }
    }

    private static long be(byte[] d, int from, int to) {
        long v = 0;
        for (int i = from; i < to; i++) v = (v << 8) | (d[i] & 0xFF);
        return v;
    }

    private static long[] init(byte[] data) {
        long[] w = new long[64];
        w[14] = be(data, 0, 3);
        w[15] = be(data, 3, 7);
        for (int i = 16; i < 30; i++) {
            long v = SCHEDULE[i - 16];
            if (i - 2 >= 14) v += i == 16 ? (sigma1(w[i - 2]) ^ SIGMA1_ADJ) : sigma1(w[i - 2]);
            if (i - 7 >= 14) v += w[i - 7];
            if (i - 15 >= 14) v += i == 29 ? (sigma0(w[i - 15]) ^ SIGMA0_ADJ) : sigma0(w[i - 15]);
            w[i] = v & M;
        }
        w[30] = (sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + ADJUSTMENT - K[14]) & M;
        expand(w, 31);
        long[] work = rounds(STATE, w, 14);
        long[] out = new long[8];
        for (int i = 0; i < 8; i++) out[i] = (INITIAL[i] + work[i]) & M;
        return out;
    }

    static byte[] sha256(byte[] data) {
        int length = 57 + data.length;
        int pad = Math.floorMod(55 - length, 64);
        byte[] p = new byte[data.length - 7 + 1 + pad + 8];
        System.arraycopy(data, 7, p, 0, data.length - 7);
        p[data.length - 7] = (byte) 0x80;
        long bits = (long) length * 8;
        for (int i = 0; i < 8; i++) p[p.length - 1 - i] = (byte) (bits >>> (8 * i));
        long[] state = init(data);
        long[] w = new long[64];
        for (int off = 0; off < p.length; off += 64) {
            for (int i = 0; i < 16; i++) w[i] = be(p, off + 4 * i, off + 4 * i + 4);
            expand(w, 16);
            long[] work = rounds(state, w, 0);
            for (int i = 0; i < 8; i++) state[i] = (state[i] + work[i]) & M;
        }
        ByteBuffer out = ByteBuffer.allocate(32).order(ByteOrder.BIG_ENDIAN);
        for (long v : state) out.putInt((int) v);
        return out.array();
    }

    static long[] cs64(byte[] data, byte[] digest) {
        ByteBuffer dg = ByteBuffer.wrap(digest).order(ByteOrder.LITTLE_ENDIAN);
        long keyA = (dg.getInt(0) & M) | 1;
        long keyB = (dg.getInt(4) & M) | 1;
        long[] factors = {(keyA * CS64_FACTOR) & M, (keyB * CS64_FACTOR) & M};
        // The data with a 0 byte in front, as little-endian words, padded to an even count.
        int n = data.length + 1;
        int padded = (n + 3) / 4 * 4;
        byte[] buf = new byte[padded];
        System.arraycopy(data, 0, buf, 1, data.length);
        int count = padded / 4;
        if (count % 2 == 1) count++;
        long[] words = new long[count];
        ByteBuffer bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < padded / 4; i++) words[i] = bb.getInt(4 * i) & M;
        long[] terms = new long[CS64.length + count];
        long[] offsets = new long[CS64.length + count];
        for (int i = 0; i < CS64.length; i++) {
            terms[i] = (CS64[i][0] * factors[i % 2]) & M;
            offsets[i] = CS64[i][1];
        }
        for (int i = 0; i < count; i++) {
            long word = words[i];
            long term = word * (i % 2 == 0 ? keyA : keyB);
            long offset = rol16(word) * (i % 2 == 0 ? 0xEF0569FBL : 0xC31713DBL);
            if (i == 0) {
                term += CS64_ADJ0 * factors[0];
                offset += CS64_ADJ1;
            }
            terms[CS64.length + i] = term & M;
            offsets[CS64.length + i] = offset & M;
        }
        long swapAcc = 0, swapLast = 0, state = 0, acc = 0;
        for (int i = 0; i < terms.length; i += 2) {
            long x = terms[i], y = terms[i + 1];
            long t = rol16((offsets[i] + x) & M);
            long q = (t * 0x76F50F34L) & M;
            swapAcc += (rol16(q) * 0xC3EFEA97L + q) & M;
            t = rol16((offsets[i + 1] + y) & M);
            q = (t * 0x1881CE3CL) & M;
            swapLast = (rol16(q) * 0x35BD1EC9L + q) & M;
            swapAcc = (swapAcc + swapLast) & M;

            state = (state * keyA + x) & M;
            state = (rol16(state) * 0xCF98B111L) & M;
            state = (rol16(state) * 0x87085B9FL) & M;
            state = (rol16(state) * 0x12CEB96DL) & M;
            state = (rol16(state) * 0x257E1D83L) & M;
            acc += state;
            t = (state * keyB + y) & M;
            t = (rol16(t) * 0xA27416F5L) & M;
            t = (rol16(t) * 0xD38396FFL) & M;
            state = (rol16((rol16(t) * 0x7C932B89L) & M) * 0xBFA49F69L) & M;
            acc = (acc + state) & M;
        }
        return new long[] {swapLast ^ state, swapAcc ^ acc};
    }

    /** The token for this text (Windows file-time ticks + the client token). */
    static String forText(String text) {
        byte[] data;
        try {
            data = text.getBytes("US-ASCII");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        byte[] digest = sha256(data);
        long[] c = cs64(data, digest);
        ByteBuffer cb = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN);
        cb.putInt((int) c[0]).putInt((int) c[1]);
        return hex(cb.array()) + "-" + hex(digest);
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.US, "%02X", x));
        return sb.toString();
    }
}
