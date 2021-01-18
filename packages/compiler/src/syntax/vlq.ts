const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const inverse_alphabet =
    new Map<string, number>(Object.entries(alphabet).map(([i,c])=>[c,parseInt(i)]));

export function vlqDecode(s: string): Array<number> {
    let acc = 0;
    let shift_amount = 0;
    const buf = [];
    for (const ch of s) {
        const sextet = inverse_alphabet.get(ch) ?? 0;
        acc |= (sextet & 0x1f) << shift_amount;
        shift_amount += 5;
        if (!(sextet & 0x20)) {
            const negative = !!(acc & 1);
            acc = acc >> 1;
            if (negative) acc = -acc;
            buf.push(acc);
            acc = 0;
            shift_amount = 0;
        }
    }
    return buf;
}

export function vlqEncode(ns: Array<number>): string {
    const buf = [];
    for (let n of ns) {
        n = (n < 0) ? ((-n) << 1) | 1 : (n << 1);
        do {
            const m = n & 0x1f;
            n = n >> 5;
            const sextet = (n > 0) ? m | 0x20 : m;
            buf.push(alphabet[sextet]);
        } while (n > 0);
    }
    return buf.join('');
}
