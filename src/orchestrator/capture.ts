export const MAX_TERMINAL_OUTPUT_BYTES = 50 * 1024;
export const MAX_PARSER_BYTES = 10 * 1024 * 1024; // 10 MiB for JSON parser

export class BoundedCapture {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  constructor(private limitBytes: number = MAX_TERMINAL_OUTPUT_BYTES) {}

  public append(data: Buffer | string) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    // If a single incoming chunk is already larger than the max, slice it down to the max tail.
    // Copy the subarray to ensure we do not retain a huge underlying ArrayBuffer in memory.
    if (buf.length >= this.limitBytes) {
      buf = Buffer.from(buf.subarray(buf.length - this.limitBytes));
      this.chunks = [buf];
      this.totalLength = buf.length;
      return;
    }

    this.chunks.push(buf);
    this.totalLength += buf.length;

    // Remove from the front until we are at or below the limit
    while (this.totalLength > this.limitBytes) {
      const excess = this.totalLength - this.limitBytes;
      const firstChunk = this.chunks[0];
      
      if (firstChunk.length <= excess) {
        // Drop the whole first chunk
        this.chunks.shift();
        this.totalLength -= firstChunk.length;
      } else {
        // Slice the first chunk
        // Copy to avoid retaining the original chunk memory
        this.chunks[0] = Buffer.from(firstChunk.subarray(excess));
        this.totalLength -= excess;
      }
    }
  }

  public getTail(): string {
    if (this.chunks.length === 0) return '';
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
