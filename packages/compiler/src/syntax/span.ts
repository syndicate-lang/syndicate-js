export class SpanResult<T> {
    readonly searchTarget: number;
    readonly start: number;
    readonly items: Array<{ end: number, item: T }> = [];

    constructor(searchTarget: number, start: number) {
        this.searchTarget = searchTarget;
        this.start = start;
    }

    get offset(): number {
        return this.searchTarget - this.start;
    }

    get firstItem(): T {
        return this.items[0].item;
    }

    get lastItem(): T {
        return this.items[this.items.length - 1].item;
    }
}

export class SpanIndex<T> {
    readonly index: Array<[number, Array<[number, T]>]> = [];

    get(pos: number): SpanResult<T> | null {
        if (this.index.length === 0) return null;

        let lo = 0;
        let hi = this.index.length;

        // console.log(`\nsearching for ${target}`);
        while (true) {
            if (lo === hi) {
                if (lo === 0) return null;
                const e = this.index[lo - 1];
                if (e[0] > pos) throw new Error("INTERNAL ERROR: bad binary search (1)");
                if (this.index[lo]?.[0] <= pos) throw new Error("INTERNAL ERROR: bad binary search (2)");
                // console.log(`found ${JSON.stringify(e)}, ${JSON.stringify(items[lo] ?? null)}`);
                const r = new SpanResult<T>(pos, e[0]);
                e[1].forEach(([end, item]) => {
                    if (pos < end) {
                        r.items.push({ end, item });
                    }
                });
                return (r.items.length > 0) ? r : null;
            }

            const mid = (lo + hi) >> 1;
            const e = this.index[mid];

            // console.log(`${target} lo ${lo} hi ${hi} mid ${mid} probe ${JSON.stringify([e[0], e[1].target])}`);

            if (e[0] <= pos) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
    }
}

export class SpanInfo<T> {
    readonly spans: Map<number, Array<[number, T]>> = new Map();

    add(start: number, end: number, t: T) {
        if (!this.spans.has(start)) {
            this.spans.set(start, []);
        }
        this.spans.get(start)!.push([end, t]);
    }

    index(): SpanIndex<T> {
        const i = new SpanIndex<T>();
        this.spans.forEach((ends, start) => {
            ends.sort((a, b) => a[0] - b[0]);
            i.index.push([start, ends]);
        });
        i.index.sort((a, b) => a[0] - b[0]);
        return i;
    }
}
