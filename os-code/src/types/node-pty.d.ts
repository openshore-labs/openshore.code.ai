// Minimal ambient declaration for node-pty. node-pty is an OPTIONAL native
// dependency (optionalDependencies in package.json): it is not present in this
// repo's node_modules and cannot be built in every environment, so it is
// lazy-imported at runtime and its absence degrades to a clean error. This
// shim gives tsc the types it needs for that lazy import without the module
// being installed, so the build and typecheck stay green with node-pty absent.
declare module 'node-pty' {
  export interface IPty {
    readonly pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (event: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
  }

  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
}
