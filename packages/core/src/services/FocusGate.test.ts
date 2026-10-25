import { describe, expect, it, vi } from 'vitest';
import { FocusGate } from './FocusGate';

describe('FocusGate', () => {
  it('runs immediately when inactive', () => {
    const g = new FocusGate();
    const fn = vi.fn();
    expect(g.run('a', fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('defers while active and returns pending only when the count reaches zero', () => {
    const g = new FocusGate();
    g.enter();
    g.enter();
    const fn = vi.fn();
    expect(g.run('a', fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(g.exit()).toEqual([]);
    expect(g.active).toBe(true);
    const out = g.exit();
    expect(g.active).toBe(false);
    expect(out.map(([k]) => k)).toEqual(['a']);
  });

  it('dedupes by key keeping the latest function in first-seen order', () => {
    const g = new FocusGate();
    g.enter();
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b = vi.fn();
    g.run('a', a1);
    g.run('b', b);
    g.run('a', a2);
    const out = g.exit();
    expect(out.map(([k]) => k)).toEqual(['a', 'b']);
    out.forEach(([, fn]) => fn());
    expect(a1).not.toHaveBeenCalled();
    expect(a2).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when nothing was deferred', () => {
    const g = new FocusGate();
    g.enter();
    expect(g.exit()).toEqual([]);
  });

  it('extra exit is a no-op (StrictMode double unmount)', () => {
    const g = new FocusGate();
    g.enter();
    g.exit();
    expect(g.exit()).toEqual([]);
    expect(g.active).toBe(false);
    g.enter();
    expect(g.active).toBe(true);
  });
});
