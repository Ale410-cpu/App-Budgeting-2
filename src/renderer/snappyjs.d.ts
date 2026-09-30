declare module 'snappyjs' {
  const snappy: {
    compress(buffer: ArrayBuffer | Uint8Array | Buffer): Uint8Array;
    uncompress(buffer: ArrayBuffer | Uint8Array | Buffer): Uint8Array;
  };
  export default snappy;
}
