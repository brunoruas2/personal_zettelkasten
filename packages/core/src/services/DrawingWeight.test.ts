import { describe, expect, it } from 'vitest';
import { MAX_DRAWING_BYTES } from '../models/Drawing';
import { DRAWING_LIMIT_LABEL, drawingWeightLevel, formatDrawingBytes } from './DrawingWeight';

describe('drawingWeightLevel', () => {
  it('ok abaixo de 80%', () => {
    expect(drawingWeightLevel(0)).toBe('ok');
    expect(drawingWeightLevel(MAX_DRAWING_BYTES * 0.8 - 1)).toBe('ok');
  });
  it('warn de 80% até 100% inclusive', () => {
    expect(drawingWeightLevel(MAX_DRAWING_BYTES * 0.8)).toBe('warn');
    expect(drawingWeightLevel(MAX_DRAWING_BYTES)).toBe('warn');
  });
  it('over acima de 100%', () => {
    expect(drawingWeightLevel(MAX_DRAWING_BYTES + 1)).toBe('over');
  });
});

describe('formatDrawingBytes', () => {
  it('KB abaixo de 1 MB', () => {
    expect(formatDrawingBytes(0)).toBe('0 KB');
    expect(formatDrawingBytes(1)).toBe('1 KB');
    expect(formatDrawingBytes(512 * 1024)).toBe('512 KB');
  });
  it('MB com 2 casas e vírgula', () => {
    expect(formatDrawingBytes(1024 * 1024)).toBe('1,00 MB');
    expect(formatDrawingBytes(MAX_DRAWING_BYTES)).toBe('5,00 MB');
  });
  it('rótulo do teto sem casas', () => {
    expect(DRAWING_LIMIT_LABEL).toBe('5 MB');
  });
});
