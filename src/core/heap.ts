/**
 * Min-heap of timed events. Event-driven time is pruning, level three: most of
 * 40 Gyr is nothing happening, and the loop jumps straight to the next thing that does.
 */

export interface Event {
  t: number;
  kind: number;
  a: number;
  b: number;
}

export class EventQueue {
  private items: Event[] = [];

  get size(): number {
    return this.items.length;
  }

  push(t: number, kind: number, a = 0, b = 0): void {
    const items = this.items;
    items.push({ t, kind, a, b });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].t <= items[i].t) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): Event | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].t < items[m].t) m = l;
        if (r < items.length && items[r].t < items[m].t) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}
