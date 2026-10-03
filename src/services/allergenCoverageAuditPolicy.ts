export interface AllergenAuditOptions {
  apply: boolean;
  confirmedDatabase?: string;
  confirmedHost?: string;
}

export function parseAllergenAuditOptions(args: readonly string[]): AllergenAuditOptions {
  const known = new Set(["--apply", "--confirm-db", "--confirm-host"]);
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!known.has(arg)) throw new Error(`Unsupported option: ${arg}`);
    if (arg === "--apply") {
      if (apply) throw new Error("Duplicate option: --apply");
      apply = true;
      continue;
    }
    if (values.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    values.set(arg, value);
    index += 1;
  }
  const options: AllergenAuditOptions = {
    apply,
    confirmedDatabase: values.get("--confirm-db"),
    confirmedHost: values.get("--confirm-host")
  };
  if (apply && (!options.confirmedDatabase || !options.confirmedHost)) {
    throw new Error("--apply requires both --confirm-db and --confirm-host");
  }
  if (!apply && (options.confirmedDatabase || options.confirmedHost)) {
    throw new Error("Confirmation flags are accepted only together with --apply");
  }
  return options;
}

export function assertAllergenAuditTarget(
  options: AllergenAuditOptions,
  connectedDatabase: string,
  connectedHost: string
): void {
  if (!options.apply) return;
  if (options.confirmedDatabase !== connectedDatabase) {
    throw new Error("Connected database does not match --confirm-db");
  }
  if (options.confirmedHost?.toLowerCase() !== connectedHost.toLowerCase()) {
    throw new Error("Connected host does not match --confirm-host");
  }
}
