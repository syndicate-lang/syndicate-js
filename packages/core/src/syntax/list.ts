export interface List<T> extends Iterable<T> {
    item: T | null;
    next: List<T> | null;

    toArray(): Array<T>;
}

export function atEnd<T>(xs: List<T>): boolean {
    return xs.item === null;
}

export class ArrayList<T> implements List<T> {
    readonly items: Array<T>;
    readonly index: number = 0;

    constructor(items: Array<T>, index = 0) {
        this.items = items;
        this.index = index;
    }

    get item(): T | null {
        return this.items[this.index] ?? null;
    }

    get next(): List<T> | null {
        if (this.index >= this.items.length) return null;
        return new ArrayList(this.items, this.index + 1);
    }

    toArray(): Array<T> {
        return this.items.slice(this.index);
    }

    [Symbol.iterator](): Iterator<T> {
        let i: List<T> = this;
        return {
            next(): IteratorResult<T> {
                const value = i.item;
                if (!atEnd(i)) i = i.next;
                return { done: atEnd(i), value };
            }
        };
    }
}
