export { runReview } from "./core/review.ts";
export type { AppDeps, Clock, ReviewCommandInput, ReviewOutcome } from "./core/review.ts";
export { doctor, doctorExitCode, formatDoctorReport } from "./core/doctor.ts";
export { parseArgv, HELP_TEXT } from "./cli/parse.ts";
export { MCP_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from "./mcp/protocol.ts";
export { serveMcpStdio } from "./mcp/server.ts";
export type { ServeMcpStdioOptions } from "./mcp/server.ts";
export {
  createProductionDeps,
  createMemoryRegistrySource,
  createFileRegistrySource,
  registryPathFromEnv,
} from "./composition.ts";
export {
  FakeAdapter,
  MaliciousAdapter,
  PRODUCTION_FAKE_RESULT,
  PRODUCTION_FAKE_SOURCE,
  createLauncherCatalog,
  fakeCapabilities,
} from "./adapters/fake.ts";
export type { Adapter, FakeResultSource, LauncherCatalog } from "./adapters/fake.ts";
export {
  AdapterFailureError,
  AdapterIsolationError,
  AdapterTimeoutError,
  ReviewerWriteDetectedError,
  capabilitiesAllowed,
} from "./adapters/adapter.ts";
export { CursorAdapter, CURSOR_LAUNCHER_ID } from "./adapters/cursor.ts";
export { CodexAdapter, CODEX_LAUNCHER_ID } from "./adapters/codex.ts";
