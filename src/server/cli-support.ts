/** Chooses the platform opener; kept pure so the cmd.exe escaping stays testable. */
export function browserOpenCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", escapeCmdArgument(url)] };
  return { command: "xdg-open", args: [url] };
}

/** cmd.exe parses &, |, <, >, ^, ( and ) even inside start arguments; a path containing them would otherwise split the command line. */
export function escapeCmdArgument(argument: string): string {
  return argument.replace(/[&|^<>()]/g, "^$&");
}
