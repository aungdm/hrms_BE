declare module 'zklib' {
  class ZKLib {
    constructor(ip: string, port: number, timeout?: number, inport?: number);
    createSocket(): Promise<void>;
    disconnect(): Promise<void>;
    getAttendances(): Promise<Array<{
      userId: string;
      timestamp: number;
      status: number;
    }>>;
  }
  export = ZKLib;
} 