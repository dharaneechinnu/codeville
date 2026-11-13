/** What the backend's /api/analyze returns. The backend (Django) is the source of truth for these shapes. */

export type Layer = 'frontend' | 'backend' | 'database' | 'tests';

export interface FileInfo {
  path: string;
  lines: number;
  ext: string;
  layer: Layer;
}

export interface Feature {
  id: string;
  name: string;
  /** A feature is part of the app; the database is its own building. */
  kind: 'feature' | 'database';
  /** A short path that names the feature, like `frontend/CartPage`. */
  path: string;
  files: FileInfo[];
  /** How many of its files are in each layer. */
  layers: Record<Layer, number>;
}

export interface Stack {
  frontend: string[];
  backend: string[];
  database: string[];
  services: string[];
  languages: string[];
}

export interface AnalysisStep {
  step: string;
  label: string;
  detail: string;
  ms: number;
}

export type LinkKind = 'calls' | 'imports' | 'stores' | 'uses' | 'tests';

/** One link between two buildings. A building is `<feature id>:<layer>`, the database is `database:database`, a service is `svc-<name>:backend`. */
export interface Connection {
  from: string;
  to: string;
  kind: LinkKind;
  weight: number;
}

/** One link between two single files (two blocks of the town). Both ends are file paths. */
export interface FileLink {
  from: string;
  to: string;
  kind: LinkKind;
}

/** One step of the user flow, with the files of this project that do it. */
export interface FlowStep {
  id: string;
  name: string;
  /** One plain sentence: what a user does at this step. */
  about: string;
  found: boolean;
  /** The file a user reaches first in this step, when the agent named one. It becomes the door of the house. */
  entry?: string;
  files: { path: string; layer: Layer }[];
  layers: Record<Layer, number>;
  /** The features these files belong to, the one with the most files first. */
  features: string[];
}

/** The kind of app this is (its template) and that template's user flow, mapped onto the code. */
export interface Flow {
  template: { id: string; name: string; examples: string[]; about: string };
  steps: FlowStep[];
  found: number;
  total: number;
  /** Who decided this: the connected agent after reading the code, or the app from file and folder names. */
  source?: 'agent' | 'names';
  /** The building style the agent chose, if it chose one. */
  style?: string | null;
  /** Parts of the project that are not a step of the flow. */
  others: { id: string; name: string; files: number }[];
}

/** A command the project itself uses to test, lint, type check or build, and the folder it runs in ('' for the project folder). */
export interface RunCommand {
  id: string;
  kind: 'test' | 'lint' | 'typecheck' | 'build';
  label: string;
  command: string;
  cwd: string;
}

/** One test case written in a test file. */
export interface TestCase {
  file: string;
  name: string;
  line: number;
  cwd: string;
}

export interface Analysis {
  name: string;
  /** The name the project gives itself, from its README or package file. */
  title: string;
  summary: string;
  root: string;
  kind: string;
  stackLine: string;
  stack: Stack;
  layers: Record<Layer, number>;
  features: Feature[];
  /** Missing when an older backend answers. */
  flow?: Flow;
  /** One plain line per file saying what it does, written by the agent. */
  notes?: Record<string, string>;
  connections: Connection[];
  /** Links between single files. Missing when an older backend answers. */
  fileLinks?: FileLink[];
  commands: RunCommand[];
  tests: TestCase[];
  totalFiles: number;
  truncated: boolean;
  steps: AnalysisStep[];
}
