import { expect, test, describe } from 'vitest';
import { BoundedCapture, MAX_TERMINAL_OUTPUT_BYTES } from '../src/orchestrator/capture';

describe('BoundedCapture correctly manages string chunks without unbounded memory accumulation', () => {
  test('1. One 500 KiB chunk -> retained output is exactly the final 50 KiB', () => {
    const capture = new BoundedCapture();
    const data = Buffer.alloc(500 * 1024, 'a');
    data.fill('b', 450 * 1024); // last 50 KiB is 'b's

    capture.append(data);
    const tail = capture.getTail();

    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
    expect(tail).toBe('b'.repeat(MAX_TERMINAL_OUTPUT_BYTES));
  });

  test('2. One 1 MiB chunk -> retained output is exactly the final 50 KiB', () => {
    const capture = new BoundedCapture();
    const data = Buffer.alloc(1024 * 1024, 'x');
    data.fill('y', 1024 * 1024 - MAX_TERMINAL_OUTPUT_BYTES);

    capture.append(data);
    const tail = capture.getTail();

    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
    expect(tail).toBe('y'.repeat(MAX_TERMINAL_OUTPUT_BYTES));
  });

  test('3. First chunk = 100 KiB, second chunk = 1 KiB -> exact final 50 KiB across boundary', () => {
    const capture = new BoundedCapture();
    const chunk1 = Buffer.alloc(100 * 1024, '1');
    const chunk2 = Buffer.alloc(1024, '2');
    
    // We expect the last 49 KiB of chunk1 and all 1 KiB of chunk2
    capture.append(chunk1);
    capture.append(chunk2);
    
    const tail = capture.getTail();
    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
    expect(tail.startsWith('1'.repeat(49 * 1024))).toBe(true);
    expect(tail.endsWith('2'.repeat(1024))).toBe(true);
  });

  test('4. Multiple chunks whose combined size exceeds 50 KiB -> exact final tail', () => {
    const capture = new BoundedCapture();
    for (let i = 0; i < 60; i++) {
      capture.append(Buffer.alloc(1024, i.toString().slice(-1))); // 1 KiB chunks
    }
    
    const tail = capture.getTail();
    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES); // 50 KiB limit
    // We added 60 chunks of 1KB. Only the last 50 chunks (i=10 to i=59) should remain.
    expect(tail.startsWith('0'.repeat(1024))).toBe(true); // chunk 10 starts with '0'
    expect(tail.endsWith('9'.repeat(1024))).toBe(true); // chunk 59 ends with '9'
  });

  test('5. Output exactly 50 KiB -> all retained', () => {
    const capture = new BoundedCapture();
    const data = Buffer.alloc(MAX_TERMINAL_OUTPUT_BYTES, 'z');
    capture.append(data);
    
    const tail = capture.getTail();
    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
    expect(tail).toBe('z'.repeat(MAX_TERMINAL_OUTPUT_BYTES));
  });

  test('6. Output 50 KiB + 1 byte -> only final 50 KiB retained', () => {
    const capture = new BoundedCapture();
    const data = Buffer.alloc(MAX_TERMINAL_OUTPUT_BYTES + 1, 'v');
    data.fill('w', 1); // first byte 'v', remaining 'w's
    
    capture.append(data);
    const tail = capture.getTail();
    
    expect(tail.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
    expect(tail).toBe('w'.repeat(MAX_TERMINAL_OUTPUT_BYTES));
  });
});

